import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { executorPg, type Executor } from "@/lib/banco/executor";
import { MODELOS } from "@/lib/auth/permissoes";
import { confirmarEmail, criarCadastro, reenviarConfirmacao } from "@/lib/auth/cadastro";
import { definirAtivo, listarUsuarios } from "@/lib/auth/usuarios";
import { conferirSenha } from "@/lib/auth/senha";
import { limparBanco, prisma } from "./ajuda";

let ex: Executor;
let admin: string;
const URL = "https://orcamento.exemplo";
const ctx = (ip = "10.0.0.1") => ({ ip, urlBase: URL });
const dados = { nome: "João da Silva", email: " Joao@Exemplo.com ", senha: "SenhaForte2026", confirmacaoSenha: "SenhaForte2026", cpf: "529.982.247-25", telefone: "21987654321" };

/** Código do último link de confirmação enviado (lido da caixa de saída). */
async function ultimoToken(para: string) {
  const e = await prisma.emailSaida.findFirstOrThrow({ where: { para, motivo: "CONFIRMACAO" }, orderBy: { criadoEm: "desc" } });
  return /token=([\w-]+)/.exec(e.texto)![1];
}

beforeAll(async () => {
  delete process.env.RESEND_API_KEY;
  ex = await executorPg(process.env.DATABASE_URL!);
  await limparBanco();
  const a = await prisma.usuario.create({ data: { email: "admin@t.com", nome: "Admin", senhaHash: "x", papel: "ADMIN", emailConfirmadoEm: new Date(), aprovadoEm: new Date() } });
  admin = a.id;
  await prisma.usuarioPermissao.createMany({ data: MODELOS[2].permissoes.map((permissao) => ({ usuarioId: admin, permissao })) });
});
afterAll(async () => { await ex.encerrar?.(); await prisma.$disconnect(); });

describe("autocadastro", () => {
  it("valida os dados", async () => {
    await expect(criarCadastro(ex, { ...dados, nome: "João" }, ctx())).rejects.toThrow(/nome completo/);
    await expect(criarCadastro(ex, { ...dados, email: "x" }, ctx())).rejects.toThrow(/e-mail válido/);
    await expect(criarCadastro(ex, { ...dados, cpf: "529.982.247-24" }, ctx())).rejects.toThrow(/CPF inválido/);
    await expect(criarCadastro(ex, { ...dados, telefone: "123" }, ctx())).rejects.toThrow(/Telefone inválido/);
    await expect(criarCadastro(ex, { ...dados, senha: "curta", confirmacaoSenha: "curta" }, ctx())).rejects.toThrow(/10 caracteres/);
    await expect(criarCadastro(ex, { ...dados, confirmacaoSenha: "OutraSenha2026" }, ctx())).rejects.toThrow(/não confere/);
    expect(await prisma.usuario.count()).toBe(1);
  });

  it("cria a conta inativa, sem permissões, senha em hash, e registra o e-mail de confirmação", async () => {
    await criarCadastro(ex, dados, ctx());
    const u = await prisma.usuario.findUniqueOrThrow({ where: { email: "joao@exemplo.com" }, include: { permissoes: true } });
    expect(u).toMatchObject({ nome: "João da Silva", cpf: "52998224725", telefone: "(21) 98765-4321", ativo: false, origem: "AUTOCADASTRO", emailConfirmadoEm: null, aprovadoEm: null });
    expect(u.permissoes).toHaveLength(0);
    expect(u.senhaHash).not.toContain("SenhaForte2026");
    expect(await conferirSenha("SenhaForte2026", u.senhaHash)).toBe(true);
    const e = await prisma.emailSaida.findFirstOrThrow({ where: { para: "joao@exemplo.com" } });
    expect(e).toMatchObject({ motivo: "CONFIRMACAO", status: "NAO_CONFIGURADO" });
    expect(e.texto).toContain(`${URL}/cadastro/confirmar?token=`);
    // o código não fica guardado em texto
    const c = await prisma.confirmacaoEmail.findFirstOrThrow({ where: { usuarioId: u.id } });
    expect(e.texto).not.toContain(c.tokenHash);
  });

  it("e-mail ou CPF repetido não cria outra conta nem revela o cadastro na resposta", async () => {
    await criarCadastro(ex, { ...dados, email: "outro@exemplo.com" }, ctx("10.0.0.2")); // mesmo CPF
    await criarCadastro(ex, { ...dados, cpf: "111.444.777-35" }, ctx("10.0.0.2")); // mesmo e-mail, ainda não confirmado: reenvia
    expect(await prisma.usuario.count()).toBe(2);
    expect(await prisma.emailSaida.findFirst({ where: { para: "outro@exemplo.com", motivo: "CADASTRO_DUPLICADO" } })).not.toBeNull();
    expect(await prisma.emailSaida.count({ where: { para: "joao@exemplo.com", motivo: "CONFIRMACAO" } })).toBe(2);
  });

  it("limita os pedidos por IP", async () => {
    for (let i = 0; i < 3; i++) await reenviarConfirmacao(ex, "ninguem@exemplo.com", ctx("10.9.9.9"));
    await reenviarConfirmacao(ex, "ninguem@exemplo.com", ctx("10.9.9.9"));
    await reenviarConfirmacao(ex, "ninguem@exemplo.com", ctx("10.9.9.9"));
    await expect(reenviarConfirmacao(ex, "ninguem@exemplo.com", ctx("10.9.9.9"))).rejects.toThrow(/Muitas solicitações/);
    expect(await prisma.emailSaida.count({ where: { para: "ninguem@exemplo.com" } })).toBe(0);
  });

  it("confirma o e-mail pelo link (uso único) e avisa os administradores", async () => {
    expect(await confirmarEmail(ex, "codigo-inexistente-000000000000", URL)).toMatchObject({ ok: false });
    const token = await ultimoToken("joao@exemplo.com");
    expect(await confirmarEmail(ex, token, URL)).toEqual({ ok: true, nome: "João da Silva", jaConfirmado: false });
    expect(await confirmarEmail(ex, token, URL)).toMatchObject({ ok: true, jaConfirmado: true });
    const u = await prisma.usuario.findUniqueOrThrow({ where: { email: "joao@exemplo.com" } });
    expect(u.emailConfirmadoEm).not.toBeNull();
    expect(u.ativo).toBe(false); // confirmar não libera o acesso
    const aviso = await prisma.emailSaida.findFirstOrThrow({ where: { para: "admin@t.com", motivo: "NOVO_CADASTRO" } });
    expect(aviso.texto).toContain("529.982.247-25");
    expect(aviso.texto).toContain(`${URL}/usuarios`);
  });

  it("link expirado é recusado", async () => {
    const u = await prisma.usuario.create({ data: { email: "exp@t.com", nome: "Exp Teste", senhaHash: "x", ativo: false, origem: "AUTOCADASTRO" } });
    await reenviarConfirmacao(ex, "exp@t.com", ctx("10.0.0.3"));
    await prisma.confirmacaoEmail.updateMany({ where: { usuarioId: u.id }, data: { expiraEm: new Date(Date.now() - 1000) } });
    expect(await confirmarEmail(ex, await ultimoToken("exp@t.com"), URL)).toMatchObject({ ok: false, mensagem: expect.stringMatching(/expirou/) });
  });

  it("o administrador vê o cadastro pendente e, ao ativar, libera o acesso e o usuário é avisado", async () => {
    const lista = await listarUsuarios(ex);
    const j = lista.find((x) => x.email === "joao@exemplo.com")!;
    expect(lista[0].aprovado).toBe(false); // pendentes primeiro
    expect(j).toMatchObject({ cpf: "529.982.247-25", telefone: "(21) 98765-4321", origem: "AUTOCADASTRO", emailConfirmado: true, aprovado: false, ativo: false });
    await definirAtivo(ex, j.id, true, admin, URL);
    const u = await prisma.usuario.findUniqueOrThrow({ where: { id: j.id } });
    expect(u.ativo).toBe(true);
    expect(u.aprovadoEm).not.toBeNull();
    expect(await prisma.emailSaida.count({ where: { usuarioId: j.id, motivo: "ACESSO_LIBERADO" } })).toBe(1);
    expect(await prisma.auditoria.count({ where: { acao: "ACESSO_LIBERADO", entidadeId: j.id } })).toBe(1);
    // desativar e reativar não manda outro aviso de liberação
    await definirAtivo(ex, j.id, false, admin, URL);
    await definirAtivo(ex, j.id, true, admin, URL);
    expect(await prisma.emailSaida.count({ where: { usuarioId: j.id, motivo: "ACESSO_LIBERADO" } })).toBe(1);
  });
});
