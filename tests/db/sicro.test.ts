import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { executorPg, type Executor } from "@/lib/banco/executor";
import { adicionarItem, carregarRevisao, criarEtapa, criarObra, criarOrcamento, fecharRevisao } from "@/lib/orcamento/servico";
import { buscarItens } from "@/lib/referencia/busca";
import { celula } from "@/lib/relatorios/documento";
import { montarRelatorio } from "@/lib/relatorios/montar";
import { arquivo, SICRO_XLSX } from "../importacao/ajuda";
import { prisma } from "./ajuda";
import { carregarAmostras, importarPublicar } from "./carga";

let ex: Executor;
let u: string;
let rev: Record<string, string>;
const idDe = async (codigo: string) => (await prisma.itemReferencia.findFirstOrThrow({ where: { codigo, fonte: { codigo: "SICRO" } } })).id;
const opc = { emitidoPor: "Teste", agora: new Date("2026-10-17T15:30:00Z") };

beforeAll(async () => {
  ex = await executorPg(process.env.DATABASE_URL!);
  const c = await carregarAmostras(ex);
  u = c.usuarioId;
  rev = c.revisoes;
  const s = await importarPublicar(ex, SICRO_XLSX.map((p) => arquivo(p)), u);
  rev.SICRO = s.baseRevisaoId;
});
afterAll(async () => { await ex.encerrar?.(); await prisma.$disconnect(); });

describe("SICRO no banco", () => {
  it("importa e publica: competência 07/2026, regimes e preços", async () => {
    const b = await prisma.baseRevisao.findUniqueOrThrow({ where: { id: rev.SICRO }, include: { base: { include: { fonte: true } } } });
    expect(b.status).toBe("PUBLICADA");
    expect(b.base.fonte.codigo).toBe("SICRO");
    expect(b.base.competencia.toISOString().slice(0, 7)).toBe("2026-07");
    const precos = await prisma.preco.findMany({ where: { baseRevisaoId: rev.SICRO, item: { codigo: "P9821" } }, include: { regime: true } });
    expect(precos.map((p) => `${p.regime?.codigo}=${p.valor.toString()}`).sort()).toEqual(["COM_DESONERACAO=38.0383", "SEM_DESONERACAO=40.25"]);
    const sem = await prisma.preco.findMany({ where: { baseRevisaoId: rev.SICRO, item: { codigo: "M0104" } } });
    expect(sem).toEqual([]); // "-" na publicação: sem preço
  });

  it("busca para orçamento respeita o regime: composição só no sem desoneração", async () => {
    const semDes = await buscarItens(ex, { texto: "aparelho de apoio", revisoes: [rev.SICRO], incluirProprios: false, regimeAdotado: [{ revisaoId: rev.SICRO, regime: "SEM_DESONERACAO" }] });
    expect(semDes.itens.map((i) => i.codigo).sort()).toEqual(["0307731", "0308308", "M2758"]);
    expect(semDes.itens.filter((i) => i.tipo === "COMPOSICAO").every((i) => i.temAnalitica)).toBe(true);
    const comDes = await buscarItens(ex, { texto: "aparelho de apoio", revisoes: [rev.SICRO], incluirProprios: false, regimeAdotado: [{ revisaoId: rev.SICRO, regime: "COM_DESONERACAO" }] });
    // com desoneração: só o material (preço único); as composições não têm custo publicado nesse regime
    expect(comDes.itens.map((i) => i.codigo)).toEqual(["M2758"]);
  });

  it("orçamento com SICRO + EMOP; relatórios mostram a composição publicada pelo DNIT", async () => {
    const obra = await criarObra(ex, { nome: "Rodovia RJ-000" }, u);
    const o = await criarOrcamento(ex, { obraId: obra, titulo: "Pontes", bases: [{ baseRevisaoId: rev.SICRO, regime: "SEM_DESONERACAO" }, { baseRevisaoId: rev.EMOP, regime: "SEM_DESONERACAO" }] }, u);
    let v = (await carregarRevisao(ex, o.revisaoId)).revisao.versao;
    const et = await criarEtapa(ex, o.revisaoId, v, { titulo: "Aparelhos de apoio" }, u); v = et.versao;
    const a = await adicionarItem(ex, o.revisaoId, v, { etapaId: et.id, itemReferenciaId: await idDe("0308308"), quantidade: "4" }, u); v = a.versao;
    const b = await adicionarItem(ex, o.revisaoId, v, { etapaId: et.id, itemReferenciaId: await idDe("M0798"), quantidade: "10" }, u); v = b.versao;
    const e = await carregarRevisao(ex, o.revisaoId);
    expect(e.itens.find((i) => i.codigo === "0308308")).toMatchObject({ fonte: "SICRO", custoUnitario: "5137.2600", precoTotal: "20549.04" });
    expect(e.itens.find((i) => i.codigo === "0308308")!.referenciaPreco).toMatch(/^SICRO RJ 07\/2026 — Sem desoneração/);
    expect(e.itens.find((i) => i.codigo === "M0798")).toMatchObject({ custoUnitario: "147.6265", precoTotal: "1476.30" });

    const cpu = await montarRelatorio(ex, o.revisaoId, "cpu", opc);
    const s = cpu.secoes.find((x) => x.titulo === "CPU — 0308308")!;
    expect(s.campos!.find((c) => c.rotulo === "Composição")!.valor).toMatch(/DNIT/);
    const vals = s.tabela!.linhas.map((l) => l.celulas.map((c) => celula(c).valor));
    expect(vals.find((x) => x[1] === "E9050")).toEqual(["SICRO", "E9050", expect.stringMatching(/^Guindaste.*improdutiva 0/), "Equipamento", "h", "0.48193", null, "421.0781", "202.9302"]);
    expect(vals.find((x) => x[1] === "1108059")).toMatchObject({ 3: "Ativ. auxiliar", 5: "0.02305", 8: "77.0485" });
    expect(vals.find((x) => x[0] === "Custo unitário direto total (publicado)")).toEqual(["Custo unitário direto total (publicado)", "5137.26"]);
    for (const l of s.tabela!.linhas) expect(l.celulas.reduce((n, c) => n + celula(c).span, 0)).toBe(9);

    const an = await montarRelatorio(ex, o.revisaoId, "analitico", opc);
    for (const l of an.secoes[0].tabela!.linhas) expect(l.celulas.reduce((n, c) => n + celula(c).span, 0)).toBe(an.secoes[0].tabela!.colunas.length);
    expect(an.secoes[0].tabela!.linhas.some((l) => l.celulas.some((c) => celula(c).valor === "P9830"))).toBe(true);

    const abc = await montarRelatorio(ex, o.revisaoId, "abc-insumos", opc);
    expect(abc.secoes[0].tabela!.linhas.map((l) => celula(l.celulas[3]).valor).join("|")).toMatch(/composição SICRO — não desmembrada/);
    expect(abc.secoes.at(-1)!.paragrafos ?? abc.secoes.flatMap((x) => x.paragrafos ?? [])).toBeDefined();

    // fechamento grava a composição SICRO junto do item
    await fecharRevisao(ex, o.revisaoId, v, u);
    const f = await carregarRevisao(ex, o.revisaoId);
    expect((f.itens.find((i) => i.codigo === "0308308")!.analitico as { tipo: string; sicro: { totais: { total: string } } })).toMatchObject({ tipo: "SICRO", sicro: { totais: { total: "5137.26" } } });
    const cpuF = await montarRelatorio(ex, o.revisaoId, "cpu", opc);
    expect(cpuF.secoes.find((x) => x.titulo === "CPU — 0308308")!.tabela!.linhas.length).toBe(s.tabela!.linhas.length);
  });

  it("orçamento com desoneração: composição SICRO fica recusada com o motivo", async () => {
    const obra = await criarObra(ex, { nome: "Rodovia RJ-001" }, u);
    const o = await criarOrcamento(ex, { obraId: obra, titulo: "Com desoneração", bases: [{ baseRevisaoId: rev.SICRO, regime: "COM_DESONERACAO" }] }, u);
    let v = (await carregarRevisao(ex, o.revisaoId)).revisao.versao;
    const et = await criarEtapa(ex, o.revisaoId, v, { titulo: "Etapa única" }, u); v = et.versao;
    await expect(adicionarItem(ex, o.revisaoId, v, { etapaId: et.id, itemReferenciaId: await idDe("0307731"), quantidade: "1" }, u)).rejects.toThrow(/apenas no regime "Sem desoneração"/);
    const m = await adicionarItem(ex, o.revisaoId, v, { etapaId: et.id, itemReferenciaId: await idDe("P9821"), quantidade: "1" }, u);
    expect((await carregarRevisao(ex, o.revisaoId)).itens.find((i) => i.id === m.id)!.custoUnitario).toBe("38.0383");
  });
});
