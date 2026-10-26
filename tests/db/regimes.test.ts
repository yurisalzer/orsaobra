import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { executorPg, type Executor } from "@/lib/banco/executor";
import { carregarContrato, criarContratoDaPlanilha, alterarDadosContrato } from "@/lib/contratos/servico";
import { criarRegime, listarRegimes } from "@/lib/contratos/regimes";
import { criarObra } from "@/lib/orcamento/servico";
import { limparBanco, prisma } from "./ajuda";

let ex: Executor;
let u: string;

beforeAll(async () => {
  ex = await executorPg(process.env.DATABASE_URL!);
  await limparBanco();
  u = (await prisma.usuario.create({ data: { email: "regimes@t.com", nome: "Fiscal", senhaHash: "x" } })).id;
});
afterAll(async () => { await ex.encerrar?.(); await prisma.$disconnect(); });

describe("regimes de execução", () => {
  it("os 7 regimes da Lei 14.133 (preço unitário por quantidade, demais por percentual) e cadastro de novo", async () => {
    const r = await listarRegimes(ex);
    expect(r.map((x) => [x.nome, x.medicao])).toEqual([
      ["Empreitada por preço unitário", "QUANTIDADE"], ["Empreitada por preço global", "PERCENTUAL"], ["Empreitada integral (Turnkey)", "PERCENTUAL"],
      ["Contratação por tarefa", "PERCENTUAL"], ["Contratação integrada", "PERCENTUAL"], ["Contratação semi-integrada", "PERCENTUAL"],
      ["Fornecimento e prestação de serviço associado", "PERCENTUAL"],
    ]);
    expect(await listarRegimes(ex)).toHaveLength(7); // idempotente
    const novo = await criarRegime(ex, "  Regime   especial  de teste ", u);
    expect(novo).toMatchObject({ nome: "Regime especial de teste", medicao: "PERCENTUAL", sistema: false });
    await expect(criarRegime(ex, "regime ESPECIAL de teste", u)).rejects.toThrow(/já está cadastrado/);
    await expect(criarRegime(ex, "ab", u)).rejects.toThrow(/Informe o nome/);
    expect((await listarRegimes(ex)).at(-1)!.nome).toBe("Regime especial de teste");

    // contrato com regime
    const obra = await criarObra(ex, { nome: "Obra" }, u);
    const unit = r[0];
    const c = await criarContratoDaPlanilha(ex, { obraId: obra, numero: "R-1", objeto: "Objeto", regimeId: unit.id }, {
      arquivo: "p.xlsx", grupos: [{ chave: "g", titulo: "G", paiChave: null }],
      itens: [{ grupoChave: "g", numero: "1", codigo: null, fonte: null, descricao: "Item", unidade: "UN", quantidade: "1", precoUnitario: "1", total: null }],
    }, u);
    let e = await carregarContrato(ex, c);
    expect(e.contrato).toMatchObject({ regimeId: unit.id, regimeNome: "Empreitada por preço unitário", regimeMedicao: "QUANTIDADE" });
    await alterarDadosContrato(ex, c, e.contrato.versao, { numero: "R-1", objeto: "Objeto", regimeId: novo.id }, u);
    e = await carregarContrato(ex, c);
    expect(e.contrato).toMatchObject({ regimeNome: "Regime especial de teste", regimeMedicao: "PERCENTUAL" });
  });
});
