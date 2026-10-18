import { describe, expect, it } from "vitest";
import { formatarCpf, normalizarCpf, normalizarTelefone } from "@/lib/auth/cadastro";
import { htmlDeTexto } from "@/lib/email/enviar";

describe("CPF", () => {
  it("aceita CPF válido com ou sem pontuação", () => {
    expect(normalizarCpf("529.982.247-25")).toBe("52998224725");
    expect(normalizarCpf("52998224725")).toBe("52998224725");
    expect(normalizarCpf("111.444.777-35")).toBe("11144477735");
    expect(formatarCpf("52998224725")).toBe("529.982.247-25");
  });
  it("recusa dígito verificador errado, sequências repetidas e tamanho errado", () => {
    expect(normalizarCpf("529.982.247-24")).toBeNull();
    expect(normalizarCpf("111.111.111-11")).toBeNull();
    expect(normalizarCpf("1234567890")).toBeNull();
    expect(normalizarCpf("")).toBeNull();
  });
});

describe("telefone", () => {
  it("formata celular e fixo com DDD; vazio é opcional", () => {
    expect(normalizarTelefone("21987654321")).toBe("(21) 98765-4321");
    expect(normalizarTelefone("(21) 2222-3333")).toBe("(21) 2222-3333");
    expect(normalizarTelefone("+55 21 98765-4321")).toBe("(21) 98765-4321");
    expect(normalizarTelefone("  ")).toBe("");
    expect(normalizarTelefone("98765")).toBeNull();
  });
});

describe("HTML do e-mail", () => {
  it("escapa o texto e transforma URLs em links", () => {
    const h = htmlDeTexto("Olá <b>x</b>\n\nhttps://a.b/c?token=1");
    expect(h).toContain("&lt;b&gt;");
    expect(h).toContain('<a href="https://a.b/c?token=1">');
  });
});
