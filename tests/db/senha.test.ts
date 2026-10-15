import { describe, expect, it } from "vitest";
import { conferirSenha, gerarHashSenha, validarForcaSenha } from "@/lib/auth/senha";

describe("senhas", () => {
  it("hash e conferência", async () => {
    const h = await gerarHashSenha("Senha12345");
    expect(h).not.toContain("Senha12345");
    expect(await conferirSenha("Senha12345", h)).toBe(true);
    expect(await conferirSenha("errada1234", h)).toBe(false);
    expect(await conferirSenha("Senha12345", null)).toBe(false);
  });
  it("política mínima", () => {
    expect(validarForcaSenha("curta1")).not.toBeNull();
    expect(validarForcaSenha("somenteletras")).not.toBeNull();
    expect(validarForcaSenha("letras12345")).toBeNull();
  });
});
