/**
 * Prazos do contrato (dias corridos, contando o dia de início):
 * - execução: a partir da data da ordem de serviço;
 * - contratual (vigência): a partir da data de assinatura.
 * Término = início + prazo − 1 dia (ex.: OS em 14/08/2023 com 660 dias termina em 03/06/2025).
 */

export function somarDias(inicio: string, dias: number): string {
  const [a, m, d] = inicio.split("-").map(Number);
  const t = new Date(Date.UTC(a, m - 1, d + dias));
  return t.toISOString().slice(0, 10);
}

/** Data de término (AAAA-MM-DD) ou null quando falta início ou prazo. */
export function termino(inicio: string | null | undefined, prazoDias: number | null | undefined): string | null {
  if (!inicio || !/^\d{4}-\d{2}-\d{2}$/.test(inicio) || !prazoDias || prazoDias < 1) return null;
  return somarDias(inicio, prazoDias - 1);
}

export interface SituacaoPrazos {
  terminoExecucao: string | null;
  terminoVigencia: string | null;
  /** a execução termina depois do fim da vigência do contrato */
  execucaoAlemDaVigencia: boolean;
}

export function calcularPrazos(p: { dataAssinatura?: string | null; dataOs?: string | null; prazoExecucaoDias?: number | null; prazoVigenciaDias?: number | null }): SituacaoPrazos {
  const terminoExecucao = termino(p.dataOs, p.prazoExecucaoDias);
  const terminoVigencia = termino(p.dataAssinatura, p.prazoVigenciaDias);
  return { terminoExecucao, terminoVigencia, execucaoAlemDaVigencia: !!terminoExecucao && !!terminoVigencia && terminoExecucao > terminoVigencia };
}

export const dataBr = (d: string | null | undefined) => (d ? d.split("-").reverse().join("/") : "—");
