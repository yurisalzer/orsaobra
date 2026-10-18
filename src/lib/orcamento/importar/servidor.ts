/**
 * Importação de orçamento — parte do servidor:
 *  1. conferir os códigos do arquivo nas bases escolhidas (antes de gravar);
 *  2. gravar etapas e itens em lotes numa revisão em elaboração.
 *
 * O preço de cada item vem SEMPRE da base de referência (ou da cotação/
 * composição própria), como em qualquer item incluído à mão. O valor do
 * arquivo só é mostrado para conferência.
 */
import type { Executor } from "../../banco/executor";
import { comandoAuditoria } from "../../auditoria";
import { arredondar, dec } from "../../calculo/decimal";
import { precificar, type ContextoPreco } from "../../referencia/precificacao";
import {
  comandoInserirItem, contextoDaRevisao, dadosRevisao, ErroOrcamento, lerQuantidade, travarEdicao, valoresDoItem,
} from "../servico";

export interface Candidato {
  consulta: string;
  itemReferenciaId: string;
  fonte: string;
  tipo: "INSUMO" | "COMPOSICAO";
  codigo: string;
  descricao: string;
  unidade: string | null;
  /** Custo unitário (sem BDI) na base/regime escolhidos; null = sem preço. */
  custo: string | null;
  pendencia: string | null;
}

/** Forma usada na comparação de códigos (maiúsculas, espaços simples). */
export const codigoNormalizado = (c: string) => c.trim().toUpperCase().replace(/\s+/g, " ");

/** Variações aceitas: EMOP sem o sufixo de regime ("-0", "-A"…), SICRO sem zeros à esquerda. */
function variacoes(c: string): string[] {
  const v = [c];
  if (/^\d{2}\.\d{3}\.\d{4}$/.test(c)) for (const s of "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ") v.push(`${c}-${s}`);
  if (/^\d{1,6}$/.test(c)) v.push(c.padStart(7, "0"));
  return v;
}

/**
 * Procura cada código nas revisões de base escolhidas (e nos itens próprios
 * ativos) e devolve os candidatos com o custo que teriam no orçamento.
 */
export async function conferirCodigos(
  ex: Executor, bases: { baseRevisaoId: string; regime: string | null }[], codigos: string[], dataReferencia?: string,
): Promise<Candidato[]> {
  const consultas = [...new Set(codigos.map(codigoNormalizado).filter(Boolean))].slice(0, 5000);
  if (!consultas.length || !bases.length) return [];
  const pares = consultas.flatMap((q) => variacoes(q).map((v) => [q, v] as const));
  const revs = await ex.consulta<{ id: string; fonte: string }>(
    `SELECT br.id, f.codigo AS fonte FROM base_revisao br JOIN base_mensal b ON b.id = br.base_id JOIN fonte f ON f.id = b.fonte_id WHERE br.id = ANY($1::uuid[])`,
    [bases.map((b) => b.baseRevisaoId)],
  );
  const achados = await ex.consulta<{ consulta: string; id: string; fonte: string; tipo: "INSUMO" | "COMPOSICAO"; codigo: string; descricao: string; unidade: string | null }>(
    `WITH q AS (SELECT * FROM unnest($1::text[], $2::text[]) AS q(consulta, variacao)),
          revs AS (SELECT br.id, b.fonte_id FROM base_revisao br JOIN base_mensal b ON b.id = br.base_id WHERE br.id = ANY($3::uuid[])),
          ach AS (
            SELECT DISTINCT q.consulta, ir.id, revs.id AS rev FROM q
              JOIN item_referencia ir ON upper(ir.codigo) = q.variacao
              JOIN revs ON revs.fonte_id = ir.fonte_id
             WHERE EXISTS (SELECT 1 FROM base_item bi WHERE bi.base_revisao_id = revs.id AND bi.item_id = ir.id)
            UNION
            SELECT DISTINCT q.consulta, ir.id, NULL::uuid FROM q
              JOIN item_referencia ir ON upper(ir.codigo) = q.variacao
              JOIN item_proprio ip ON ip.item_id = ir.id AND ip.ativo)
     SELECT ach.consulta, ir.id, f.codigo AS fonte, ir.tipo::text AS tipo, ir.codigo, v.descricao, v.unidade
       FROM ach JOIN item_referencia ir ON ir.id = ach.id JOIN fonte f ON f.id = ir.fonte_id
       LEFT JOIN item_proprio ip ON ip.item_id = ir.id
       JOIN LATERAL (
         SELECT iv.descricao, iv.unidade FROM item_versao iv WHERE iv.item_id = ir.id
          ORDER BY (iv.id = ip.item_versao_id) DESC NULLS LAST,
                   (EXISTS (SELECT 1 FROM preco p WHERE p.item_versao_id = iv.id AND p.base_revisao_id = ach.rev)) DESC,
                   (SELECT b.competencia FROM base_revisao r JOIN base_mensal b ON b.id = r.base_id WHERE r.id = iv.primeira_base_revisao_id) DESC NULLS LAST
          LIMIT 1) v ON true
      ORDER BY ach.consulta, f.codigo, ir.codigo`,
    [pares.map((p) => p[0]), pares.map((p) => p[1]), revs.map((r) => r.id)],
  );
  const ctx: ContextoPreco = {
    bases: bases.flatMap((b) => {
      const r = revs.find((x) => x.id === b.baseRevisaoId);
      return r ? [{ fonte: r.fonte, baseRevisaoId: b.baseRevisaoId, regime: b.regime }] : [];
    }),
    dataReferencia: dataReferencia ?? new Date().toISOString().slice(0, 10),
  };
  const precos = await precificar(ex, [...new Set(achados.map((a) => a.id))], ctx);
  return achados.map((a) => {
    const p = precos.get(a.id);
    return {
      consulta: a.consulta, itemReferenciaId: a.id, fonte: a.fonte, tipo: a.tipo, codigo: a.codigo, descricao: a.descricao, unidade: a.unidade,
      custo: p?.valor ? arredondar(p.valor, 4).toFixed(4) : null, pendencia: p?.valor ? null : p?.pendencia ?? "sem preço",
    };
  });
}

export interface EtapaLote {
  chave: string;
  titulo: string;
  paiChave: string | null;
}

/** Cria as etapas (na ordem; a etapa-mãe vem antes) e registra a importação na auditoria. */
export async function criarEtapasImportadas(
  ex: Executor, revisaoId: string, versao: number, etapas: EtapaLote[], origem: { arquivo: string; linhas: number; itens: number }, usuarioId: string,
): Promise<{ versao: number; ids: Record<string, string> }> {
  if (!etapas.length) throw new ErroOrcamento("Nenhuma etapa para importar.");
  if (etapas.length > 2000) throw new ErroOrcamento("Arquivo com etapas demais (máximo 2.000).");
  const ids: Record<string, string> = {};
  const cmds = etapas.map((e) => {
    const titulo = e.titulo.trim().slice(0, 200) || "Etapa";
    const id = crypto.randomUUID();
    ids[e.chave] = id;
    const pai = e.paiChave ? ids[e.paiChave] : null;
    if (e.paiChave && !pai) throw new ErroOrcamento("Etapa-mãe deve vir antes da subetapa.");
    return {
      sql: `INSERT INTO etapa (id, revisao_id, pai_id, ordem, titulo)
            VALUES ($1, $2, $3, (SELECT coalesce(max(ordem), 0) + 1 FROM etapa WHERE revisao_id = $2 AND pai_id IS NOT DISTINCT FROM $3::uuid), $4)`,
      params: [id, revisaoId, pai, titulo],
    };
  });
  await ex.transacao([
    ...travarEdicao(revisaoId, versao),
    ...cmds,
    comandoAuditoria({ usuarioId, acao: "ORCAMENTO_IMPORTADO", entidade: "orcamento_revisao", entidadeId: revisaoId, depois: { ...origem, etapas: etapas.length } }),
  ]);
  return { versao: versao + 1, ids };
}

export interface ItemLote {
  /** Identifica a linha do arquivo, para o relatório de falhas. */
  ref: number;
  etapaId: string;
  itemReferenciaId: string;
  quantidade: string;
}

/**
 * Grava um lote de itens numa transação. Itens sem preço na base/regime do
 * orçamento não são gravados (voltam em `falhas`, com o motivo).
 */
export async function importarItens(ex: Executor, revisaoId: string, versao: number, itens: ItemLote[], usuarioId: string) {
  if (itens.length > 200) throw new ErroOrcamento("Lote grande demais (máximo 200 itens).");
  const r = await dadosRevisao(ex, revisaoId);
  const etapas = new Set((await ex.consulta<{ id: string }>(`SELECT id FROM etapa WHERE revisao_id = $1`, [revisaoId])).map((e) => e.id));
  const ctx = await contextoDaRevisao(ex, revisaoId);
  const ids = [...new Set(itens.map((i) => i.itemReferenciaId))];
  const precos = await precificar(ex, ids, ctx);
  const cabs = new Map((await ex.consulta<{ id: string; fonte: string; codigo: string; descricao: string; unidade: string | null }>(
    `SELECT ir.id, f.codigo AS fonte, ir.codigo, v.descricao, v.unidade
       FROM item_referencia ir JOIN fonte f ON f.id = ir.fonte_id LEFT JOIN item_proprio ip ON ip.item_id = ir.id
       JOIN LATERAL (
         SELECT iv.descricao, iv.unidade FROM item_versao iv WHERE iv.item_id = ir.id
          ORDER BY (iv.id = ip.item_versao_id) DESC NULLS LAST,
                   (EXISTS (SELECT 1 FROM preco p WHERE p.item_versao_id = iv.id AND p.base_revisao_id = ANY($2::uuid[]))) DESC,
                   (SELECT b.competencia FROM base_revisao r JOIN base_mensal b ON b.id = r.base_id WHERE r.id = iv.primeira_base_revisao_id) DESC NULLS LAST
          LIMIT 1) v ON true
      WHERE ir.id = ANY($1::uuid[])`,
    [ids, ctx.bases.map((b) => b.baseRevisaoId)],
  )).map((c) => [c.id, c]));
  const falhas: { ref: number; motivo: string }[] = [];
  const cmds = [];
  let gravados = 0;
  for (const it of itens) {
    const cab = cabs.get(it.itemReferenciaId);
    const preco = precos.get(it.itemReferenciaId);
    let q;
    try { q = dec(lerQuantidade(it.quantidade)); } catch (e) { falhas.push({ ref: it.ref, motivo: (e as Error).message }); continue; }
    if (!etapas.has(it.etapaId)) { falhas.push({ ref: it.ref, motivo: "etapa não encontrada" }); continue; }
    if (!cab) { falhas.push({ ref: it.ref, motivo: "item de referência não encontrado" }); continue; }
    if (!preco?.valor) { falhas.push({ ref: it.ref, motivo: `sem preço na base/regime do orçamento (${preco?.pendencia ?? "sem preço"})` }); continue; }
    const base = cab.fonte === "PROPRIA" ? null : ctx.bases.find((b) => b.fonte === cab.fonte) ?? null;
    const v = valoresDoItem({ quantidade: q, custoReferencia: arredondar(preco.valor, 4), bdi: r.bdi_percentual ?? "0", modo: r.arredondamento, unidade: cab.unidade ?? "", referencia: preco.referencia });
    cmds.push(comandoInserirItem({ id: crypto.randomUUID(), revisaoId, etapaId: it.etapaId, itemReferenciaId: it.itemReferenciaId, base, cab, quantidade: q, valores: v, preco, memoriaQuantitativo: null }));
    gravados++;
  }
  if (!cmds.length) return { versao, gravados: 0, falhas };
  await ex.transacao([
    ...travarEdicao(revisaoId, versao),
    ...cmds,
    comandoAuditoria({ usuarioId, acao: "ITENS_IMPORTADOS", entidade: "orcamento_revisao", entidadeId: revisaoId, depois: { itens: gravados } }),
  ]);
  return { versao: versao + 1, gravados, falhas };
}
