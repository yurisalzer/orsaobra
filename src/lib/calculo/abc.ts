import { type Dec, dec } from "./decimal";

export interface LinhaAbc<T> {
  chave: T;
  valor: Dec;
  percentual: Dec; // do total, em pontos percentuais
  acumulado: Dec;
  classe: "A" | "B" | "C";
}

/** Curva ABC. Limites padrão: A até 80%, B até 95%, C o restante. */
export function curvaAbc<T>(itens: { chave: T; valor: Dec }[], limiteA = 80, limiteB = 95): LinhaAbc<T>[] {
  const total = itens.reduce((a, i) => a.plus(i.valor), dec(0));
  if (total.isZero()) return [];
  const ordenados = [...itens].sort((a, b) => b.valor.comparedTo(a.valor));
  let acumulado = dec(0);
  return ordenados.map((i) => {
    const anterior = acumulado;
    const percentual = i.valor.div(total).times(100);
    acumulado = acumulado.plus(percentual);
    // classe decidida pelo acumulado ANTES do item: quem cruza o limite ainda pertence à classe superior
    const classe = anterior.lt(limiteA) ? "A" : anterior.lt(limiteB) ? "B" : "C";
    return { chave: i.chave, valor: i.valor, percentual, acumulado, classe };
  });
}
