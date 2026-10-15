import { type Dec, type ModoArredondamento, arredondar, dec } from "./decimal";

export interface EntradaItem {
  quantidade: string | Dec;
  custoUnitario: string | Dec; // custo direto unitário de referência
  bdiPercentual: string | Dec; // em pontos percentuais
}

export interface ResultadoItem {
  custoUnitario: Dec; // 2 casas
  precoUnitario: Dec; // 2 casas
  custoTotal: Dec; // 2 casas
  precoTotal: Dec; // 2 casas
}

/**
 * Política de cálculo (padrão usual em orçamentos de obras públicas):
 *  1. custo unitário de referência é arredondado/truncado a 2 casas;
 *  2. preço unitário = custo unitário × (1 + BDI), arredondado/truncado a 2 casas;
 *  3. total = quantidade × preço unitário, arredondado/truncado a 2 casas.
 * O total do orçamento é a soma dos totais dos itens (já arredondados), de
 * modo que o relatório "fecha" visualmente linha a linha.
 */
export function calcularItem(e: EntradaItem, modo: ModoArredondamento = "ARREDONDAR"): ResultadoItem {
  const q = dec(e.quantidade as string);
  if (q.isNegative()) throw new Error("Quantidade não pode ser negativa");
  const cu = arredondar(e.custoUnitario as string, 2, modo);
  const fator = dec(1).plus(dec(e.bdiPercentual as string).div(100));
  const pu = arredondar(cu.times(fator), 2, modo);
  return {
    custoUnitario: cu,
    precoUnitario: pu,
    custoTotal: arredondar(q.times(cu), 2, modo),
    precoTotal: arredondar(q.times(pu), 2, modo),
  };
}

export function somar(valores: Dec[]): Dec {
  return valores.reduce((a, b) => a.plus(b), dec(0));
}
