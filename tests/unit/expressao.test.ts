import { describe, expect, it } from "vitest";
import { avaliarMemoria, ErroExpressao } from "@/lib/calculo/expressao";

const v = (t: string) => avaliarMemoria(t)?.valor.toString();

describe("memória de cálculo do quantitativo", () => {
  it("exemplo real do usuário (unidades e comentários ignorados)", () => {
    const r = avaliarMemoria("(30m (comprimento) + 20m (largura)) x 2 (perimetro) x 2m (altura) = 100m²")!;
    expect(r.valor.toString()).toBe("200");
    expect(r.escrito?.toString()).toBe("100"); // resultado escrito difere → a tela avisa
    expect(r.expressoes).toEqual(["(30 + 20) × 2 × 2"]);
  });
  it("operadores, decimais brasileiros e precedência", () => {
    expect(v("2,5 x 4")).toBe("10");
    expect(v("1.234,56 + 0,44")).toBe("1235");
    expect(v("10 - 2 * 3")).toBe("4");
    expect(v("(10 - 2) × 3")).toBe("24");
    expect(v("9 ÷ 4")).toBe("2.25");
    expect(v("12/5")).toBe("2.4");
    expect(v("2(3+4)")).toBe("14");
    expect(v("-3 + 5")).toBe("2");
    expect(v("0,1 + 0,2")).toBe("0.3"); // sem erro de ponto flutuante
  });
  it("unidades com dígitos (m2, m3) não viram números", () => {
    expect(v("12 m2 x 3")).toBe("36");
    expect(v("Volume: 2 x 3 x 0,5 m3 = 3 m3")).toBe("3");
    expect(v("Área 25,5m²")).toBe("25.5");
  });
  it("várias linhas são somadas", () => {
    const r = avaliarMemoria("Parede A: 3 x 2,80 = 8,40\nParede B: 4,5 x 2,80 = 12,60\nDesconto porta: -0,80 x 2,10")!;
    expect(r.valor.toString()).toBe("19.32");
    expect(r.expressoes).toHaveLength(3);
  });
  it("texto sem conta não gera valor; conta malformada gera erro claro", () => {
    expect(avaliarMemoria("Conforme projeto arquitetônico")).toBeNull();
    expect(avaliarMemoria("")).toBeNull();
    expect(() => avaliarMemoria("(2 + 3")).toThrow(ErroExpressao);
    expect(() => avaliarMemoria("2 + 3)")).toThrow(/sem abertura/);
    expect(() => avaliarMemoria("4 / 0")).toThrow(/Divisão por zero/);
    expect(() => avaliarMemoria("linha boa 2 x 3\n5 x")).toThrow(/Linha 2/);
  });
  it("palavras com x não são multiplicação", () => {
    expect(v("3 caixas x 2")).toBe("6");
    expect(v("2 xícaras")).toBe("2");
  });
  it("texto entre aspas simples não entra na conta", () => {
    expect(v("'Eixo 1-2 / trecho 3+4': 12,5 x 3")).toBe("37.5");
    expect(v("2 x 3 'acréscimo de 10% = 0,6'")).toBe("6");
    // "=" dentro das aspas não é o resultado escrito
    const r = avaliarMemoria("'Pav. 2 = cobertura' 4 x 5 = 20")!;
    expect(r.valor.toString()).toBe("20");
    expect(r.escrito?.toString()).toBe("20");
    // aspas tipográficas (Word) e aspas não fechadas (texto até o fim da linha)
    expect(v("‘Bloco 3*4’ 7 + 1")).toBe("8");
    expect(v("10 x 2 'obs: 5 + 5")).toBe("20");
    expect(avaliarMemoria("'Ver prancha 03/12 - 2 + 2'")).toBeNull();
  });
});
