import { formatarNumero } from "../calculo/decimal";

/** Preço como publicado: 2 casas, ou 4 quando a fonte publica 4 (ex.: insumos EMOP). */
export function formatarPreco(valor: string | null | undefined): string {
  if (valor === null || valor === undefined) return "—";
  const [, frac = ""] = valor.split(".");
  const casas = /[1-9]/.test(frac.slice(2)) ? 4 : 2;
  return "R$ " + formatarNumero(valor, casas);
}

/** Coeficiente sem zeros finais desnecessários (mín. 2 casas). */
export function formatarCoeficiente(valor: string): string {
  const [i, f = ""] = valor.split(".");
  const frac = f.replace(/0+$/, "");
  return formatarNumero(`${i}.${frac || "0"}`, Math.max(frac.length, 2));
}

export const NOMES_REGIME: Record<string, string> = {
  SEM_DESONERACAO: "Sem desoneração",
  COM_DESONERACAO: "Com desoneração",
  SEM_ENCARGOS: "Sem encargos sociais",
  "": "Preço único",
};

export const nomeRegime = (c: string | null | undefined) => NOMES_REGIME[c ?? ""] ?? c ?? "Preço único";
