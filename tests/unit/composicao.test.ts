import { describe, expect, it } from "vitest";
import { custoComposicao, encontrarCiclo, PrecoAusenteError, ReferenciaCircularError, type FonteDeDados } from "@/lib/calculo/composicao";
import { dec } from "@/lib/calculo/decimal";
import { curvaAbc } from "@/lib/calculo/abc";
import { numerarEtapas } from "@/lib/calculo/numeracao";

function fonte(comps: Record<string, [string, string][]>, precos: Record<string, string>): FonteDeDados {
  return {
    componentes: (i) => (comps[i] ? comps[i].map(([item, coeficiente]) => ({ item, coeficiente })) : null),
    preco: (i) => (precos[i] !== undefined ? dec(precos[i]) : null),
  };
}

describe("composições", () => {
  it("múltiplos componentes e subcomposição", () => {
    const f = fonte(
      { C1: [["I1", "0.5"], ["I2", "2.25"], ["C2", "1.1"]], C2: [["I1", "0.1234567"], ["I3", "3"]] },
      { I1: "10.00", I2: "3.33", I3: "0.01" },
    );
    const r = custoComposicao("C1", f);
    // C2 = 0.1234567×10 + 3×0.01 = 1.264567 ; C1 = 5 + 7.4925 + 1.1×1.264567 = 13.8835237
    expect(r.custo.toString()).toBe("13.8835237");
    expect(r.linhas).toHaveLength(3);
  });
  it("usa preço publicado da subcomposição quando preferido", () => {
    const f = fonte({ C1: [["C2", "2"]], C2: [["I1", "1"]] }, { I1: "10", C2: "11.11" });
    expect(custoComposicao("C1", f, { preferirPrecoPublicado: true }).custo.toString()).toBe("22.22");
    expect(custoComposicao("C1", f).custo.toString()).toBe("20");
  });
  it("preço ausente gera erro (não é tratado como zero)", () => {
    const f = fonte({ C1: [["I1", "1"], ["I9", "1"]] }, { I1: "10" });
    expect(() => custoComposicao("C1", f)).toThrow(PrecoAusenteError);
  });
  it("preço zerado publicado é aceito como zero", () => {
    const f = fonte({ C1: [["I1", "1"], ["I2", "5"]] }, { I1: "10", I2: "0" });
    expect(custoComposicao("C1", f).custo.toString()).toBe("10");
  });
  it("detecta referência circular", () => {
    const g: Record<string, string[]> = { A: ["B"], B: ["C"], C: ["A"], D: ["E"] };
    expect(encontrarCiclo("A", (n) => g[n] ?? null)).toEqual(["A", "B", "C", "A"]);
    expect(encontrarCiclo("D", (n) => g[n] ?? null)).toBeNull();
    const f = fonte({ A: [["B", "1"]], B: [["A", "1"]] }, {});
    expect(() => custoComposicao("A", f)).toThrow(ReferenciaCircularError);
  });
});

describe("curva ABC", () => {
  it("classifica por acumulado", () => {
    const r = curvaAbc([
      { chave: "x", valor: dec(70) }, { chave: "y", valor: dec(20) },
      { chave: "z", valor: dec(6) }, { chave: "w", valor: dec(4) },
    ]);
    expect(r.map((l) => `${l.chave}${l.classe}`)).toEqual(["xA", "yA", "zB", "wC"]);
    expect(r[3].acumulado.toString()).toBe("100");
  });
});

describe("numeração de etapas", () => {
  it("gera 1, 1.1, 1.2, 2", () => {
    const n = numerarEtapas([
      { id: "b", paiId: null, ordem: 2 }, { id: "a", paiId: null, ordem: 1 },
      { id: "a2", paiId: "a", ordem: 2 }, { id: "a1", paiId: "a", ordem: 1 },
    ]);
    expect(Object.fromEntries(n)).toEqual({ a: "1", a1: "1.1", a2: "1.2", b: "2" });
  });
});
