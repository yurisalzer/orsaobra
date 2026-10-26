/**
 * Períodos das medições (funções puras, usadas no servidor e na tela).
 *  - Serviço contínuo (contrato anual): mensais "dia a dia" — 10/10/2026 a 09/11/2026,
 *    10/11/2026 a 09/12/2026...
 *  - Demais objetos: `dias` corridos (no máximo 30) cada.
 */
import { somarDias } from "@/lib/contratos/prazos";

export const MAX_DIAS = 30;

/** Dias corridos de um período, contando início e fim. */
export const diasEntre = (inicio: string, fim: string) =>
  Math.round((Date.UTC(+fim.slice(0, 4), +fim.slice(5, 7) - 1, +fim.slice(8, 10)) - Date.UTC(+inicio.slice(0, 4), +inicio.slice(5, 7) - 1, +inicio.slice(8, 10))) / 86400000) + 1;

/** Mesmo dia do mês, n meses depois (no fim do mês quando o dia não existe: 31/01 + 1 mês = 28/02). */
export function somarMeses(data: string, n: number): string {
  const [a, m, d] = data.split("-").map(Number);
  const alvo = new Date(Date.UTC(a, m - 1 + n, 1));
  const ultimo = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate();
  alvo.setUTCDate(Math.min(d, ultimo));
  return alvo.toISOString().slice(0, 10);
}

export interface Periodo { inicio: string; fim: string }

/**
 * Períodos planejados. Contínuo: mensais a partir do dia de início (o k-ésimo
 * vai de início + (k−1) meses até início + k meses − 1 dia). Demais: `dias` corridos.
 */
export function gerarPeriodos(inicio: string, quantidade: number, continuo: boolean, dias: number): Periodo[] {
  return Array.from({ length: quantidade }, (_, k) => {
    if (continuo) return { inicio: somarMeses(inicio, k), fim: somarDias(somarMeses(inicio, k + 1), -1) };
    const i = somarDias(inicio, k * dias);
    return { inicio: i, fim: somarDias(i, dias - 1) };
  });
}
