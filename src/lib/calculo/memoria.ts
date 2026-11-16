/**
 * Resultado da memória de cálculo (orçamento e medições): a conta escrita é
 * avaliada (ver ./expressao) e arredondada:
 *  - para as casas decimais do resultado digitado após "=" ("= 19,896" → 3
 *    casas; "= 19,90" → 2; "= 4 unidades" → inteiro), até 4;
 *  - sem resultado digitado, para 2 casas decimais.
 * O arredondamento é a aproximação aceita: não gera aviso. Avisa-se só quando
 * o resultado digitado difere da conta arredondada.
 */
import { avaliarMemoria } from "./expressao";
import { arredondar, dec, formatarNumero, type Dec } from "./decimal";

/** Casas sem resultado digitado. */
export const CASAS_PADRAO_MEMORIA = 2;

/** Número com no mínimo 2 casas decimais (até 4, se houver: nada é escondido). */
const qtd = (v: string | Dec) => {
  const d = dec(v);
  return formatarNumero(d, Math.min(Math.max(d.decimalPlaces(), 2), 4));
};

export interface ResultadoMemoria {
  /** resultado arredondado, texto pt-BR (usado como quantidade/percentual) */
  quantidade: string | null;
  exibir: string | null;
  /** informação (não é problema): a conta exata e a quantas casas foi arredondada */
  nota: string | null;
  aviso: string | null;
  erro: string | null;
}

/** Calcula a expressão da memória: quantidade (texto pt-BR, arredondada) ou motivo de não calcular. */
export function quantidadeDaMemoria(texto: string): ResultadoMemoria {
  const vazio = { quantidade: null, exibir: null, nota: null, aviso: null, erro: null };
  try {
    const r = avaliarMemoria(texto);
    if (!r) return vazio;
    if (r.valor.isNegative()) return { ...vazio, erro: "O resultado da conta é negativo." };
    const casas = Math.min(r.escritoCasas ?? CASAS_PADRAO_MEMORIA, 4);
    const q = arredondar(r.valor, casas, "ARREDONDAR");
    const exato = formatarNumero(r.valor, Math.min(r.valor.decimalPlaces(), 10));
    const nota = q.eq(r.valor) ? null
      : `conta: ${exato}, arredondada para ${casas === 0 ? "número inteiro" : `${casas} casa${casas > 1 ? "s" : ""} decima${casas > 1 ? "is" : "l"}`}${r.escritoCasas !== null ? " (como o resultado digitado)" : ""}`;
    const aviso = r.escrito && !r.escrito.eq(q)
      ? `o resultado escrito após "=" (${formatarNumero(r.escrito, Math.min(r.escritoCasas ?? 2, 4))}) difere do calculado (${formatarNumero(q, casas)})`
      : null;
    const exibir = qtd(q);
    return { quantidade: exibir, exibir, nota, aviso, erro: null };
  } catch (e) {
    return { ...vazio, erro: `Não foi possível calcular a conta: ${(e as Error).message}` };
  }
}
