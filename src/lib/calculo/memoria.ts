/**
 * Resultado da memória de cálculo (orçamento e medições): a conta escrita é
 * avaliada (ver ./expressao) e devolvida como número pt-BR com até 4 casas.
 */
import { avaliarMemoria } from "./expressao";
import { dec, formatarNumero, type Dec } from "./decimal";

/** Número com no mínimo 2 casas decimais (até 4, se houver: nada é escondido). */
const qtd = (v: string | Dec) => {
  const d = dec(v);
  return formatarNumero(d, Math.min(Math.max(d.decimalPlaces(), 2), 4));
};

/** Calcula a expressão da memória: quantidade (texto pt-BR, até 4 casas) ou motivo de não calcular. */
export function quantidadeDaMemoria(texto: string): { quantidade: string | null; exibir: string | null; aviso: string | null; erro: string | null } {
  try {
    const r = avaliarMemoria(texto);
    if (!r) return { quantidade: null, exibir: null, aviso: null, erro: null };
    if (r.valor.isNegative()) return { quantidade: null, exibir: null, aviso: null, erro: "O resultado da conta é negativo." };
    const q = r.valor.toDecimalPlaces(4);
    const avisos: string[] = [];
    if (!q.eq(r.valor)) avisos.push("resultado arredondado para 4 casas decimais");
    if (r.escrito && !r.escrito.eq(r.valor)) avisos.push(`o resultado escrito após "=" (${formatarNumero(r.escrito, Math.min(r.escrito.decimalPlaces(), 4))}) difere do calculado`);
    const exibir = qtd(q);
    return { quantidade: exibir, exibir, aviso: avisos.length ? avisos.join("; ") : null, erro: null };
  } catch (e) {
    return { quantidade: null, exibir: null, aviso: null, erro: `Não foi possível calcular a conta: ${(e as Error).message}` };
  }
}

