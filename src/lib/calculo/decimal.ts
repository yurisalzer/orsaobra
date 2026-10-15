import Decimal from "decimal.js";

/**
 * Instância Decimal isolada para cálculos financeiros.
 * Precisão de 40 dígitos significativos: nenhum cálculo intermediário de
 * orçamento chega perto desse limite, então o arredondamento só ocorre onde
 * a regra de negócio manda (ver `arredondar`).
 */
export const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export type Dec = InstanceType<typeof D>;

export type ModoArredondamento = "ARREDONDAR" | "TRUNCAR";

export function dec(v: Decimal.Value | Dec): Dec {
  return new D(v as Decimal.Value);
}

/** Arredonda (meio para cima) ou trunca para `casas` decimais. */
export function arredondar(v: Decimal.Value, casas = 2, modo: ModoArredondamento = "ARREDONDAR"): Dec {
  const d = dec(v);
  return d.toDecimalPlaces(casas, modo === "TRUNCAR" ? D.ROUND_DOWN : D.ROUND_HALF_UP);
}

/**
 * Converte texto numérico de planilhas/arquivos oficiais em Decimal sem
 * passar por float. Aceita "1.234,56", "1234,56", "1234.56" e números.
 * Retorna null para vazio/ausente — ausência NUNCA vira zero.
 */
export function lerNumero(entrada: unknown): Dec | null {
  if (entrada === null || entrada === undefined) return null;
  if (typeof entrada === "number") {
    if (!Number.isFinite(entrada)) return null;
    // toString preserva a menor representação exata do valor lido da célula
    return dec(entrada.toString());
  }
  let s = String(entrada).trim();
  if (s === "" || s === "-") return null;
  s = s.replace(/^R\$\s*/i, "").replace(/\s/g, "");
  const temVirgula = s.includes(",");
  const temPonto = s.includes(".");
  if (temVirgula && temPonto) {
    // o separador decimal é o que aparece por último
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
  } else if (temVirgula) {
    if ((s.match(/,/g) ?? []).length > 1) return null;
    s = s.replace(",", ".");
  }
  if (!/^[+-]?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(s)) return null;
  return dec(s);
}

const fmtBRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Formata em moeda brasileira (R$ 1.234,56). Arredonda para exibição apenas. */
export function formatarMoeda(v: Decimal.Value | Dec): string {
  const d = arredondar(v as Decimal.Value, 2);
  // Intl recebe string para não perder precisão em valores grandes
  return fmtBRL.format(d.toString() as unknown as number);
}

/** Formata número com separadores brasileiros e `casas` decimais fixas. */
export function formatarNumero(v: Decimal.Value | Dec, casas = 2): string {
  const d = arredondar(v as Decimal.Value, casas);
  const [int, frac] = d.toFixed(casas).split(".");
  const neg = int.startsWith("-");
  const digitos = neg ? int.slice(1) : int;
  const comMilhar = digitos.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return (neg ? "-" : "") + comMilhar + (casas > 0 ? "," + frac : "");
}

/** Percentual "25,00%" a partir de 25 (não de 0,25). */
export function formatarPercentual(v: Decimal.Value | Dec, casas = 2): string {
  return formatarNumero(v, casas) + "%";
}
