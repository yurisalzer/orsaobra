import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { executorPg, type Executor } from "@/lib/banco/executor";
import { carregarContrato, criarContratoDaPlanilha } from "@/lib/contratos/servico";
import {
  alterarEmpresa, carregarEmpresa, criarEmpresa, definirEmpresaAtiva, empresasParaContrato, listarEmpresas, normalizarCnpj, type DadosEmpresa,
} from "@/lib/empresas/servico";
import { criarObra } from "@/lib/orcamento/servico";
import { limparBanco, prisma } from "./ajuda";

let ex: Executor;
let u: string;
// CNPJs e CPFs válidos (dígitos verificadores conferidos)
const CNPJ = "11.222.333/0001-81";
const CPF = "529.982.247-25";
const rt = { nome: "Maria Souza", titulo: "Engenheira civil", conselho: "CREA" as const, registro: "2012345678", ufRegistro: "RJ", cpf: CPF, email: "Maria@Empresa.com.br", telefone: "22999998888", principal: false };
const base = (): DadosEmpresa => ({
  razaoSocial: "Construtora Exemplo Ltda", nomeFantasia: "Exemplo", cnpj: CNPJ, cep: "27910-000", logradouro: "Rua A", numero: "10", bairro: "Centro", municipio: "Macaé", uf: "rj",
  telefone: "(22) 2772-0000", email: "contato@exemplo.com.br", representanteNome: "João Silva", representanteCpf: CPF, representanteCargo: "Sócio",
  responsaveis: [rt, { ...rt, nome: "Pedro Lima", conselho: "CAU", registro: "A123456-7", principal: true, cpf: null, email: null, telefone: null }],
});

beforeAll(async () => {
  ex = await executorPg(process.env.DATABASE_URL!);
  await limparBanco();
  u = (await prisma.usuario.create({ data: { email: "empresas@t.com", nome: "Fiscal", senhaHash: "x" } })).id;
});
afterAll(async () => { await ex.encerrar?.(); await prisma.$disconnect(); });

describe("cadastro de empresas", () => {
  it("CNPJ pelos dígitos verificadores", () => {
    expect(normalizarCnpj(CNPJ)).toBe("11222333000181");
    expect(normalizarCnpj("11.222.333/0001-82")).toBeNull();
    expect(normalizarCnpj("00.000.000/0000-00")).toBeNull();
  });

  let id: string;
  it("cria com responsáveis técnicos (um principal) e normaliza os dados", async () => {
    id = await criarEmpresa(ex, base(), u);
    const e = await carregarEmpresa(ex, id);
    expect(e).toMatchObject({ cnpj: "11222333000181", uf: "RJ", cep: "27910000", telefone: "(22) 2772-0000", representanteCpf: "52998224725", versao: 1, ativo: true });
    expect(e.responsaveis.map((r) => [r.nome, r.conselho, r.registro, r.principal])).toEqual([["Maria Souza", "CREA", "2012345678", false], ["Pedro Lima", "CAU", "A123456-7", true]]);
    expect(e.responsaveis[0]).toMatchObject({ cpf: "52998224725", email: "maria@empresa.com.br", telefone: "(22) 99999-8888" });
    await expect(criarEmpresa(ex, { ...base(), razaoSocial: "Outra" }, u)).rejects.toThrow(/Já existe empresa cadastrada com o CNPJ 11\.222\.333\/0001-81/);
  });

  it("validações: CNPJ, ao menos um responsável técnico com conselho e registro, CPF e e-mail", async () => {
    const b = { ...base(), cnpj: "04.252.011/0001-10" };
    await expect(criarEmpresa(ex, { ...b, cnpj: "123" }, u)).rejects.toThrow(/CNPJ inválido/);
    await expect(criarEmpresa(ex, { ...b, responsaveis: [] }, u)).rejects.toThrow(/ao menos um responsável técnico/);
    await expect(criarEmpresa(ex, { ...b, responsaveis: [{ ...rt, registro: "" }] }, u)).rejects.toThrow(/número de registro no conselho do responsável técnico 1 \(Maria Souza\)/);
    await expect(criarEmpresa(ex, { ...b, responsaveis: [{ ...rt, cpf: "111.111.111-11" }] }, u)).rejects.toThrow(/CPF inválido/);
    await expect(criarEmpresa(ex, { ...b, responsaveis: [{ ...rt, email: "x@" }] }, u)).rejects.toThrow(/E-mail inválido/);
    // sem principal marcado: o primeiro vira principal
    const id2 = await criarEmpresa(ex, { ...b, razaoSocial: "Segunda Ltda", responsaveis: [rt, { ...rt, nome: "Outro RT" }] }, u);
    expect((await carregarEmpresa(ex, id2)).responsaveis.map((r) => r.principal)).toEqual([true, false]);
  });

  it("edição com controle de versão, busca, desativação e uso no contrato", async () => {
    await alterarEmpresa(ex, id, 1, { ...base(), razaoSocial: "Construtora Exemplo S.A.", responsaveis: [{ ...rt, principal: true }] }, u);
    await expect(alterarEmpresa(ex, id, 1, base(), u)).rejects.toThrow(/alterada por outra pessoa/);
    const e = await carregarEmpresa(ex, id);
    expect(e).toMatchObject({ razaoSocial: "Construtora Exemplo S.A.", versao: 2 });
    expect(e.responsaveis).toHaveLength(1);
    expect((await listarEmpresas(ex, "11222333")).map((x) => x.razaoSocial)).toEqual(["Construtora Exemplo S.A."]);
    expect((await listarEmpresas(ex, "maria")).map((x) => x.responsavel)).toEqual(["Maria Souza — CREA 2012345678/RJ", "Maria Souza — CREA 2012345678/RJ"]);
    const pc = (await empresasParaContrato(ex)).find((x) => x.id === id)!;
    expect(pc.responsaveis[0]).toMatchObject({ nome: "Maria Souza", registro: "CREA 2012345678/RJ", principal: true });
    // contrato ligado à empresa
    const obra = await criarObra(ex, { nome: "Obra" }, u);
    const c = await criarContratoDaPlanilha(ex, { obraId: obra, numero: "1/2026", objeto: "Objeto", empresaId: id, empresa: "Construtora Exemplo S.A.", cnpj: CNPJ, responsavelTecnico: "Maria Souza" }, {
      arquivo: "p.xlsx", grupos: [{ chave: "g", titulo: "G", paiChave: null }],
      itens: [{ grupoChave: "g", numero: "1", codigo: null, fonte: null, descricao: "Item", unidade: "UN", quantidade: "1", precoUnitario: "1", total: null }],
    }, u);
    expect((await carregarContrato(ex, c)).contrato).toMatchObject({ empresaId: id, empresa: "Construtora Exemplo S.A.", responsavelTecnico: "Maria Souza" });
    expect((await listarEmpresas(ex)).find((x) => x.id === id)!.contratos).toBe(1);
    await definirEmpresaAtiva(ex, id, false, u);
    expect((await empresasParaContrato(ex)).some((x) => x.id === id)).toBe(false);
    expect((await listarEmpresas(ex, "", false)).some((x) => x.id === id)).toBe(false);
    expect(await prisma.auditoria.count({ where: { entidadeId: id, acao: { in: ["EMPRESA_CRIADA", "EMPRESA_ALTERADA", "EMPRESA_DESATIVADA"] } } })).toBe(3);
  });
});
