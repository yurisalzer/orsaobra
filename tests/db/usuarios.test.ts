import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { executorPg, type Executor } from "@/lib/banco/executor";
import { MODELOS } from "@/lib/auth/permissoes";
import { conferirSenha } from "@/lib/auth/senha";
import { criarUsuario, definirAtivo, definirPermissao, listarUsuarios, redefinirSenha, substituirPermissoes } from "@/lib/auth/usuarios";
import { limparBanco, prisma } from "./ajuda";

let ex: Executor;
let admin: string;
let maria: string;

beforeAll(async () => {
  ex = await executorPg(process.env.DATABASE_URL!);
  await limparBanco();
  const a = await prisma.usuario.create({ data: { email: "admin@t.com", nome: "Admin", senhaHash: "x", papel: "ADMIN" } });
  admin = a.id;
  await prisma.usuarioPermissao.createMany({ data: MODELOS[2].permissoes.map((permissao) => ({ usuarioId: admin, permissao })) });
});
afterAll(async () => { await ex.encerrar?.(); await prisma.$disconnect(); });

describe("usuários e permissões", () => {
  it("cria usuário com modelo e valida dados", async () => {
    maria = await criarUsuario(ex, { nome: "Maria", email: " Maria@Exemplo.com ", senha: "SenhaForte2026", permissoes: ["ORCAMENTOS_EDITAR"] }, admin);
    const l = (await listarUsuarios(ex)).find((u) => u.id === maria)!;
    expect(l).toMatchObject({ email: "maria@exemplo.com", ativo: true, ultimoAcesso: null });
    expect(l.permissoes).toEqual(["ORCAMENTOS_EDITAR", "ORCAMENTOS_VER"]); // dependência incluída
    await expect(criarUsuario(ex, { nome: "M2", email: "maria@exemplo.com", senha: "SenhaForte2026", permissoes: [] }, admin)).rejects.toThrow(/Já existe/);
    await expect(criarUsuario(ex, { nome: "M3", email: "m3@exemplo.com", senha: "curta", permissoes: [] }, admin)).rejects.toThrow(/10 caracteres/);
    await expect(criarUsuario(ex, { nome: "M4", email: "sem-arroba", senha: "SenhaForte2026", permissoes: [] }, admin)).rejects.toThrow(/E-mail inválido/);
    const aud = await prisma.auditoria.findFirstOrThrow({ where: { acao: "USUARIO_CRIADO", entidadeId: maria } });
    expect(aud.usuarioId).toBe(admin);
  });

  it("marca e desmarca permissões, respeitando dependências; auditoria antes/depois", async () => {
    // resultado na ordem do catálogo de permissões
    expect(await definirPermissao(ex, maria, "RELATORIOS", true, admin)).toEqual(["ORCAMENTOS_VER", "ORCAMENTOS_EDITAR", "RELATORIOS"]);
    expect(await definirPermissao(ex, maria, "COMPOSICOES", true, admin)).toEqual(["CONSULTA", "ORCAMENTOS_VER", "ORCAMENTOS_EDITAR", "RELATORIOS", "COMPOSICOES"]);
    // retirar "Ver orçamentos" retira o que depende dela
    expect(await definirPermissao(ex, maria, "ORCAMENTOS_VER", false, admin)).toEqual(["CONSULTA", "COMPOSICOES"]);
    const aud = await prisma.auditoria.findFirstOrThrow({ where: { acao: "PERMISSOES_ALTERADAS", entidadeId: maria }, orderBy: { criadoEm: "desc" } });
    expect(aud.depois).toEqual({ permissoes: ["CONSULTA", "COMPOSICOES"] });
    expect(await substituirPermissoes(ex, maria, MODELOS[0].permissoes, admin)).toEqual(["CONSULTA", "ORCAMENTOS_VER", "RELATORIOS"]);
  });

  it("protege o administrador: não retira de si, não se desativa, sempre resta um", async () => {
    await expect(definirPermissao(ex, admin, "USUARIOS", false, admin)).rejects.toThrow(/si mesmo/);
    await expect(substituirPermissoes(ex, admin, MODELOS[1].permissoes, admin)).rejects.toThrow(/si mesmo/);
    await expect(definirAtivo(ex, admin, false, admin)).rejects.toThrow(/próprio usuário/);
    // Maria vira administradora e tenta retirar a permissão do único outro administrador: permitido (ela continua)
    await definirPermissao(ex, maria, "USUARIOS", true, admin);
    await definirPermissao(ex, admin, "USUARIOS", false, maria);
    // agora Maria é a única: ninguém consegue tirar dela, nem desativá-la
    await expect(definirAtivo(ex, maria, false, admin)).rejects.toThrow(/ao menos um usuário ativo/);
    await definirPermissao(ex, admin, "USUARIOS", true, maria);
  });

  it("desativar encerra as sessões; nova senha provisória funciona e desbloqueia", async () => {
    await prisma.sessao.create({ data: { usuarioId: maria, tokenHash: "abc", expiraEm: new Date(Date.now() + 3600_000) } });
    await prisma.usuario.update({ where: { id: maria }, data: { tentativas: 3, bloqueadoAte: new Date(Date.now() + 600_000) } });
    await definirAtivo(ex, maria, false, admin);
    expect(await prisma.sessao.count({ where: { usuarioId: maria } })).toBe(0);
    expect((await prisma.usuario.findUniqueOrThrow({ where: { id: maria } })).ativo).toBe(false);
    await definirAtivo(ex, maria, true, admin);
    const senha = await redefinirSenha(ex, maria, admin);
    expect(senha).toMatch(/^[A-Za-z][A-Za-z2-9]{2}[2-9][A-Za-z2-9]{8}$/);
    const u = await prisma.usuario.findUniqueOrThrow({ where: { id: maria } });
    expect(await conferirSenha(senha, u.senhaHash)).toBe(true);
    expect(u).toMatchObject({ tentativas: 0, bloqueadoAte: null });
  });
});
