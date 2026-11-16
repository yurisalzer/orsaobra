import { describe, expect, it } from "vitest";
import { quantidadeDaMemoria } from "@/lib/calculo/memoria";

describe("resultado da memória de cálculo", () => {
  it("sem resultado digitado: arredonda para 2 casas, sem aviso", () => {
    const r = quantidadeDaMemoria("4 x 12,20 x 0,3 x 0,3 + 1,6");
    expect(r).toMatchObject({ quantidade: "5,99", aviso: null, erro: null });
    expect(r.nota).toBe("conta: 5,992, arredondada para 2 casas decimais");
    expect(quantidadeDaMemoria("2 x 3")).toMatchObject({ quantidade: "6,00", nota: null, aviso: null });
  });
  it("segue as casas digitadas no resultado (inclusive o zero final)", () => {
    // 19,896 escrito como 19,9 (1 casa) — sem aviso
    expect(quantidadeDaMemoria("19,896 = 19,9")).toMatchObject({ quantidade: "19,90", aviso: null });
    expect(quantidadeDaMemoria("19,896 = 19,90")).toMatchObject({ quantidade: "19,90", aviso: null });
    expect(quantidadeDaMemoria("19,896 = 19,896")).toMatchObject({ quantidade: "19,896", nota: null, aviso: null });
    // "= 4 unidades": inteiro
    expect(quantidadeDaMemoria("19,90 m³ / 5,00 m³ = 4 unidades")).toMatchObject({ quantidade: "4,00", aviso: null });
    expect(quantidadeDaMemoria("1,23456 = 1,2346")).toMatchObject({ quantidade: "1,2346", aviso: null });
    // até 4 casas
    expect(quantidadeDaMemoria("1/3 = 0,333333").quantidade).toBe("0,3333");
  });
  it("avisa só quando o resultado digitado difere da conta arredondada", () => {
    expect(quantidadeDaMemoria("19,896 = 19,8").aviso).toBe('o resultado escrito após "=" (19,8) difere do calculado (19,9)');
    expect(quantidadeDaMemoria("3,4 = 4").aviso).toMatch(/\(4\) difere do calculado \(3\)/);
  });
});
