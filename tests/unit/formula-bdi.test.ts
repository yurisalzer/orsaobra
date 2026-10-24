import { describe, expect, it } from "vitest";
import { calcularBdi, somasBdi } from "@/lib/calculo/bdi";
import { calcularBdiPorFormula, ErroFormulaBdi, variaveisDaFormula } from "@/lib/calculo/formula-bdi";

const parcelas = [
  { tipo: "AC" as const, nome: "Administração central", percentual: "4" }, { tipo: "S" as const, nome: "Seguro", percentual: "0,4".replace(",", ".") },
  { tipo: "G" as const, nome: "Garantia", percentual: "0.4" }, { tipo: "R" as const, nome: "Risco", percentual: "1.27" },
  { tipo: "DF" as const, nome: "Despesas financeiras", percentual: "1.23" }, { tipo: "L" as const, nome: "Lucro", percentual: "7.4" },
  { tipo: "I" as const, nome: "PIS", percentual: "0.65" }, { tipo: "I" as const, nome: "COFINS", percentual: "3" }, { tipo: "I" as const, nome: "ISS", percentual: "2" },
];

describe("fórmula de BDI do usuário", () => {
  it("a fórmula do TCU escrita pelo usuário dá o mesmo resultado do cálculo padrão", () => {
    const tcu = calcularBdi(parcelas).bdi;
    const f = calcularBdiPorFormula("[(1+AC+S+R+G) × (1+DF) × (1+L)] ÷ (1−I) − 1", somasBdi(parcelas));
    expect(f.toString()).toBe(tcu.toString());
    expect(f.toDecimalPlaces(2).toFixed(2)).toBe("22.23");
  });

  it("fórmula alternativa, números brasileiros, minúsculas e potência", () => {
    const s = somasBdi(parcelas);
    // DF somado ao grupo da administração, sem o produto
    expect(calcularBdiPorFormula("(1 + ac + s + r + g + df) * (1 + l) / (1 - i) - 1", s).toDecimalPlaces(4).toString()).toBe("22.1412");
    expect(calcularBdiPorFormula("0,25", s).toString()).toBe("25");
    expect(calcularBdiPorFormula("(1 + L)^2 - 1", s).toDecimalPlaces(4).toString()).toBe("15.3476");
    expect(variaveisDaFormula("(1+AC)*(1+L)-1")).toEqual(["AC", "L"]);
  });

  it("recusa variável desconhecida, sintaxe inválida, divisão por zero e resultado absurdo", () => {
    const s = somasBdi(parcelas);
    expect(() => calcularBdiPorFormula("(1 + X) - 1", s)).toThrow(/"X" não é uma variável/);
    expect(() => calcularBdiPorFormula("(1 + AC", s)).toThrow(/Parêntese não fechado/);
    expect(() => calcularBdiPorFormula("1 / (1 - 1)", s)).toThrow(/Divisão por zero/);
    expect(() => calcularBdiPorFormula("AC - 1", s)).toThrow(/negativo/);
    expect(() => calcularBdiPorFormula("(1 + AC) * 100", s)).toThrow(/1\.000%/);
    expect(() => calcularBdiPorFormula("2 ^ 0,5", s)).toThrow(/expoente/);
    expect(() => calcularBdiPorFormula("1; DROP", s)).toThrow(ErroFormulaBdi);
  });
});
