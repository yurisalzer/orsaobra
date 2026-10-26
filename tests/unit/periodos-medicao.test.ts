import { describe, expect, it } from "vitest";
import { diasEntre, gerarPeriodos, somarMeses } from "@/lib/medicoes/periodos";

describe("períodos das medições", () => {
  it("serviço contínuo: mensais dia a dia (10/10/2026 a 09/11/2026...)", () => {
    expect(gerarPeriodos("2026-10-10", 3, true, 0)).toEqual([
      { inicio: "2026-10-10", fim: "2026-11-09" },
      { inicio: "2026-11-10", fim: "2026-12-09" },
      { inicio: "2026-12-10", fim: "2027-01-09" },
    ]);
    // dia que não existe no mês: fica no último dia
    expect(somarMeses("2027-01-31", 1)).toBe("2027-02-28");
    expect(gerarPeriodos("2027-01-31", 2, true, 0)).toEqual([
      { inicio: "2027-01-31", fim: "2027-02-27" },
      { inicio: "2027-02-28", fim: "2027-03-30" },
    ]);
    // 12 medições cobrem exatamente um ano
    expect(gerarPeriodos("2026-10-10", 12, true, 0).at(-1)).toEqual({ inicio: "2027-09-10", fim: "2027-10-09" });
  });

  it("demais objetos: N medições de D dias corridos", () => {
    const p = gerarPeriodos("2026-10-10", 10, false, 30);
    expect(p).toHaveLength(10);
    expect(p[0]).toEqual({ inicio: "2026-10-10", fim: "2026-11-08" });
    expect(p[1]).toEqual({ inicio: "2026-11-09", fim: "2026-12-08" });
    expect(p.every((x) => diasEntre(x.inicio, x.fim) === 30)).toBe(true);
    expect(diasEntre("2026-10-10", "2026-10-10")).toBe(1);
  });
});
