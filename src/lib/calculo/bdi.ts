import { D, type Dec, dec } from "./decimal";

export type TipoParcelaBdi = "AC" | "S" | "R" | "G" | "DF" | "L" | "I";

export interface ParcelaBdi {
  tipo: TipoParcelaBdi;
  nome: string;
  /** Em pontos percentuais: 5 = 5% */
  percentual: string | number | Dec;
}

export interface DemonstrativoBdi {
  /** Soma por tipo, em pontos percentuais */
  somas: Record<TipoParcelaBdi, Dec>;
  /** BDI resultante em pontos percentuais, sem arredondamento */
  bdi: Dec;
  formula: string;
}

/**
 * Fórmula do Acórdão TCU 2.622/2013 (Plenário):
 *   BDI = [ (1 + AC + S + R + G) × (1 + DF) × (1 + L) ] / (1 − I) − 1
 * Parcelas do mesmo tipo são somadas (ex.: PIS + COFINS + ISS em I).
 */
export function calcularBdi(parcelas: ParcelaBdi[]): DemonstrativoBdi {
  const somas: Record<TipoParcelaBdi, Dec> = {
    AC: dec(0), S: dec(0), R: dec(0), G: dec(0), DF: dec(0), L: dec(0), I: dec(0),
  };
  for (const p of parcelas) {
    const v = dec(p.percentual as string);
    if (v.isNegative()) throw new Error(`Parcela de BDI negativa: ${p.nome}`);
    somas[p.tipo] = somas[p.tipo].plus(v);
  }
  const f = (x: Dec) => x.div(100);
  const I = f(somas.I);
  if (I.gte(1)) throw new Error("Tributos (I) devem ser menores que 100%");
  const numerador = new D(1).plus(f(somas.AC)).plus(f(somas.S)).plus(f(somas.R)).plus(f(somas.G))
    .times(new D(1).plus(f(somas.DF)))
    .times(new D(1).plus(f(somas.L)));
  const bdi = numerador.div(new D(1).minus(I)).minus(1).times(100);
  return {
    somas,
    bdi,
    formula: "BDI = [(1+AC+S+R+G)×(1+DF)×(1+L)]/(1−I) − 1",
  };
}
