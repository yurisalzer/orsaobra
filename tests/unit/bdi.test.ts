import { describe, expect, it } from "vitest";
import { calcularBdi } from "@/lib/calculo/bdi";
import { calcularItem } from "@/lib/calculo/item";

describe("BDI (fórmula TCU 2.622/2013)", () => {
  it("confere com cálculo independente", () => {
    const r = calcularBdi([
      { tipo: "AC", nome: "Administração central", percentual: "4" },
      { tipo: "S", nome: "Seguro", percentual: "0.4" },
      { tipo: "G", nome: "Garantia", percentual: "0.4" },
      { tipo: "R", nome: "Risco", percentual: "1.27" },
      { tipo: "DF", nome: "Despesas financeiras", percentual: "1.23" },
      { tipo: "L", nome: "Lucro", percentual: "7.4" },
      { tipo: "I", nome: "PIS", percentual: "0.65" },
      { tipo: "I", nome: "COFINS", percentual: "3" },
      { tipo: "I", nome: "ISS", percentual: "2" },
    ]);
    // valor calculado independentemente (Python decimal, 40 dígitos)
    expect(r.bdi.toDecimalPlaces(10).toString()).toBe("22.2261641908");
    expect(r.somas.I.toString()).toBe("5.65");
  });
  it("BDI zero quando não há parcelas", () => {
    expect(calcularBdi([]).bdi.isZero()).toBe(true);
  });
  it("rejeita tributos >= 100% e parcelas negativas", () => {
    expect(() => calcularBdi([{ tipo: "I", nome: "x", percentual: "100" }])).toThrow();
    expect(() => calcularBdi([{ tipo: "L", nome: "x", percentual: "-1" }])).toThrow();
  });
});

describe("cálculo de item", () => {
  it("BDI individual por item", () => {
    const global = calcularItem({ quantidade: "10", custoUnitario: "100", bdiPercentual: "25" });
    const diferenciado = calcularItem({ quantidade: "10", custoUnitario: "100", bdiPercentual: "15.28" });
    expect(global.precoUnitario.toString()).toBe("125");
    expect(global.precoTotal.toString()).toBe("1250");
    expect(diferenciado.precoUnitario.toString()).toBe("115.28");
    expect(diferenciado.precoTotal.toString()).toBe("1152.8");
  });
  it("arredonda PU antes de multiplicar pela quantidade", () => {
    // 33.333 → CU 33.33; PU = 33.33 × 1.2222 = 40.735926 → 40.74; total = 3 × 40.74
    const r = calcularItem({ quantidade: "3", custoUnitario: "33.333", bdiPercentual: "22.22" });
    expect(r.custoUnitario.toString()).toBe("33.33");
    expect(r.precoUnitario.toString()).toBe("40.74");
    expect(r.precoTotal.toString()).toBe("122.22");
  });
  it("modo truncar", () => {
    const r = calcularItem({ quantidade: "1.5", custoUnitario: "10.999", bdiPercentual: "10" }, "TRUNCAR");
    expect(r.custoUnitario.toString()).toBe("10.99");
    expect(r.precoUnitario.toString()).toBe("12.08"); // 12.089 truncado
    expect(r.precoTotal.toString()).toBe("18.12"); // 18.12
  });
  it("quantidade com 4 casas e valores grandes sem perda", () => {
    const r = calcularItem({ quantidade: "123456.7891", custoUnitario: "98765.43", bdiPercentual: "0" });
    expect(r.precoTotal.toString()).toBe("12193262861.88") // conferido com Python decimal;
  });
});
