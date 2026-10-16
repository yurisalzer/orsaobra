import type { Executor } from "../banco/executor";

export interface BaseDisponivel {
  revisaoId: string;
  fonte: string;
  fonteNome: string;
  uf: string;
  competencia: string; // AAAA-MM
  numero: number;
  status: string;
  publicada: boolean;
  regimes: { codigo: string; nome: string }[];
}

export function rotuloBase(b: Pick<BaseDisponivel, "fonte" | "uf" | "competencia" | "numero" | "publicada">) {
  const [a, m] = b.competencia.split("-");
  return `${b.fonte} ${b.uf} ${m}/${a}${b.numero ? ` (retificação ${b.numero})` : ""}${b.publicada ? "" : " — NÃO PUBLICADA"}`;
}

/**
 * Bases que podem ser consultadas. Por padrão, só as PUBLICADAS; administradores
 * podem incluir as em conferência (para validá-las antes de publicar).
 * Revisões substituídas continuam consultáveis (histórico), marcadas como tal.
 */
export async function basesDisponiveis(ex: Executor, opcoes: { incluirNaoPublicadas?: boolean } = {}): Promise<BaseDisponivel[]> {
  const status = opcoes.incluirNaoPublicadas ? ["PUBLICADA", "SUBSTITUIDA", "EM_IMPORTACAO", "VALIDADA"] : ["PUBLICADA", "SUBSTITUIDA"];
  const linhas = await ex.consulta<{
    revisao_id: string; fonte: string; fonte_nome: string; uf: string; competencia: string; numero: number; status: string;
    regimes: { codigo: string; nome: string }[] | null;
  }>(
    `SELECT r.id AS revisao_id, f.codigo AS fonte, f.nome AS fonte_nome, b.uf, to_char(b.competencia, 'YYYY-MM') AS competencia,
            r.numero, r.status::text,
            (SELECT jsonb_agg(jsonb_build_object('codigo', g.codigo, 'nome', g.nome) ORDER BY g.codigo)
               FROM regime g WHERE g.fonte_id = f.id
                AND EXISTS (SELECT 1 FROM preco p WHERE p.base_revisao_id = r.id AND p.regime_id = g.id)) AS regimes
       FROM base_revisao r JOIN base_mensal b ON b.id = r.base_id JOIN fonte f ON f.id = b.fonte_id
      WHERE r.status::text = ANY($1)
      ORDER BY f.codigo, b.competencia DESC, r.numero DESC`,
    [status],
  );
  return linhas.map((l) => ({
    revisaoId: l.revisao_id, fonte: l.fonte, fonteNome: l.fonte_nome, uf: l.uf, competencia: l.competencia,
    numero: l.numero, status: l.status, publicada: l.status === "PUBLICADA", regimes: l.regimes ?? [],
  }));
}

/** Base padrão de cada fonte: a publicada mais recente (ou a mais recente disponível). */
export function basePadraoPorFonte(bases: BaseDisponivel[]): Record<string, BaseDisponivel> {
  const r: Record<string, BaseDisponivel> = {};
  for (const b of bases) {
    const atual = r[b.fonte];
    if (!atual || (b.publicada && !atual.publicada) || (b.publicada === atual.publicada && b.competencia > atual.competencia)) r[b.fonte] = b;
  }
  return r;
}
