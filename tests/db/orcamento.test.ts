import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { executorPg, type Executor } from "@/lib/banco/executor";
import { listarPerfis, salvarPerfil } from "@/lib/orcamento/bdi";
import {
  adicionarItem, alterarItem, carregarRevisao, compararRevisoes, configurarRevisao, criarEtapa, criarObra, criarOrcamento,
  duplicarOrcamento, excluirItem, fecharRevisao, moverEtapa, novaRevisao,
} from "@/lib/orcamento/servico";
import { arquivo, SINAPI_ZIP } from "../importacao/ajuda";
import { prisma } from "./ajuda";
import { carregarAmostras, importarPublicar } from "./carga";

let ex: Executor;
let u: string;
let rev: Record<string, string>;
const idDe = async (codigo: string) => (await prisma.itemReferencia.findFirstOrThrow({ where: { codigo } })).id;

beforeAll(async () => {
  ex = await executorPg(process.env.DATABASE_URL!);
  const c = await carregarAmostras(ex);
  u = c.usuarioId;
  rev = c.revisoes;
});
afterAll(async () => { await ex.encerrar?.(); await prisma.$disconnect(); });

const basesPadrao = () => [
  { baseRevisaoId: rev.EMOP, regime: "SEM_DESONERACAO" },
  { baseRevisaoId: rev.SINAPI, regime: "SEM_DESONERACAO" },
];

describe("perfis de BDI", () => {
  it("TCU calculado (arredondado a 2 casas) e informado", async () => {
    await salvarPerfil(ex, {
      nome: "Edificações (exemplo)", parcelas: [
        { tipo: "AC", nome: "Administração central", percentual: "4" }, { tipo: "S", nome: "Seguro", percentual: "0,4" },
        { tipo: "G", nome: "Garantia", percentual: "0,4" }, { tipo: "R", nome: "Risco", percentual: "1,27" },
        { tipo: "DF", nome: "Despesas financeiras", percentual: "1,23" }, { tipo: "L", nome: "Lucro", percentual: "7,4" },
        { tipo: "I", nome: "PIS", percentual: "0,65" }, { tipo: "I", nome: "COFINS", percentual: "3" }, { tipo: "I", nome: "ISS", percentual: "2" },
      ],
    }, u);
    await salvarPerfil(ex, { nome: "Diferenciado (equipamentos)", percentualInformado: "15,28", parcelas: [] }, u);
    const p = await listarPerfis(ex);
    expect(p.find((x) => x.nome.startsWith("Edificações"))?.bdiAplicado).toBe("22.23");
    expect(p.find((x) => x.nome.startsWith("Diferenciado"))?.bdiAplicado).toBe("15.28");
    await expect(salvarPerfil(ex, { nome: "edificações (EXEMPLO)", parcelas: [{ tipo: "L", nome: "L", percentual: "1" }] }, u)).rejects.toThrow(/Já existe/);
    await expect(salvarPerfil(ex, { nome: "Vazio", parcelas: [] }, u)).rejects.toThrow(/parcelas/);
  });
});

describe("orçamento completo", () => {
  let orcamentoId: string;
  let r1: string;
  let v = 1;
  let etapaId: string;
  const itens: Record<string, string> = {};

  it("cria obra, orçamento com bases publicadas e BDI global", async () => {
    const perfis = await listarPerfis(ex);
    const obra = await criarObra(ex, { nome: "Escola Municipal X", cliente: "Prefeitura", municipio: "Niterói" }, u);
    const r = await criarOrcamento(ex, { obraId: obra, titulo: "Reforma geral", bases: basesPadrao(), bdiPerfilId: perfis.find((x) => x.nome.startsWith("Edificações"))!.id }, u);
    orcamentoId = r.orcamentoId;
    r1 = r.revisaoId;
    const e = await carregarRevisao(ex, r1);
    expect(e.revisao).toMatchObject({ numero: 1, status: "EM_ELABORACAO", bdiPercentual: "22.230000" });
    expect(e.basesPadrao.map((b) => `${b.fonte}:${b.regime}`)).toEqual(["EMOP:SEM_DESONERACAO", "SINAPI:SEM_DESONERACAO"]);
  });

  it("não aceita base não publicada", async () => {
    const obra = await criarObra(ex, { nome: "Obra Y" }, u);
    const naoPublicada = await prisma.baseRevisao.create({ data: { baseId: (await prisma.baseRevisao.findUniqueOrThrow({ where: { id: rev.EMOP } })).baseId, numero: 9 } });
    await expect(criarOrcamento(ex, { obraId: obra, titulo: "Orçamento Y", bases: [{ baseRevisaoId: naoPublicada.id, regime: "SEM_DESONERACAO" }] }, u)).rejects.toThrow(/não está publicada/);
    await prisma.baseRevisao.delete({ where: { id: naoPublicada.id } });
  });

  it("etapas, subetapas e itens com valores exatos", async () => {
    const e1 = await criarEtapa(ex, r1, v, { titulo: "Serviços preliminares" }, u); v = e1.versao;
    const e2 = await criarEtapa(ex, r1, v, { titulo: "Acessibilidade" }, u); v = e2.versao;
    const sub = await criarEtapa(ex, r1, v, { paiId: e2.id, titulo: "Piso tátil" }, u); v = sub.versao;
    etapaId = e1.id;
    let a = await adicionarItem(ex, r1, v, { etapaId: e1.id, itemReferenciaId: await idDe("01.001.0001-0"), quantidade: "10" }, u); v = a.versao; itens.emop = a.id;
    a = await adicionarItem(ex, r1, v, { etapaId: sub.id, itemReferenciaId: await idDe("104658"), quantidade: "12,5" }, u); v = a.versao; itens.sinapi = a.id;
    a = await adicionarItem(ex, r1, v, { etapaId: sub.id, itemReferenciaId: await idDe("36178"), quantidade: "3" }, u); v = a.versao; itens.insumo = a.id;
    const e = await carregarRevisao(ex, r1);
    const emop = e.itens.find((i) => i.id === itens.emop)!;
    // 211,97 × 1,2223 = 259,090931 → 259,09; 10 × 259,09 = 2.590,90
    expect(emop).toMatchObject({ numero: "1.1", custoUnitario: "211.9700", precoUnitario: "259.09", precoTotal: "2590.90", custoTotal: "2119.70", origemPreco: "PUBLICADO" });
    expect(emop.memoriaCalculo).toMatch(/211,97 × \(1 \+ 22,23% de BDI\) = R\$ 259,09/);
    const sin = e.itens.find((i) => i.id === itens.sinapi)!;
    // 194,45 × 1,2223 = 237,676235 → 237,68; 12,5 × 237,68 = 2.971,00
    expect(sin).toMatchObject({ numero: "2.1.1", custoUnitario: "194.4500", precoUnitario: "237.68", precoTotal: "2971.00", custoTotal: "2430.63" });
    expect(sin.referenciaPreco).toMatch(/SINAPI RJ 09\/2026 — Encargos sociais sem desoneração/);
    expect(e.etapas.map((x) => `${x.numero} ${x.titulo}`)).toEqual(["1 Serviços preliminares", "2 Acessibilidade", "2.1 Piso tátil"]);
    const etapa2 = e.etapas.find((x) => x.titulo === "Acessibilidade")!;
    const ins = e.itens.find((i) => i.id === itens.insumo)!;
    expect(etapa2.total).toBe((Number(sin.precoTotal) + Number(ins.precoTotal)).toFixed(2));
    expect(e.totais.total).toBe((2590.90 + 2971.00 + Number(ins.precoTotal)).toFixed(2));
  });

  it("recusa item sem preço e item de regime incompatível", async () => {
    await expect(adicionarItem(ex, r1, v, { etapaId, itemReferenciaId: await idDe("105006"), quantidade: "1" }, u)).rejects.toThrow(/Sem preço publicado/);
    await expect(adicionarItem(ex, r1, v, { etapaId, itemReferenciaId: await idDe("01.001.0001-A"), quantidade: "1" }, u)).rejects.toThrow(/apenas no regime "Com desoneração"/);
    // por item: escolher outra base/regime é permitido
    const a = await adicionarItem(ex, r1, v, { etapaId, itemReferenciaId: await idDe("01.001.0001-A"), quantidade: "1", base: { baseRevisaoId: rev.EMOP, regime: "COM_DESONERACAO" } }, u);
    v = a.versao;
    v = await excluirItem(ex, r1, v, a.id, u);
    await expect(adicionarItem(ex, r1, v, { etapaId, itemReferenciaId: await idDe("02083"), quantidade: "-1" }, u)).rejects.toThrow(/negativa/);
    await expect(adicionarItem(ex, r1, v, { etapaId, itemReferenciaId: await idDe("02083"), quantidade: "1,23456" }, u)).rejects.toThrow(/4 casas/);
  });

  it("BDI individual por item, edição de quantidade e concorrência", async () => {
    const dif = (await listarPerfis(ex)).find((x) => x.nome.startsWith("Diferenciado"))!;
    v = await alterarItem(ex, r1, v, itens.sinapi, { bdiPerfilId: dif.id }, u);
    let e = await carregarRevisao(ex, r1);
    // 194,45 × 1,1528 = 224,16196 → 224,16; × 12,5 = 2.802,00
    expect(e.itens.find((i) => i.id === itens.sinapi)).toMatchObject({ bdiPercentual: "15.280000", precoUnitario: "224.16", precoTotal: "2802.00" });
    v = await alterarItem(ex, r1, v, itens.emop, { quantidade: "1.234,5678" }, u);
    e = await carregarRevisao(ex, r1);
    // 1.234,5678 × 259,09 = 319.864,15... → 319.864,17
    expect(e.itens.find((i) => i.id === itens.emop)).toMatchObject({ quantidade: "1234.5678", precoTotal: "319864.17" });
    await expect(alterarItem(ex, r1, v - 1, itens.emop, { quantidade: "1" }, u)).rejects.toThrow(/alterado por outra pessoa/);
    v = await moverEtapa(ex, r1, v, etapaId, 1, u);
    e = await carregarRevisao(ex, r1);
    expect(e.etapas.map((x) => x.titulo)[0]).toBe("Acessibilidade");
    v = await moverEtapa(ex, r1, v, etapaId, -1, u);
  });

  it("modo truncar recalcula todos os itens; BDI global não afeta item com BDI individual", async () => {
    v = await configurarRevisao(ex, r1, v, { arredondamento: "TRUNCAR" }, u);
    let e = await carregarRevisao(ex, r1);
    // 211,97 × 1,2223 = 259,090931 → truncado 259,09 (igual); 194,45 × 1,1528 = 224,16196 → 224,16
    expect(e.itens.find((i) => i.id === itens.emop)?.memoriaCalculo).toMatch(/truncado/);
    v = await configurarRevisao(ex, r1, v, { arredondamento: "ARREDONDAR", bdiPerfilId: null }, u);
    e = await carregarRevisao(ex, r1);
    expect(e.itens.find((i) => i.id === itens.emop)).toMatchObject({ bdiPercentual: "0.000000", precoUnitario: "211.97" });
    expect(e.itens.find((i) => i.id === itens.sinapi)).toMatchObject({ bdiPercentual: "15.280000" });
    const edif = (await listarPerfis(ex)).find((x) => x.nome.startsWith("Edificações"))!;
    v = await configurarRevisao(ex, r1, v, { bdiPerfilId: edif.id }, u);
  });

  it("fechamento: totais, snapshot analítico e imutabilidade", async () => {
    const antes = await carregarRevisao(ex, r1);
    await fecharRevisao(ex, r1, v, u);
    const e = await carregarRevisao(ex, r1);
    expect(e.revisao.status).toBe("FECHADA");
    expect(e.totais.total).toBe(antes.totais.total);
    const r = await prisma.orcamentoRevisao.findUniqueOrThrow({ where: { id: r1 } });
    expect(r.totalGeral?.toFixed(2)).toBe(antes.totais.total);
    const an = e.itens.find((i) => i.id === itens.sinapi)!.analitico as { tipo: string; linhas: { codigo: string; coeficiente: string }[] };
    expect(an.tipo).toBe("OFICIAL");
    expect(an.linhas.map((l) => l.codigo)).toEqual(["88316", "88309", "36178", "34357", "34353"]);
    await expect(alterarItem(ex, r1, v + 1, itens.emop, { quantidade: "1" }, u)).rejects.toThrow(/fechada/);
    await expect(prisma.itemOrcamento.update({ where: { id: itens.emop }, data: { quantidade: 1 } })).rejects.toThrow(/fechada/);
  });

  it("nova revisão atualizando para nova competência (retificação) sem alterar a anterior; comparação", async () => {
    // retificação SINAPI: 104658 (sem desoneração) +10%; 36178 deixa de ter preço sem desoneração
    const ret = await importarPublicar(ex, [arquivo(SINAPI_ZIP)], u, {
      retificacao: "Teste de retificação",
      ajustar: async (imp) => {
        await ex.consulta(`UPDATE staging.stg_preco SET valor = round(valor * 1.1, 2) WHERE importacao_id = $1 AND codigo = '104658' AND regime_codigo = 'SEM_DESONERACAO'`, [imp]);
        await ex.consulta(`UPDATE staging.stg_preco SET valor = NULL WHERE importacao_id = $1 AND codigo = '36178' AND regime_codigo = 'SEM_DESONERACAO'`, [imp]);
      },
    });
    const antes = await carregarRevisao(ex, r1);
    const n = await novaRevisao(ex, r1, { descricao: "Atualização para a retificação", novasBases: [{ baseRevisaoId: ret.baseRevisaoId, regime: "SEM_DESONERACAO" }] }, u);
    expect(n).toMatchObject({ numero: 2, pendentes: 1 });
    const e2 = await carregarRevisao(ex, n.revisaoId);
    const sin = e2.itens.find((i) => i.codigo === "104658")!;
    expect(sin.custoUnitario).toBe("213.9000"); // 194,45 × 1,1 = 213,895 → 213,90
    expect(sin.baseRotulo).toMatch(/ret\.1/);
    const ins = e2.itens.find((i) => i.codigo === "36178")!;
    expect(ins.pendencia).toMatch(/Preço mantido da referência anterior/);
    expect(ins.custoUnitario).toBe(antes.itens.find((i) => i.codigo === "36178")!.custoUnitario);
    // EMOP não muda (base EMOP mantida)
    expect(e2.itens.find((i) => i.codigo === "01.001.0001-0")!.precoTotal).toBe(antes.itens.find((i) => i.codigo === "01.001.0001-0")!.precoTotal);
    // revisão 1 permanece idêntica
    const depois = await carregarRevisao(ex, r1);
    expect(depois.itens.map((i) => [i.codigo, i.precoTotal])).toEqual(antes.itens.map((i) => [i.codigo, i.precoTotal]));
    // não pode haver duas revisões em elaboração
    await expect(novaRevisao(ex, r1, { descricao: "outra" }, u)).rejects.toThrow(/Já existe uma revisão em elaboração/);
    // comparação
    const c = await compararRevisoes(ex, r1, n.revisaoId);
    expect(c.linhas.find((l) => l.codigo === "104658")?.situacao).toBe("ALTERADO");
    expect(c.linhas.find((l) => l.codigo === "01.001.0001-0")?.situacao).toBe("IGUAL");
    expect(c.diferencaTotal).toBe((Number(e2.totais.total) - Number(antes.totais.total)).toFixed(2));
  });

  it("duplicar orçamento", async () => {
    const d = await duplicarOrcamento(ex, r1, { titulo: "Reforma geral — cópia" }, u);
    const e = await carregarRevisao(ex, d.revisaoId);
    const o = await carregarRevisao(ex, r1);
    expect(e.revisao.status).toBe("EM_ELABORACAO");
    expect(e.orcamento.id).not.toBe(orcamentoId);
    expect(e.itens.map((i) => [i.numero, i.codigo, i.precoTotal])).toEqual(o.itens.map((i) => [i.numero, i.codigo, i.precoTotal]));
    expect(e.totais.total).toBe(o.totais.total);
  });
});
