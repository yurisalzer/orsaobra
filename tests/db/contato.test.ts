import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { executorPg, type Executor } from "@/lib/banco/executor";
import { enviarContato } from "@/lib/contato/contato";
import { limparBanco, prisma } from "./ajuda";

let ex: Executor;
let u: { id: string; email: string };
const ok = { nome: "Maria Souza", contato: "21987654321", email: "maria@exemplo.com", modulo: "Orçamentos", mensagem: "Como importo um orçamento em PDF?" };

beforeAll(async () => {
  delete process.env.RESEND_API_KEY;
  delete process.env.CONTATO_EMAIL;
  ex = await executorPg(process.env.DATABASE_URL!);
  await limparBanco();
  const x = await prisma.usuario.create({ data: { email: "maria@exemplo.com", nome: "Maria", senhaHash: "x" } });
  u = { id: x.id, email: x.email };
});
afterAll(async () => { await ex.encerrar?.(); await prisma.$disconnect(); });

describe("formulário de contato", () => {
  it("valida os campos", async () => {
    await expect(enviarContato(ex, { ...ok, nome: "" }, u)).rejects.toThrow(/nome/);
    await expect(enviarContato(ex, { ...ok, email: "x" }, u)).rejects.toThrow(/e-mail válido/);
    await expect(enviarContato(ex, { ...ok, contato: "123" }, u)).rejects.toThrow(/Telefone/);
    await expect(enviarContato(ex, { ...ok, modulo: "Qualquer" }, u)).rejects.toThrow(/módulo/);
    await expect(enviarContato(ex, { ...ok, mensagem: "" }, u)).rejects.toThrow(/mensagem/);
  });

  it("envia para yurisalzer@gmail.com com os dados e registra; telefone é opcional", async () => {
    expect(await enviarContato(ex, ok, u)).toBe("NAO_CONFIGURADO");
    const e = await prisma.emailSaida.findFirstOrThrow({ where: { motivo: "CONTATO" } });
    expect(e).toMatchObject({ para: "yurisalzer@gmail.com", assunto: "[Contato — Orçamentos] Maria Souza" });
    expect(e.texto).toContain("Telefone: (21) 98765-4321");
    expect(e.texto).toContain("E-mail: maria@exemplo.com");
    expect(e.texto).toContain("Como importo um orçamento em PDF?");
    await enviarContato(ex, { ...ok, contato: "" }, u);
    expect(await prisma.auditoria.count({ where: { acao: "CONTATO_ENVIADO", usuarioId: u.id } })).toBe(2);
  });

  it("limita a 10 mensagens por hora por usuário", async () => {
    for (let i = 0; i < 8; i++) await enviarContato(ex, ok, u);
    await expect(enviarContato(ex, ok, u)).rejects.toThrow(/Muitas mensagens/);
  });
});
