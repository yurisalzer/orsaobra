import type { Executor } from "../banco/executor";

export interface FiltroBusca {
  texto: string;
  /** Revisões de base a consultar (uma por fonte). */
  revisoes: string[];
  incluirProprios: boolean;
  tipo?: "INSUMO" | "COMPOSICAO" | null;
  /**
   * Só itens com preço publicado no regime adotado em cada revisão (ou preço
   * único, sem regime). Usado ao incluir itens no orçamento: para a EMOP, por
   * exemplo, um orçamento "com desoneração" mostra só os códigos "-A…".
   */
  regimeAdotado?: { revisaoId: string; regime: string | null }[];
  limite?: number;
  pagina?: number;
}

export interface ResultadoBusca {
  itemId: string;
  fonte: string;
  tipo: "INSUMO" | "COMPOSICAO";
  codigo: string;
  descricao: string;
  unidade: string | null;
  grupo: string | null;
  revisaoId: string | null;
  /** valor por código de regime ("" = preço único). null = sem preço publicado. */
  precos: Record<string, string>;
  temAnalitica: boolean;
}

/** Palavras da busca sem acento e em minúsculas (para o índice trigram). */
export function termos(texto: string): string[] {
  return texto
    .normalize("NFD").replace(/\p{Diacritic}/gu, "")
    .toLowerCase().split(/\s+/).map((t) => t.replace(/[%_\\]/g, "")).filter((t) => t.length > 0).slice(0, 8);
}

const pareceCodigo = (t: string) => /^[\d.\-A-Za-z]*\d[\d.\-A-Za-z]*$/.test(t) && !/\s/.test(t);

/**
 * Busca por código (prefixo, preservando zeros à esquerda) ou por palavras da
 * descrição (todas devem aparecer, sem diferenciar acentos/maiúsculas).
 * Texto vazio = lista todos os itens das bases selecionadas (paginado).
 */
export async function buscarItens(ex: Executor, f: FiltroBusca): Promise<{ itens: ResultadoBusca[]; total: number }> {
  const texto = f.texto.trim();
  const todos = texto.length === 0;
  if (!todos && texto.length < 2) return { itens: [], total: 0 };
  const limite = Math.min(f.limite ?? 50, 200);
  const deslocamento = Math.max(0, ((f.pagina ?? 1) - 1) * limite);
  const porCodigo = !todos && pareceCodigo(texto);
  const palavras = porCodigo || todos ? [] : termos(texto);
  if (!todos && !porCodigo && palavras.length === 0) return { itens: [], total: 0 };

  // 1º filtra pelo texto/código (índices trigram), depois restringe às revisões escolhidas.
  const params: unknown[] = [f.revisoes, f.incluirProprios, f.tipo ?? null, limite, deslocamento];
  let filtroRegime = "";
  if (f.regimeAdotado) {
    params.push(JSON.stringify(Object.fromEntries(f.regimeAdotado.map((r) => [r.revisaoId, r.regime]))));
    filtroRegime = `AND (c.revisao_id IS NULL OR EXISTS (
        SELECT 1 FROM preco pr LEFT JOIN regime g ON g.id = pr.regime_id
         WHERE pr.base_revisao_id = c.revisao_id AND pr.item_id = c.id
           AND (pr.regime_id IS NULL OR g.codigo = ($${params.length}::jsonb ->> c.revisao_id::text))))`;
  }
  let alvo: string;
  if (todos) {
    // todos os itens presentes nas revisões escolhidas (consulta por conjuntos, sem verificação item a item)
    alvo = `SELECT item_id FROM base_item WHERE base_revisao_id = ANY($1::uuid[])
            UNION SELECT item_id FROM item_proprio WHERE $2 AND ativo`;
  } else if (porCodigo) {
    params.push(texto.toUpperCase().replace(/[%_\\]/g, "") + "%");
    alvo = `SELECT ir.id AS item_id FROM item_referencia ir WHERE ir.codigo LIKE $${params.length}`;
  } else {
    const conds = palavras.map((p) => {
      params.push(`%${p}%`);
      return `lower(f_unaccent(iv.descricao)) LIKE $${params.length}`;
    });
    alvo = `SELECT DISTINCT iv.item_id FROM item_versao iv WHERE ${conds.join(" AND ")}`;
  }
  const sql = `
    WITH revs AS (
      SELECT r.id AS revisao_id, b.fonte_id FROM base_revisao r JOIN base_mensal b ON b.id = r.base_id WHERE r.id = ANY($1::uuid[])),
    alvo AS (${alvo}),
    candidatos AS (
      SELECT ir.id, ir.fonte_id, ir.tipo, ir.codigo, revs.revisao_id
        FROM alvo JOIN item_referencia ir ON ir.id = alvo.item_id
        JOIN fonte fo ON fo.id = ir.fonte_id
        LEFT JOIN revs ON revs.fonte_id = ir.fonte_id
       WHERE (revs.revisao_id IS NOT NULL OR ($2 AND fo.codigo = 'PROPRIA' AND EXISTS (SELECT 1 FROM item_proprio ip WHERE ip.item_id = ir.id AND ip.ativo)))
         AND ($3::text IS NULL OR ir.tipo::text = $3)),
    presentes AS (
      SELECT c.* FROM candidatos c
       WHERE (${todos ? "true OR " : ""}c.revisao_id IS NULL
          OR EXISTS (SELECT 1 FROM base_item bi WHERE bi.base_revisao_id = c.revisao_id AND bi.item_id = c.id))
         ${filtroRegime}),
    pagina AS (
      SELECT p.*, fo.codigo AS fonte, count(*) OVER () AS total FROM presentes p JOIN fonte fo ON fo.id = p.fonte_id
       ORDER BY fo.codigo, p.codigo LIMIT $4 OFFSET $5)
    SELECT p.id AS item_id, p.fonte, p.tipo::text AS tipo, p.codigo, v.descricao, v.unidade, v.grupo, p.revisao_id, p.total,
           coalesce((SELECT jsonb_object_agg(coalesce(g.codigo, ''), pr.valor::text) FROM preco pr LEFT JOIN regime g ON g.id = pr.regime_id
                      WHERE pr.base_revisao_id = p.revisao_id AND pr.item_id = p.id), '{}'::jsonb) AS precos,
           (EXISTS (SELECT 1 FROM base_composicao bc WHERE bc.base_revisao_id = p.revisao_id AND bc.item_id = p.id)
            OR EXISTS (SELECT 1 FROM preco x WHERE x.base_revisao_id = p.revisao_id AND x.item_id = p.id AND x.atributos ? 'analitica_sicro')
            OR EXISTS (SELECT 1 FROM item_proprio ip WHERE ip.item_id = p.id AND ip.composicao_versao_id IS NOT NULL)) AS tem_analitica
      FROM pagina p
      JOIN LATERAL (
        SELECT iv.descricao, iv.unidade, iv.grupo FROM item_versao iv
         WHERE iv.item_id = p.id
         ORDER BY (EXISTS (SELECT 1 FROM preco x WHERE x.item_versao_id = iv.id AND x.base_revisao_id = p.revisao_id)) DESC,
                  (EXISTS (SELECT 1 FROM item_proprio ip WHERE ip.item_versao_id = iv.id)) DESC,
                  (SELECT max(b.competencia) FROM base_revisao r JOIN base_mensal b ON b.id = r.base_id WHERE r.id = iv.primeira_base_revisao_id) DESC NULLS LAST
         LIMIT 1) v ON true
     ORDER BY p.fonte, p.codigo`;
  const linhas = await ex.consulta<{
    item_id: string; fonte: string; tipo: "INSUMO" | "COMPOSICAO"; codigo: string; descricao: string; unidade: string | null; grupo: string | null;
    revisao_id: string | null; precos: Record<string, string>; tem_analitica: boolean; total: string;
  }>(sql, params);
  return {
    total: linhas.length ? Number(linhas[0].total) : 0,
    itens: linhas.map((l) => ({
      itemId: l.item_id, fonte: l.fonte, tipo: l.tipo, codigo: l.codigo, descricao: l.descricao, unidade: l.unidade, grupo: l.grupo,
      revisaoId: l.revisao_id, precos: l.precos, temAnalitica: l.tem_analitica,
    })),
  };
}
