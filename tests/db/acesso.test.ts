import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { executorPg, type Executor } from "@/lib/banco/executor";
import { acessoA, acessoRevisao, definirAcesso, exigirAcesso, idsComAcesso, listarCompartilhamento } from "@/lib/acesso";
import { criarContratoDaPlanilha } from "@/lib/contratos/servico";
import { criarObra, criarOrcamento } from "@/lib/orcamento/servico";
import { prisma } from "./ajuda";
import { carregarAmostras } from "./carga";

let ex: Executor;
let rev: Record<string, string>;
const usuarios: Record<string, { id: string; permissoes: string[] }> = {};
let orc: { orcamentoId: string; revisaoId: string };
let contrato: string;

const EDITOR = ["ORCAMENTOS_VER", "ORCAMENTOS_EDITAR", "MEDICOES_VER", "MEDICOES_EDITAR"];
async function usuario(nome: string, permissoes: string[]) {
  const u = await prisma.usuario.create({ data: { email: `${nome}@acesso.t`, nome, senhaHash: "x", emailConfirmadoEm: new Date() } });
  await prisma.usuarioPermissao.createMany({ data: permissoes.map((permissao) => ({ usuarioId: u.id, permissao })) });
  usuarios[nome] = { id: u.id, permissoes };
}

beforeAll(async () => {
  ex = await executorPg(process.env.DATABASE_URL!);
  const c = await carregarAmostras(ex);
  rev = c.revisoes;
  await usuario("criador", EDITOR);
  await usuario("colega", EDITOR);
  await usuario("leitor", ["ORCAMENTOS_VER", "MEDICOES_VER"]);
  await usuario("admin", [...EDITOR, "USUARIOS"]);
  const obra = await criarObra(ex, { nome: "Obra do acesso" }, usuarios.criador.id);
  orc = await criarOrcamento(ex, { obraId: obra, titulo: "Orçamento restrito", bases: [{ baseRevisaoId: rev.EMOP, regime: "SEM_DESONERACAO" }] }, usuarios.criador.id);
  contrato = await criarContratoDaPlanilha(ex, { obraId: obra, numero: "900/2026", objeto: "Contrato restrito" }, {
    arquivo: "p.xlsx", grupos: [{ chave: "g", titulo: "G", paiChave: null }],
    itens: [{ grupoChave: "g", numero: "1", codigo: null, fonte: null, descricao: "Item", unidade: "UN", quantidade: "1", precoUnitario: "10", total: null }],
  }, usuarios.criador.id);
});
afterAll(async () => { await ex.encerrar?.(); await prisma.$disconnect(); });

describe("acesso individual a orçamento e contrato", () => {
  it("só criador e administrador entram; os demais não", async () => {
    for (const [recurso, id] of [["orcamento", orc.orcamentoId], ["contrato", contrato]] as const) {
      expect(await acessoA(ex, recurso, id, usuarios.criador)).toMatchObject({ ver: true, editar: true, gerenciar: true });
      expect(await acessoA(ex, recurso, id, usuarios.admin)).toMatchObject({ ver: true, editar: true, gerenciar: true });
      expect(await acessoA(ex, recurso, id, usuarios.colega)).toMatchObject({ ver: false, editar: false, gerenciar: false });
      await expect(exigirAcesso(ex, recurso, id, usuarios.colega, "ver")).rejects.toThrow(/não tem acesso/);
      expect((await idsComAcesso(ex, recurso, usuarios.colega))!.has(id)).toBe(false);
      expect(await idsComAcesso(ex, recurso, usuarios.admin)).toBeNull();
    }
    expect((await acessoRevisao(ex, orc.revisaoId, usuarios.colega))!.ver).toBe(false);
  });

  it("criador concede ver/editar; editar exige a permissão geral; retirar volta a bloquear", async () => {
    await expect(definirAcesso(ex, "orcamento", orc.orcamentoId, usuarios.leitor.id, "VER", usuarios.colega)).rejects.toThrow(/Só quem criou/);
    await definirAcesso(ex, "orcamento", orc.orcamentoId, usuarios.colega.id, "VER", usuarios.criador);
    expect(await acessoA(ex, "orcamento", orc.orcamentoId, usuarios.colega)).toMatchObject({ ver: true, editar: false, gerenciar: false });
    await expect(exigirAcesso(ex, "orcamento", orc.orcamentoId, usuarios.colega, "editar")).rejects.toThrow(/mas não editá-lo/);
    await definirAcesso(ex, "orcamento", orc.orcamentoId, usuarios.colega.id, "EDITAR", usuarios.admin);
    expect(await acessoA(ex, "orcamento", orc.orcamentoId, usuarios.colega)).toMatchObject({ ver: true, editar: true, gerenciar: false });
    // leitor com "editar" concedido continua sem editar: não tem a permissão geral
    await definirAcesso(ex, "orcamento", orc.orcamentoId, usuarios.leitor.id, "EDITAR", usuarios.criador);
    expect(await acessoA(ex, "orcamento", orc.orcamentoId, usuarios.leitor)).toMatchObject({ ver: true, editar: false });
    const lista = await listarCompartilhamento(ex, "orcamento", orc.orcamentoId);
    expect(lista.find((u) => u.id === usuarios.criador.id)).toMatchObject({ criador: true });
    expect(lista.find((u) => u.id === usuarios.colega.id)).toMatchObject({ nivel: "EDITAR", podeEditarGeral: true });
    expect(lista.find((u) => u.id === usuarios.leitor.id)).toMatchObject({ nivel: "EDITAR", podeEditarGeral: false });
    await definirAcesso(ex, "orcamento", orc.orcamentoId, usuarios.colega.id, null, usuarios.criador);
    expect((await acessoA(ex, "orcamento", orc.orcamentoId, usuarios.colega))!.ver).toBe(false);
    await expect(definirAcesso(ex, "orcamento", orc.orcamentoId, usuarios.criador.id, null, usuarios.admin)).rejects.toThrow(/criador sempre/);
    // contrato
    await definirAcesso(ex, "contrato", contrato, usuarios.leitor.id, "VER", usuarios.criador);
    expect((await idsComAcesso(ex, "contrato", usuarios.leitor))!.has(contrato)).toBe(true);
    expect(await prisma.auditoria.count({ where: { acao: { in: ["ACESSO_CONCEDIDO", "ACESSO_RETIRADO"] } } })).toBe(5);
  });
});
