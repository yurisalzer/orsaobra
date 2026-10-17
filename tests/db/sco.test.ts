import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { executorPg, type Executor } from "@/lib/banco/executor";
import { adicionarItem, carregarRevisao, criarEtapa, criarObra, criarOrcamento } from "@/lib/orcamento/servico";
import { buscarItens } from "@/lib/referencia/busca";
import { celula } from "@/lib/relatorios/documento";
import { montarRelatorio } from "@/lib/relatorios/montar";
import { arquivo, SCO_XLSX } from "../importacao/ajuda";
import { prisma } from "./ajuda";
import { carregarAmostras, importarPublicar } from "./carga";

let ex: Executor;
let u: string;
let rev: string;
const idDe = async (codigo: string) => (await prisma.itemReferencia.findFirstOrThrow({ where: { codigo, fonte: { codigo: "SCO" } } })).id;

beforeAll(async () => {
  ex = await executorPg(process.env.DATABASE_URL!);
  const c = await carregarAmostras(ex);
  u = c.usuarioId;
  rev = (await importarPublicar(ex, SCO_XLSX().map((p) => arquivo(p)), u)).baseRevisaoId;
});
afterAll(async () => { await ex.encerrar?.(); await prisma.$disconnect(); });

describe("SCO-Rio no banco", () => {
  it("importa e publica: 09/2026, dois regimes, composições com componentes", async () => {
    const b = await prisma.baseRevisao.findUniqueOrThrow({ where: { id: rev }, include: { base: { include: { fonte: true } } } });
    expect(b).toMatchObject({ status: "PUBLICADA", base: { fonte: { codigo: "SCO" } } });
    expect(b.base.competencia.toISOString().slice(0, 7)).toBe("2026-09");
    const bc = await prisma.baseComposicao.count({ where: { baseRevisaoId: rev } });
    expect(bc).toBe(10);
  });

  it("busca pelo código do SCO (com espaço) e por regime", async () => {
    const r = await buscarItens(ex, { texto: "ad 05.05", revisoes: [rev], incluirProprios: false });
    expect(r.itens.map((i) => i.codigo)).toEqual(["AD 05.05.0050 (/)", "AD 05.05.0650 (B)", "AD 05.05.0706 (A)"]);
    expect(r.itens.every((i) => i.temAnalitica)).toBe(true);
    const sem = await buscarItens(ex, { texto: "sondagem", revisoes: [rev], incluirProprios: false, regimeAdotado: [{ revisaoId: rev, regime: "SEM_DESONERACAO" }] });
    const com = await buscarItens(ex, { texto: "sondagem", revisoes: [rev], incluirProprios: false, regimeAdotado: [{ revisaoId: rev, regime: "COM_DESONERACAO" }] });
    expect(sem.itens.filter((i) => i.tipo === "COMPOSICAO").map((i) => i.codigo)).toEqual(["AD 05.05.0706 (A)", "AD 05.10.0050 (/)"]);
    expect(com.itens.filter((i) => i.tipo === "COMPOSICAO").map((i) => i.codigo)).toEqual(["AD 04.05.0706 (A)", "AD 04.10.0050 (/)"]);
  });

  it("orçamento sem e com desoneração; CPU mostra a composição e o percentual sobre a mão de obra", async () => {
    const obra = await criarObra(ex, { nome: "Escola municipal" }, u);
    const o = await criarOrcamento(ex, { obraId: obra, titulo: "Sondagens", bases: [{ baseRevisaoId: rev, regime: "SEM_DESONERACAO" }] }, u);
    let v = (await carregarRevisao(ex, o.revisaoId)).revisao.versao;
    const et = await criarEtapa(ex, o.revisaoId, v, { titulo: "Sondagens" }, u); v = et.versao;
    const a = await adicionarItem(ex, o.revisaoId, v, { etapaId: et.id, itemReferenciaId: await idDe("AD 05.05.0706 (A)"), quantidade: "10" }, u); v = a.versao;
    await expect(adicionarItem(ex, o.revisaoId, v, { etapaId: et.id, itemReferenciaId: await idDe("AD 04.05.0706 (A)"), quantidade: "1" }, u)).rejects.toThrow(/apenas no regime "Com desoneração/);
    const e = await carregarRevisao(ex, o.revisaoId);
    expect(e.itens[0]).toMatchObject({ fonte: "SCO", codigo: "AD 05.05.0706 (A)", custoUnitario: "194.9800", precoTotal: "1949.80" });
    expect(e.itens[0].referenciaPreco).toMatch(/^SCO RJ 09\/2026 — Sem desoneração \(onerado\)/);
    const cpu = await montarRelatorio(ex, o.revisaoId, "cpu", { emitidoPor: "Teste" });
    const linhas = cpu.secoes[0].tabela!.linhas.map((l) => l.celulas.map((c) => celula(c).valor));
    expect(linhas.find((x) => x[1] === "EVE000050")).toMatchObject({ 4: "%", 5: "3.0000000000", 7: "3,00% s/ MO", 8: "" });
    expect(linhas.find((x) => x[1] === "MOD002450")).toMatchObject({ 5: "2.5000000000", 7: "27.61", 8: "69.03" });
    expect(linhas.find((x) => String(x[0]).startsWith("Soma dos componentes"))).toEqual(["Soma dos componentes (sem o percentual sobre a mão de obra)", "189.29"]);

    const o2 = await criarOrcamento(ex, { obraId: obra, titulo: "Sondagens desonerado", bases: [{ baseRevisaoId: rev, regime: "COM_DESONERACAO" }] }, u);
    let v2 = (await carregarRevisao(ex, o2.revisaoId)).revisao.versao;
    const et2 = await criarEtapa(ex, o2.revisaoId, v2, { titulo: "Sondagens" }, u); v2 = et2.versao;
    await adicionarItem(ex, o2.revisaoId, v2, { etapaId: et2.id, itemReferenciaId: await idDe("AD 04.05.0706 (A)"), quantidade: "10" }, u);
    expect((await carregarRevisao(ex, o2.revisaoId)).itens[0]).toMatchObject({ custoUnitario: "183.5500", precoTotal: "1835.50" });
  });
});
