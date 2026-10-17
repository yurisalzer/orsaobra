/**
 * Explosão dos serviços do orçamento em insumos (para a curva ABC de insumos).
 *
 * Quantidade do insumo = Σ quantidade do serviço × coeficiente (× (1 + % de
 * perda/encargo, quando a composição traz percentual)), descendo pelas
 * composições auxiliares em todos os níveis. Só são usadas composições
 * analíticas OFICIAIS publicadas (na base/regime do item) ou PRÓPRIAS; uma
 * composição sem analítica publicada entra como item único, com o seu preço.
 */
import type { Executor } from "../banco/executor";
import { dec, type Dec } from "../calculo/decimal";
import { linhasDasVersoes, versoesDasComposicoes, type AnaliticoItem, type LinhaItem } from "../orcamento/servico";
import { precificar, type BaseContexto, type ContextoPreco } from "../referencia/precificacao";

export interface InsumoExplodido {
  itemId: string;
  fonte: string;
  codigo: string;
  descricao: string;
  unidade: string | null;
  tipo: "INSUMO" | "COMPOSICAO";
  /** composição sem analítica publicada (entra inteira) */
  semAnalitica: boolean;
  quantidade: Dec;
  precoUnitario: Dec | null;
  custo: Dec | null;
  referencia: string | null;
}

interface No {
  itemId: string;
  fonte: string;
  base: BaseContexto | null; // base/regime da fonte do item (null = próprio)
  fator: Dec;
}

const chaveBase = (b: BaseContexto | null) => (b ? `${b.baseRevisaoId}:${b.regime ?? ""}` : "-");

export async function explodirInsumos(ex: Executor, itens: LinhaItem[], ctx: ContextoPreco): Promise<{ insumos: InsumoExplodido[]; niveis: number }> {
  const baseDaFonte = (fonte: string, herdada: BaseContexto | null): BaseContexto | null => {
    if (fonte === "PROPRIA") return null;
    if (herdada && herdada.fonte === fonte) return herdada;
    return ctx.bases.find((b) => b.fonte === fonte) ?? null;
  };
  // acumulados: insumo (ou composição sem analítica) por item + base
  const acum = new Map<string, { itemId: string; fonte: string; base: BaseContexto | null; quantidade: Dec; tipo: "INSUMO" | "COMPOSICAO"; semAnalitica: boolean }>();
  const somar = (itemId: string, fonte: string, base: BaseContexto | null, q: Dec, tipo: "INSUMO" | "COMPOSICAO", semAnalitica: boolean) => {
    const k = `${itemId}|${chaveBase(base)}`;
    const a = acum.get(k);
    if (a) a.quantidade = a.quantidade.plus(q);
    else acum.set(k, { itemId, fonte, base, quantidade: q, tipo, semAnalitica });
  };

  // 1º nível: itens do orçamento (com o analítico gravado no fechamento, quando houver)
  let fronteira: No[] = [];
  for (const it of itens) {
    const base = it.fonte === "PROPRIA" ? null : it.baseRevisaoId ? { fonte: it.fonte, baseRevisaoId: it.baseRevisaoId, regime: it.regime } : null;
    const q = dec(it.quantidade);
    if (it.tipo === "INSUMO") { somar(it.itemReferenciaId, it.fonte, base, q, "INSUMO", false); continue; }
    const an = it.analitico as AnaliticoItem | null;
    const gravado = an?.linhas?.length && an.linhas.every((l) => l.itemId && l.natureza) ? an.linhas : null;
    if (an && an.tipo === "SEM_ANALITICA" && !gravado) { somar(it.itemReferenciaId, it.fonte, base, q, "COMPOSICAO", true); continue; }
    if (gravado) {
      for (const l of gravado) {
        const fator = q.times(l.coeficiente).times(dec(1).plus(dec(l.percentual ?? 0).div(100)));
        const b = baseDaFonte(l.fonte, base);
        if (l.natureza === "INSUMO") somar(l.itemId!, l.fonte, b, fator, "INSUMO", false);
        else fronteira.push({ itemId: l.itemId!, fonte: l.fonte, base: b, fator });
      }
      continue;
    }
    fronteira.push({ itemId: it.itemReferenciaId, fonte: it.fonte, base, fator: q });
  }

  // níveis seguintes (em lote por nível)
  let niveis = 0;
  for (; fronteira.length && niveis < 30; niveis++) {
    const pedidos = fronteira.map((n, i) => ({ chave: String(i), itemId: n.itemId, fonte: n.fonte, baseRevisaoId: n.base?.baseRevisaoId ?? null, regime: n.base?.regime ?? null }));
    const versoes = await versoesDasComposicoes(ex, pedidos);
    const linhas = await linhasDasVersoes(ex, [...new Set([...versoes.values()].map((v) => v.versaoId))]);
    const proxima: No[] = [];
    fronteira.forEach((n, i) => {
      const v = versoes.get(String(i));
      if (!v) { somar(n.itemId, n.fonte, n.base, n.fator, "COMPOSICAO", true); return; }
      for (const l of linhas.get(v.versaoId) ?? []) {
        const fator = n.fator.times(l.coeficiente).times(dec(1).plus(dec(l.percentual ?? 0).div(100)));
        const b = baseDaFonte(l.fonte, n.base);
        if (l.tipo === "INSUMO") somar(l.itemId, l.fonte, b, fator, "INSUMO", false);
        else proxima.push({ itemId: l.itemId, fonte: l.fonte, base: b, fator });
      }
    });
    fronteira = proxima;
  }
  if (fronteira.length) throw new Error("Composições com mais de 30 níveis: verifique referências circulares.");

  // preços e descrições (em lote por base)
  const grupos = new Map<string, { base: BaseContexto | null; ids: string[] }>();
  for (const a of acum.values()) {
    const k = chaveBase(a.base);
    const g = grupos.get(k) ?? { base: a.base, ids: [] };
    g.ids.push(a.itemId);
    grupos.set(k, g);
  }
  const precos = new Map<string, Awaited<ReturnType<typeof precificar>>>();
  for (const [k, g] of grupos) {
    const c: ContextoPreco = g.base ? { ...ctx, bases: [...ctx.bases.filter((b) => b.fonte !== g.base!.fonte), g.base] } : ctx;
    precos.set(k, await precificar(ex, g.ids, c));
  }
  const ids = [...new Set([...acum.values()].map((a) => a.itemId))];
  const desc = new Map((await ex.consulta<{ id: string; codigo: string; descricao: string; unidade: string | null }>(
    `SELECT ir.id, ir.codigo, v.descricao, v.unidade FROM item_referencia ir
       LEFT JOIN item_proprio ip ON ip.item_id = ir.id
       JOIN LATERAL (SELECT iv.descricao, iv.unidade FROM item_versao iv WHERE iv.item_id = ir.id
                      ORDER BY (iv.id = ip.item_versao_id) DESC NULLS LAST,
                               (SELECT b.competencia FROM base_revisao r JOIN base_mensal b ON b.id = r.base_id WHERE r.id = iv.primeira_base_revisao_id) DESC NULLS LAST
                      LIMIT 1) v ON true
      WHERE ir.id = ANY($1::uuid[])`,
    [ids],
  )).map((d) => [d.id, d]));

  const insumos: InsumoExplodido[] = [...acum.values()].map((a) => {
    const p = precos.get(chaveBase(a.base))?.get(a.itemId);
    const d = desc.get(a.itemId);
    return {
      itemId: a.itemId, fonte: a.fonte, codigo: d?.codigo ?? "?", descricao: d?.descricao ?? "", unidade: d?.unidade ?? null,
      tipo: a.tipo, semAnalitica: a.semAnalitica, quantidade: a.quantidade,
      precoUnitario: p?.valor ?? null, custo: p?.valor ? a.quantidade.times(p.valor) : null, referencia: p?.referencia ?? null,
    };
  });
  return { insumos, niveis };
}
