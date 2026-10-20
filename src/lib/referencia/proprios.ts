/**
 * Insumos e composições PRÓPRIOS (criados pelo usuário). Ficam na fonte
 * "PROPRIA" e são sempre identificados como não oficiais. Cada alteração gera
 * nova versão (as anteriores ficam preservadas para orçamentos já feitos).
 */
import type { Comando, Executor } from "../banco/executor";
import { encontrarCiclo } from "../calculo/composicao";
import { lerNumero } from "../calculo/decimal";
import { sha256Hex } from "../importacao/leitores/arquivo";

export class ErroProprio extends Error {}

const RE_CODIGO = /^[A-Za-z0-9][A-Za-z0-9.\-_/]{0,29}$/;
const enc = new TextEncoder();
const hash = (...partes: (string | null)[]) => sha256Hex(enc.encode(partes.map((p) => p ?? "").join("\u001f")));

async function fontePropria(ex: Executor): Promise<string> {
  const [f] = await ex.consulta<{ id: string }>(`SELECT id FROM fonte WHERE codigo = 'PROPRIA'`);
  if (!f) throw new ErroProprio("Fonte PROPRIA não cadastrada (execute o seed).");
  return f.id;
}

async function validarCabecalho(ex: Executor, d: { itemId?: string | null; codigo: string; descricao: string; unidade: string; tipo: "INSUMO" | "COMPOSICAO"; versaoEsperada?: number | null }) {
  const codigo = d.codigo.trim().toUpperCase();
  if (!RE_CODIGO.test(codigo)) throw new ErroProprio("Código inválido: use letras, números, ponto, hífen, barra ou sublinhado (até 30 caracteres).");
  const descricao = d.descricao.replace(/\s+/g, " ").trim();
  if (descricao.length < 3) throw new ErroProprio("Informe a descrição.");
  const unidade = d.unidade.trim();
  if (!unidade || unidade.length > 10) throw new ErroProprio("Informe a unidade (até 10 caracteres).");
  const conflito = await ex.consulta<{ fonte: string; id: string; tipo: string }>(
    `SELECT f.codigo AS fonte, ir.id, ir.tipo::text AS tipo FROM item_referencia ir JOIN fonte f ON f.id = ir.fonte_id WHERE upper(ir.codigo) = $1`,
    [codigo],
  );
  const oficial = conflito.find((c) => c.fonte !== "PROPRIA");
  if (oficial) throw new ErroProprio(`O código ${codigo} já existe na base oficial ${oficial.fonte}. Use outro código para não confundir com item oficial.`);
  const outroProprio = conflito.find((c) => c.fonte === "PROPRIA" && c.id !== d.itemId);
  if (outroProprio) throw new ErroProprio(`Já existe item próprio com o código ${codigo}.`);
  if (d.itemId) {
    const [atual] = await ex.consulta<{ versao: number; tipo: string }>(
      `SELECT ip.versao, ir.tipo::text AS tipo FROM item_proprio ip JOIN item_referencia ir ON ir.id = ip.item_id WHERE ip.item_id = $1`, [d.itemId],
    );
    if (!atual) throw new ErroProprio("Item próprio não encontrado.");
    if (atual.tipo !== d.tipo) throw new ErroProprio("Não é possível mudar o tipo do item.");
    if (d.versaoEsperada != null && atual.versao !== d.versaoEsperada) {
      throw new ErroProprio("Este item foi alterado por outra pessoa enquanto você editava. Recarregue a página e refaça a alteração.");
    }
  }
  return { codigo, descricao, unidade };
}

/** Comandos comuns: identidade, versão de descrição e ponteiro de vigência. */
function comandosItem(p: { itemId: string; novo: boolean; fonteId: string; tipo: string; codigo: string; descricao: string; unidade: string; hashVersao: string; usuarioId: string; composicaoVersaoSql: string | null; versaoEsperada?: number | null }): Comando[] {
  const cmds: Comando[] = [];
  if (p.novo) {
    cmds.push({ sql: `INSERT INTO item_referencia (id, fonte_id, tipo, codigo) VALUES ($1, $2, $3::"TipoItem", $4)`, params: [p.itemId, p.fonteId, p.tipo, p.codigo] });
  } else {
    cmds.push({ sql: `UPDATE item_referencia SET codigo = $2 WHERE id = $1`, params: [p.itemId, p.codigo] });
  }
  cmds.push({
    sql: `INSERT INTO item_versao (item_id, descricao, unidade, hash) VALUES ($1, $2, $3, $4) ON CONFLICT (item_id, hash) DO NOTHING`,
    params: [p.itemId, p.descricao, p.unidade, p.hashVersao],
  });
  const cv = p.composicaoVersaoSql ?? "NULL";
  if (p.novo) {
    cmds.push({
      sql: `INSERT INTO item_proprio (item_id, item_versao_id, composicao_versao_id, criado_por_id)
            VALUES ($1, (SELECT id FROM item_versao WHERE item_id = $1 AND hash = $2), ${cv}, $3)`,
      params: [p.itemId, p.hashVersao, p.usuarioId],
    });
  } else {
    cmds.push({
      sql: `UPDATE item_proprio SET item_versao_id = (SELECT id FROM item_versao WHERE item_id = $1 AND hash = $2),
                   composicao_versao_id = ${cv}, versao = versao + 1, atualizado_em = now(), ativo = true
             WHERE item_id = $1 AND ($3::int IS NULL OR versao = $3)`,
      params: [p.itemId, p.hashVersao, p.versaoEsperada ?? null],
    });
    cmds.push({ sql: `SELECT imp_exigir((SELECT versao FROM item_proprio WHERE item_id = $1) IS NOT NULL, 'Item próprio não encontrado.')`, params: [p.itemId] });
  }
  return cmds;
}

export async function salvarInsumoProprio(
  ex: Executor,
  d: { itemId?: string | null; codigo: string; descricao: string; unidade: string; versaoEsperada?: number | null },
  usuarioId: string,
): Promise<string> {
  const c = await validarCabecalho(ex, { ...d, tipo: "INSUMO" });
  const fonteId = await fontePropria(ex);
  const itemId = d.itemId ?? crypto.randomUUID();
  const h = await hash(c.descricao, c.unidade);
  await ex.transacao([
    ...comandosItem({ itemId, novo: !d.itemId, fonteId, tipo: "INSUMO", ...c, hashVersao: h, usuarioId, composicaoVersaoSql: null, versaoEsperada: d.versaoEsperada }),
    { sql: `INSERT INTO auditoria (usuario_id, acao, entidade, entidade_id, depois) VALUES ($1, $2, 'item_proprio', $3, $4::jsonb)`, params: [usuarioId, d.itemId ? "INSUMO_PROPRIO_ALTERADO" : "INSUMO_PROPRIO_CRIADO", itemId, JSON.stringify(c)] },
  ]);
  return itemId;
}

export async function registrarCotacao(
  ex: Executor,
  d: { itemId: string; data: string; valor: string; fonteCotacao: string; observacao?: string | null },
  usuarioId: string,
) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.data)) throw new ErroProprio("Data inválida.");
  const v = lerNumero(d.valor);
  if (!v || v.isNegative()) throw new ErroProprio("Valor inválido.");
  if (d.fonteCotacao.trim().length < 3) throw new ErroProprio("Informe a fonte da cotação (fornecedor, site, nota fiscal...).");
  const [it] = await ex.consulta<{ ok: boolean }>(
    `SELECT true AS ok FROM item_proprio ip JOIN item_referencia ir ON ir.id = ip.item_id WHERE ip.item_id = $1 AND ir.tipo = 'INSUMO'`, [d.itemId],
  );
  if (!it) throw new ErroProprio("Cotações só podem ser registradas para insumos próprios.");
  await ex.transacao([
    {
      sql: `INSERT INTO preco_proprio (item_id, data_referencia, valor, fonte_cotacao, observacao) VALUES ($1, $2::date, $3::numeric, $4, $5)
            ON CONFLICT (item_id, data_referencia) DO UPDATE SET valor = EXCLUDED.valor, fonte_cotacao = EXCLUDED.fonte_cotacao, observacao = EXCLUDED.observacao`,
      params: [d.itemId, d.data, v.toString(), d.fonteCotacao.trim(), d.observacao ?? null],
    },
    { sql: `INSERT INTO auditoria (usuario_id, acao, entidade, entidade_id, depois) VALUES ($1, 'COTACAO_REGISTRADA', 'item_proprio', $2, $3::jsonb)`, params: [usuarioId, d.itemId, JSON.stringify({ data: d.data, valor: v.toString(), fonte: d.fonteCotacao })] },
  ]);
}

export interface ComponenteInformado {
  itemId: string;
  coeficiente: string; // aceita "0,1234" ou "0.1234"
  /** como se chegou ao coeficiente (texto livre) */
  memoria?: string | null;
}

export async function salvarComposicaoPropria(
  ex: Executor,
  d: { itemId?: string | null; codigo: string; descricao: string; unidade: string; componentes: ComponenteInformado[]; versaoEsperada?: number | null; observacao?: string | null },
  usuarioId: string,
): Promise<string> {
  const c = await validarCabecalho(ex, { ...d, tipo: "COMPOSICAO" });
  if (d.componentes.length === 0) throw new ErroProprio("A composição precisa de ao menos um componente.");
  if (d.componentes.length > 300) throw new ErroProprio("Composição com componentes demais (máximo 300).");
  const vistos = new Set<string>();
  const comps = d.componentes.map((x, i) => {
    const coef = lerNumero(x.coeficiente);
    if (!coef || !coef.gt(0)) throw new ErroProprio(`Coeficiente inválido na linha ${i + 1}.`);
    if (coef.decimalPlaces() > 10) throw new ErroProprio(`Coeficiente com mais de 10 casas decimais na linha ${i + 1}.`);
    if (vistos.has(x.itemId)) throw new ErroProprio(`Componente repetido na linha ${i + 1}.`);
    vistos.add(x.itemId);
    const memoria = x.memoria?.trim() || null;
    if (memoria && memoria.length > 2000) throw new ErroProprio(`Memória de cálculo com mais de 2.000 caracteres na linha ${i + 1}.`);
    return { itemId: x.itemId, coeficiente: coef.toString(), memoria };
  });
  const existentes = await ex.consulta<{ id: string; fonte: string; tipo: string }>(
    `SELECT ir.id, f.codigo AS fonte, ir.tipo::text AS tipo FROM item_referencia ir JOIN fonte f ON f.id = ir.fonte_id WHERE ir.id = ANY($1::uuid[])`,
    [comps.map((x) => x.itemId)],
  );
  if (existentes.length !== comps.length) throw new ErroProprio("Há componente inexistente.");

  if (d.itemId && !/^[0-9a-f-]{36}$/i.test(d.itemId)) throw new ErroProprio("Identificador inválido.");
  const itemId = d.itemId ?? crypto.randomUUID();
  if (comps.some((x) => x.itemId === itemId)) throw new ErroProprio("A composição não pode conter a si mesma.");

  // ciclos: grafo das composições próprias vigentes, com a nova estrutura no lugar da antiga
  const arestas = await ex.consulta<{ de: string; para: string }>(
    `SELECT ip.item_id AS de, cc.componente_item_id AS para FROM item_proprio ip
       JOIN composicao_componente cc ON cc.composicao_versao_id = ip.composicao_versao_id WHERE ip.ativo`,
  );
  const grafo = new Map<string, string[]>();
  for (const a of arestas) if (a.de !== itemId) grafo.set(a.de, [...(grafo.get(a.de) ?? []), a.para]);
  grafo.set(itemId, comps.map((x) => x.itemId));
  const ciclo = encontrarCiclo(itemId, (n) => grafo.get(n) ?? null);
  if (ciclo) {
    const cods = await ex.consulta<{ id: string; codigo: string }>(`SELECT id, codigo FROM item_referencia WHERE id = ANY($1::uuid[])`, [ciclo]);
    const nome = (id: string) => (id === itemId ? c.codigo : cods.find((x) => x.id === id)?.codigo ?? id);
    throw new ErroProprio(`Referência circular entre composições: ${ciclo.map(nome).join(" → ")}`);
  }

  const fonteId = await fontePropria(ex);
  const hv = await hash(c.descricao, c.unidade);
  // a memória entra no hash só quando informada (versões antigas, sem memória, mantêm o mesmo hash)
  const hc = await hash(...comps.map((x, i) => `${i + 1}|${x.itemId}|${x.coeficiente}${x.memoria ? `|${x.memoria}` : ""}`));
  const cvSql = `(SELECT id FROM composicao_versao WHERE item_id = '${itemId}' AND hash = '${hc}')`;
  const cmds: Comando[] = [];
  if (!d.itemId) cmds.push({ sql: `INSERT INTO item_referencia (id, fonte_id, tipo, codigo) VALUES ($1, $2, 'COMPOSICAO', $3)`, params: [itemId, fonteId, c.codigo] });
  cmds.push(
    { sql: `INSERT INTO composicao_versao (item_id, origem, hash, observacao) VALUES ($1, 'PROPRIA', $2, $3) ON CONFLICT (item_id, hash) DO NOTHING`, params: [itemId, hc, d.observacao ?? null] },
    {
      sql: `INSERT INTO composicao_componente (composicao_versao_id, componente_item_id, coeficiente, ordem, tipo_original, memoria_calculo)
            SELECT v.id, x."itemId"::uuid, x.coeficiente::numeric, x.ordem, ir.tipo::text, x.memoria
              FROM jsonb_to_recordset($3::jsonb) AS x("itemId" text, coeficiente text, ordem int, memoria text)
              JOIN composicao_versao v ON v.item_id = $1 AND v.hash = $2
              JOIN item_referencia ir ON ir.id = x."itemId"::uuid
             WHERE NOT EXISTS (SELECT 1 FROM composicao_componente cc WHERE cc.composicao_versao_id = v.id)`,
      params: [itemId, hc, JSON.stringify(comps.map((x, i) => ({ ...x, ordem: i + 1 })))],
    },
    ...comandosItem({ itemId, novo: !d.itemId, fonteId, tipo: "COMPOSICAO", ...c, hashVersao: hv, usuarioId, composicaoVersaoSql: cvSql, versaoEsperada: d.versaoEsperada }).filter((x) => !x.sql.startsWith("INSERT INTO item_referencia")),
    { sql: `INSERT INTO auditoria (usuario_id, acao, entidade, entidade_id, depois) VALUES ($1, $2, 'item_proprio', $3, $4::jsonb)`, params: [usuarioId, d.itemId ? "COMPOSICAO_PROPRIA_ALTERADA" : "COMPOSICAO_PROPRIA_CRIADA", itemId, JSON.stringify({ ...c, componentes: comps })] },
  );
  await ex.transacao(cmds);
  return itemId;
}

export async function listarProprios(ex: Executor) {
  return ex.consulta<{ itemId: string; tipo: "INSUMO" | "COMPOSICAO"; codigo: string; descricao: string; unidade: string | null; versao: number; atualizadoEm: string; componentes: number; ultimaCotacao: string | null }>(
    `SELECT ir.id AS "itemId", ir.tipo::text AS tipo, ir.codigo, v.descricao, v.unidade, ip.versao,
            to_char(ip.atualizado_em AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') AS "atualizadoEm",
            (SELECT count(*)::int FROM composicao_componente cc WHERE cc.composicao_versao_id = ip.composicao_versao_id) AS componentes,
            (SELECT to_char(max(pp.data_referencia), 'DD/MM/YYYY') FROM preco_proprio pp WHERE pp.item_id = ir.id) AS "ultimaCotacao"
       FROM item_proprio ip JOIN item_referencia ir ON ir.id = ip.item_id JOIN item_versao v ON v.id = ip.item_versao_id
      WHERE ip.ativo ORDER BY ir.tipo DESC, ir.codigo`,
  );
}

export async function cotacoes(ex: Executor, itemId: string) {
  return ex.consulta<{ data: string; valor: string; fonteCotacao: string | null; observacao: string | null }>(
    `SELECT to_char(data_referencia, 'YYYY-MM-DD') AS data, valor::text, fonte_cotacao AS "fonteCotacao", observacao
       FROM preco_proprio WHERE item_id = $1 ORDER BY data_referencia DESC`, [itemId],
  );
}
