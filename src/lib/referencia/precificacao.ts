/**
 * Precificação multi-fonte. Regras:
 *  - Item oficial (SINAPI/EMOP): preço PUBLICADO na revisão de base e regime
 *    escolhidos (ou preço único, quando a fonte não distingue regime).
 *    Se não houver preço publicado, o resultado é "AUSENTE" — nunca zero e
 *    nunca um valor recalculado apresentado como oficial.
 *  - Insumo próprio: cotação mais recente até a data de referência.
 *  - Composição própria: Σ coeficiente × preço dos componentes (recursivo),
 *    sem arredondamentos intermediários.
 */
import type { Executor } from "../banco/executor";
import { custoComposicao, PrecoAusenteError, ReferenciaCircularError, type FonteDeDados } from "../calculo/composicao";
import { dec, type Dec } from "../calculo/decimal";

export interface BaseContexto {
  fonte: string;
  baseRevisaoId: string;
  regime: string | null; // código do regime
}

export interface ContextoPreco {
  bases: BaseContexto[];
  /** AAAA-MM-DD — para cotações de insumos próprios. */
  dataReferencia: string;
}

export type OrigemPreco = "PUBLICADO" | "COTACAO" | "CALCULADO" | "AUSENTE";

export interface PrecoItem {
  itemId: string;
  valor: Dec | null;
  origem: OrigemPreco;
  /** ex.: "SINAPI RJ 09/2026 — Encargos sociais sem desoneração" */
  referencia: string | null;
  /** motivo da ausência (base não selecionada, sem preço publicado, componente sem preço...) */
  pendencia?: string;
}

interface InfoItem {
  id: string;
  fonte: string;
  tipo: "INSUMO" | "COMPOSICAO";
  codigo: string;
  composicaoVersaoId: string | null; // só para próprios
}

export async function precificar(ex: Executor, itemIds: string[], ctx: ContextoPreco): Promise<Map<string, PrecoItem>> {
  const info = new Map<string, InfoItem>();
  const componentes = new Map<string, { item: string; coeficiente: string; percentual: string | null }[]>();

  // 1. Carrega os itens e, recursivamente, os componentes das composições próprias
  let pendentes = [...new Set(itemIds)];
  for (let nivel = 0; pendentes.length && nivel < 50; nivel++) {
    const linhas = await ex.consulta<{ id: string; fonte: string; tipo: "INSUMO" | "COMPOSICAO"; codigo: string; cv: string | null }>(
      `SELECT ir.id, f.codigo AS fonte, ir.tipo::text AS tipo, ir.codigo, ip.composicao_versao_id AS cv
         FROM item_referencia ir JOIN fonte f ON f.id = ir.fonte_id LEFT JOIN item_proprio ip ON ip.item_id = ir.id
        WHERE ir.id = ANY($1::uuid[])`,
      [pendentes],
    );
    for (const l of linhas) info.set(l.id, { id: l.id, fonte: l.fonte, tipo: l.tipo, codigo: l.codigo, composicaoVersaoId: l.cv });
    const versoes = linhas.filter((l) => l.fonte === "PROPRIA" && l.cv).map((l) => l.cv!);
    pendentes = [];
    if (versoes.length) {
      const comps = await ex.consulta<{ dono: string; item: string; coeficiente: string; percentual: string | null }>(
        `SELECT cv.item_id AS dono, cc.componente_item_id AS item, cc.coeficiente::text, cc.percentual::text
           FROM composicao_componente cc JOIN composicao_versao cv ON cv.id = cc.composicao_versao_id
          WHERE cc.composicao_versao_id = ANY($1::uuid[]) ORDER BY cc.ordem`,
        [versoes],
      );
      for (const c of comps) {
        const l = componentes.get(c.dono) ?? [];
        l.push({ item: c.item, coeficiente: c.coeficiente, percentual: c.percentual });
        componentes.set(c.dono, l);
        if (!info.has(c.item)) pendentes.push(c.item);
      }
      pendentes = [...new Set(pendentes)];
    }
  }

  // 2. Preços publicados (oficiais) e cotações (próprios)
  const todos = [...info.keys()];
  const publicados = new Map<string, { valor: Dec; referencia: string }>();
  const semBase = new Set<string>();
  for (const [fonte, ids] of agrupar(todos.filter((i) => info.get(i)!.fonte !== "PROPRIA"), (i) => info.get(i)!.fonte)) {
    const base = ctx.bases.find((b) => b.fonte === fonte);
    if (!base) { ids.forEach((i) => semBase.add(i)); continue; }
    const linhas = await ex.consulta<{ item_id: string; valor: string; regime: string | null; regime_nome: string | null; rotulo: string }>(
      `SELECT p.item_id, p.valor::text, g.codigo AS regime, g.nome AS regime_nome,
              f.codigo || ' ' || b.uf || ' ' || to_char(b.competencia, 'MM/YYYY') || CASE WHEN r.numero > 0 THEN ' (retificação ' || r.numero || ')' ELSE '' END AS rotulo
         FROM preco p JOIN base_revisao r ON r.id = p.base_revisao_id JOIN base_mensal b ON b.id = r.base_id JOIN fonte f ON f.id = b.fonte_id
         LEFT JOIN regime g ON g.id = p.regime_id
        WHERE p.base_revisao_id = $1 AND p.item_id = ANY($2::uuid[]) AND (g.codigo = $3 OR p.regime_id IS NULL)`,
      [base.baseRevisaoId, ids, base.regime],
    );
    for (const l of linhas) {
      // preço do regime escolhido tem prioridade sobre o preço único
      if (publicados.has(l.item_id) && l.regime === null) continue;
      publicados.set(l.item_id, { valor: dec(l.valor), referencia: `${l.rotulo}${l.regime_nome ? ` — ${l.regime_nome}` : " — preço único"}` });
    }
  }
  // para explicar ausências: item publicado só em outro regime (ex.: código EMOP de outro regime)
  const outrosRegimes = new Map<string, string>();
  for (const [fonte, ids] of agrupar(todos.filter((i) => info.get(i)!.fonte !== "PROPRIA" && !publicados.has(i)), (i) => info.get(i)!.fonte)) {
    const base = ctx.bases.find((b) => b.fonte === fonte);
    if (!base) continue;
    const linhas = await ex.consulta<{ item_id: string; nomes: string }>(
      `SELECT p.item_id, string_agg(DISTINCT g.nome, ', ') AS nomes FROM preco p JOIN regime g ON g.id = p.regime_id
        WHERE p.base_revisao_id = $1 AND p.item_id = ANY($2::uuid[]) GROUP BY p.item_id`,
      [base.baseRevisaoId, ids],
    );
    for (const l of linhas) outrosRegimes.set(l.item_id, l.nomes);
  }
  const cotacoes = new Map<string, { valor: Dec; data: string }>();
  const proprios = todos.filter((i) => info.get(i)!.fonte === "PROPRIA" && info.get(i)!.tipo === "INSUMO");
  if (proprios.length) {
    const linhas = await ex.consulta<{ item_id: string; valor: string; data: string }>(
      `SELECT DISTINCT ON (item_id) item_id, valor::text, to_char(data_referencia, 'DD/MM/YYYY') AS data
         FROM preco_proprio WHERE item_id = ANY($1::uuid[]) AND data_referencia <= $2::date
        ORDER BY item_id, data_referencia DESC`,
      [proprios, ctx.dataReferencia],
    );
    for (const l of linhas) cotacoes.set(l.item_id, { valor: dec(l.valor), data: l.data });
  }

  // 3. Resultado
  const precoBase = (id: string): Dec | null => publicados.get(id)?.valor ?? cotacoes.get(id)?.valor ?? null;
  const fonteDados: FonteDeDados = {
    componentes: (id) => {
      const c = componentes.get(id);
      return c ? c.map((x) => ({ item: x.item, coeficiente: x.percentual ? dec(x.coeficiente).times(dec(1).plus(dec(x.percentual).div(100))) : x.coeficiente })) : null;
    },
    preco: precoBase,
  };
  const codigo = (id: string) => `${info.get(id)?.fonte ?? "?"} ${info.get(id)?.codigo ?? id}`;
  const resultado = new Map<string, PrecoItem>();
  for (const id of new Set(itemIds)) {
    const it = info.get(id);
    if (!it) { resultado.set(id, { itemId: id, valor: null, origem: "AUSENTE", referencia: null, pendencia: "Item não encontrado." }); continue; }
    if (it.fonte !== "PROPRIA") {
      const p = publicados.get(id);
      resultado.set(id, p
        ? { itemId: id, valor: p.valor, origem: "PUBLICADO", referencia: p.referencia }
        : { itemId: id, valor: null, origem: "AUSENTE", referencia: null, pendencia: semBase.has(id) ? `Nenhuma base ${it.fonte} selecionada.` : outrosRegimes.get(id) ? `Publicado apenas no regime "${outrosRegimes.get(id)}" (diferente do regime selecionado).` : "Sem preço publicado na base/regime selecionados." });
    } else if (it.tipo === "INSUMO") {
      const c = cotacoes.get(id);
      resultado.set(id, c
        ? { itemId: id, valor: c.valor, origem: "COTACAO", referencia: `Cotação de ${c.data}` }
        : { itemId: id, valor: null, origem: "AUSENTE", referencia: null, pendencia: "Sem cotação até a data de referência." });
    } else {
      try {
        const r = custoComposicao(id, fonteDados);
        resultado.set(id, { itemId: id, valor: r.custo, origem: "CALCULADO", referencia: "Composição própria (calculada)" });
      } catch (e) {
        const pend = e instanceof PrecoAusenteError ? `Componente sem preço: ${codigo(e.item)}`
          : e instanceof ReferenciaCircularError ? e.message : (e as Error).message;
        resultado.set(id, { itemId: id, valor: null, origem: "AUSENTE", referencia: null, pendencia: pend });
      }
    }
  }
  return resultado;
}

function agrupar<T, K>(lista: T[], chave: (x: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>();
  for (const x of lista) {
    const k = chave(x);
    m.set(k, [...(m.get(k) ?? []), x]);
  }
  return m;
}
