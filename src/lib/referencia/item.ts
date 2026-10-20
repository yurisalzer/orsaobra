import type { Executor } from "../banco/executor";

export interface CabecalhoItem {
  id: string;
  fonte: string;
  fonteNome: string;
  oficial: boolean;
  tipo: "INSUMO" | "COMPOSICAO";
  codigo: string;
  descricao: string;
  unidade: string | null;
  grupo: string | null;
  atributos: Record<string, unknown> | null;
  proprio: { versao: number; composicaoVersaoId: string | null; ativo: boolean } | null;
}

export async function cabecalhoItem(ex: Executor, id: string, revisaoId?: string | null): Promise<CabecalhoItem | null> {
  const [l] = await ex.consulta<{
    id: string; fonte: string; fonte_nome: string; oficial: boolean; tipo: "INSUMO" | "COMPOSICAO"; codigo: string;
    descricao: string; unidade: string | null; grupo: string | null; atributos: Record<string, unknown> | null;
    p_versao: number | null; p_cv: string | null; p_ativo: boolean | null;
  }>(
    `SELECT ir.id, f.codigo AS fonte, f.nome AS fonte_nome, f.oficial, ir.tipo::text AS tipo, ir.codigo,
            v.descricao, v.unidade, v.grupo, v.atributos, ip.versao AS p_versao, ip.composicao_versao_id AS p_cv, ip.ativo AS p_ativo
       FROM item_referencia ir JOIN fonte f ON f.id = ir.fonte_id
       LEFT JOIN item_proprio ip ON ip.item_id = ir.id
       JOIN LATERAL (
         SELECT iv.* FROM item_versao iv WHERE iv.item_id = ir.id
          ORDER BY (iv.id = ip.item_versao_id) DESC NULLS LAST,
                   (EXISTS (SELECT 1 FROM preco p WHERE p.item_versao_id = iv.id AND p.base_revisao_id = $2::uuid)) DESC,
                   (SELECT b.competencia FROM base_revisao r JOIN base_mensal b ON b.id = r.base_id WHERE r.id = iv.primeira_base_revisao_id) DESC NULLS LAST
          LIMIT 1) v ON true
      WHERE ir.id = $1`,
    [id, revisaoId ?? null],
  );
  if (!l) return null;
  return {
    id: l.id, fonte: l.fonte, fonteNome: l.fonte_nome, oficial: l.oficial, tipo: l.tipo, codigo: l.codigo, descricao: l.descricao,
    unidade: l.unidade, grupo: l.grupo, atributos: l.atributos,
    proprio: l.p_versao !== null ? { versao: l.p_versao, composicaoVersaoId: l.p_cv, ativo: !!l.p_ativo } : null,
  };
}

export interface PontoHistorico {
  revisaoId: string;
  competencia: string; // AAAA-MM
  numero: number;
  status: string;
  regime: string | null;
  regimeNome: string | null;
  valor: string;
  origemPreco: string | null;
  atributos: Record<string, unknown> | null;
}

/** Histórico de preços publicados do item (todas as revisões consultáveis). */
export function historicoPrecos(ex: Executor, id: string, incluirNaoPublicadas: boolean) {
  return ex.consulta<PontoHistorico>(
    `SELECT r.id AS "revisaoId", to_char(b.competencia, 'YYYY-MM') AS competencia, r.numero, r.status::text AS status,
            g.codigo AS regime, g.nome AS "regimeNome", p.valor::text AS valor, p.origem_preco AS "origemPreco", p.atributos
       FROM preco p JOIN base_revisao r ON r.id = p.base_revisao_id JOIN base_mensal b ON b.id = r.base_id
       LEFT JOIN regime g ON g.id = p.regime_id
      WHERE p.item_id = $1 AND r.status::text = ANY($2)
      ORDER BY b.competencia, r.numero, g.codigo NULLS FIRST`,
    [id, incluirNaoPublicadas ? ["PUBLICADA", "SUBSTITUIDA", "EM_IMPORTACAO", "VALIDADA"] : ["PUBLICADA", "SUBSTITUIDA"]],
  );
}

export interface LinhaAnalitica {
  ordem: number;
  itemId: string;
  fonte: string;
  tipo: "INSUMO" | "COMPOSICAO";
  tipoOriginal: string | null;
  codigo: string;
  descricao: string;
  unidade: string | null;
  coeficiente: string;
  percentual: string | null;
  situacao: string | null;
  /** memória de cálculo do coeficiente (composições próprias) */
  memoria: string | null;
}

/**
 * Composição analítica OFICIAL vigente numa revisão de base (e regime).
 * Retorna null se a fonte não publicou analítica para o item nessa base —
 * nunca é inventada.
 */
export async function analiticaOficial(ex: Executor, itemId: string, revisaoId: string, regime: string | null) {
  const [bc] = await ex.consulta<{ versao_id: string; regime: string | null }>(
    `SELECT bc.composicao_versao_id AS versao_id, g.codigo AS regime FROM base_composicao bc LEFT JOIN regime g ON g.id = bc.regime_id
      WHERE bc.base_revisao_id = $1 AND bc.item_id = $2 AND (bc.regime_id IS NULL OR g.codigo = $3)
      ORDER BY bc.regime_id NULLS LAST LIMIT 1`,
    [revisaoId, itemId, regime],
  );
  if (!bc) return null;
  return { versaoId: bc.versao_id, linhas: await linhasDaVersao(ex, bc.versao_id, revisaoId) };
}

export function linhasDaVersao(ex: Executor, versaoId: string, revisaoId: string | null) {
  return ex.consulta<LinhaAnalitica>(
    `SELECT cc.ordem, ir.id AS "itemId", f.codigo AS fonte, ir.tipo::text AS tipo, cc.tipo_original AS "tipoOriginal", ir.codigo,
            v.descricao, v.unidade, cc.coeficiente::text AS coeficiente, cc.percentual::text AS percentual, cc.situacao, cc.memoria_calculo AS memoria
       FROM composicao_componente cc JOIN item_referencia ir ON ir.id = cc.componente_item_id JOIN fonte f ON f.id = ir.fonte_id
       LEFT JOIN item_proprio ip ON ip.item_id = ir.id
       JOIN LATERAL (
         SELECT iv.descricao, iv.unidade FROM item_versao iv WHERE iv.item_id = ir.id
          ORDER BY (iv.id = ip.item_versao_id) DESC NULLS LAST,
                   (EXISTS (SELECT 1 FROM preco p WHERE p.item_versao_id = iv.id AND p.base_revisao_id = $2::uuid)) DESC,
                   (SELECT b.competencia FROM base_revisao r JOIN base_mensal b ON b.id = r.base_id WHERE r.id = iv.primeira_base_revisao_id) DESC NULLS LAST
          LIMIT 1) v ON true
      WHERE cc.composicao_versao_id = $1
      ORDER BY cc.ordem`,
    [versaoId, revisaoId],
  );
}

/** Composições (oficiais na revisão dada, ou próprias vigentes) que usam o item. */
export function usadoEm(ex: Executor, itemId: string, revisaoId: string | null, limite = 30) {
  return ex.consulta<{ itemId: string; fonte: string; codigo: string; descricao: string; coeficiente: string }>(
    `SELECT DISTINCT ON (ir.id) ir.id AS "itemId", f.codigo AS fonte, ir.codigo, v.descricao, cc.coeficiente::text AS coeficiente
       FROM composicao_componente cc
       JOIN composicao_versao cv ON cv.id = cc.composicao_versao_id
       JOIN item_referencia ir ON ir.id = cv.item_id JOIN fonte f ON f.id = ir.fonte_id
       JOIN LATERAL (SELECT iv.descricao FROM item_versao iv WHERE iv.item_id = ir.id ORDER BY iv.id DESC LIMIT 1) v ON true
      WHERE cc.componente_item_id = $1
        AND (EXISTS (SELECT 1 FROM base_composicao bc WHERE bc.composicao_versao_id = cv.id AND bc.base_revisao_id = $2::uuid)
             OR EXISTS (SELECT 1 FROM item_proprio ip WHERE ip.composicao_versao_id = cv.id AND ip.ativo))
      ORDER BY ir.id LIMIT $3`,
    [itemId, revisaoId, limite],
  );
}
