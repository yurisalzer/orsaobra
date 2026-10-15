import { describe, expect, it } from "vitest";
import { arredondar, formatarMoeda, formatarNumero, lerNumero } from "@/lib/calculo/decimal";

describe("lerNumero", () => {
  it("lê formatos brasileiro e internacional sem perda", () => {
    expect(lerNumero("1.234,56")!.toString()).toBe("1234.56");
    expect(lerNumero("1234,56")!.toString()).toBe("1234.56");
    expect(lerNumero("1,234.56")!.toString()).toBe("1234.56");
    expect(lerNumero("0,0000001")!.toString()).toBe("1e-7");
    expect(lerNumero("R$ 10,50")!.toString()).toBe("10.5");
    expect(lerNumero(0.1)!.plus(lerNumero(0.2)!).toString()).toBe("0.3");
  });
  it("ausente não vira zero", () => {
    expect(lerNumero("")).toBeNull();
    expect(lerNumero(null)).toBeNull();
    expect(lerNumero(undefined)).toBeNull();
    expect(lerNumero("-")).toBeNull();
    expect(lerNumero("abc")).toBeNull();
    expect(lerNumero("1,2,3")).toBeNull();
  });
  it("zero explícito é zero", () => {
    expect(lerNumero("0,00")!.isZero()).toBe(true);
  });
});

describe("arredondar", () => {
  it("meio para cima e truncamento", () => {
    expect(arredondar("2.345").toString()).toBe("2.35");
    expect(arredondar("2.344999").toString()).toBe("2.34");
    expect(arredondar("2.349", 2, "TRUNCAR").toString()).toBe("2.34");
    expect(arredondar("-2.345").toString()).toBe("-2.35");
  });
  it("float binário clássico não afeta", () => {
    // 1.005 em float é 1.00499999...; com Decimal a partir de texto é exato
    expect(arredondar("1.005").toString()).toBe("1.01");
  });
});

describe("formatação brasileira", () => {
  it("moeda e número", () => {
    expect(formatarMoeda("1234567.891").replace(/ /g, " ")).toBe("R$ 1.234.567,89");
    expect(formatarNumero("1234.5", 2)).toBe("1.234,50");
    expect(formatarNumero("-0.5", 4)).toBe("-0,5000");
    expect(formatarNumero("999", 0)).toBe("999");
  });
});
