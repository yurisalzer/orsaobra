import { describe, expect, it } from "vitest";
import { formatarCoeficiente, formatarPreco } from "@/lib/formato/precos";

describe("formatação de preços e coeficientes", () => {
  it("preço com 2 ou 4 casas conforme publicado", () => {
    expect(formatarPreco("211.9700")).toBe("R$ 211,97");
    expect(formatarPreco("15.2608")).toBe("R$ 15,2608");
    expect(formatarPreco("751642.5000")).toBe("R$ 751.642,50");
    expect(formatarPreco(null)).toBe("—");
  });
  it("coeficiente", () => {
    expect(formatarCoeficiente("1.2790000000")).toBe("1,279");
    expect(formatarCoeficiente("2.0000000000")).toBe("2,00");
    expect(formatarCoeficiente("0.0000001000")).toBe("0,0000001");
  });
});
