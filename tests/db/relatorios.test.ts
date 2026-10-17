import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { executorPg, type Executor } from "@/lib/banco/executor";
import { dec } from "@/lib/calculo/decimal";
import { salvarPerfil } from "@/lib/orcamento/bdi";
import {
  adicionarItem, alterarObra, carregarRevisao, criarEtapa, criarObra, criarOrcamento, fecharRevisao, novaRevisao, salvarCronograma,
} from "@/lib/orcamento/servico";
import { celula, type Documento, type Linha } from "@/lib/relatorios/documento";
import { montarRelatorio } from "@/lib/relatorios/montar";
import { prisma } from "./ajuda";
import { carregarAmostras } from "./carga";

let ex: Executor;
let u: string;
let rev: Record<string, string>;
let r1: string;
let v = 1;
const itens: Record<string, string> = {};
const idDe = async (codigo: string) => (await prisma.itemReferencia.findFirstOrThrow({ where: { codigo } })).id;
const opc = { emitidoPor: "Teste", agora: new Date("2026-10-17T15:30:00Z") };

/** Linhas da 1ª tabela, com os valores das células. */
const linhas = (d: Documento, secao = 0) => d.secoes[secao].tabela!.linhas;
const valores = (l: Linha) => l.celulas.map((c) => celula(c).valor);
const acharLinha = (d: Documento, texto: string, secao = 0) => linhas(d, secao).find((l) => valores(l).some((x) => x === texto));

beforeAll(async () => {
  ex = await executorPg(process.env.DATABASE_URL!);
  const c = await carregarAmostras(ex);
  u = c.usuarioId;
  rev = c.revisoes;
  const perfil = await salvarPerfil(ex, {
    nome: "BDI relatório", parcelas: [
      { tipo: "AC", nome: "Administração central", percentual: "4" }, { tipo: "S", nome: "Seguro", percentual: "0,4" },
      { tipo: "G", nome: "Garantia", percentual: "0,4" }, { tipo: "R", nome: "Risco", percentual: "1,27" },
      { tipo: "DF", nome: "Despesas financeiras", percentual: "1,23" }, { tipo: "L", nome: "Lucro", percentual: "7,4" },
      { tipo: "I", nome: "PIS", percentual: "0,65" }, { tipo: "I", nome: "COFINS", percentual: "3" }, { tipo: "I", nome: "ISS", percentual: "2" },
    ],
  }, u);
  const obra = await criarObra(ex, { nome: "Creche Modelo", codigo: "OB-77", processo: "SEI-77/2026", endereco: "Rua B, 2", municipio: "Niterói", orgaoSolicitante: "SME" }, u);
  const o = await criarOrcamento(ex, { obraId: obra, codigo: "0007", titulo: "Reforma", bdiPerfilId: perfil, bases: [{ baseRevisaoId: rev.EMOP, regime: "SEM_DESONERACAO" }, { baseRevisaoId: rev.SINAPI, regime: "SEM_DESONERACAO" }] }, u);
  r1 = o.revisaoId;
  const e1 = await criarEtapa(ex, r1, v, { titulo: "Serviços preliminares" }, u); v = e1.versao;
  const e2 = await criarEtapa(ex, r1, v, { titulo: "Pisos" }, u); v = e2.versao;
  let a = await adicionarItem(ex, r1, v, { etapaId: e1.id, itemReferenciaId: await idDe("01.001.0001-0"), quantidade: "10", memoriaQuantitativo: "2 x 5" }, u); v = a.versao; itens.emop = a.id;
  a = await adicionarItem(ex, r1, v, { etapaId: e2.id, itemReferenciaId: await idDe("104658"), quantidade: "10" }, u); v = a.versao; itens.sinapi = a.id;
  a = await adicionarItem(ex, r1, v, { etapaId: e2.id, itemReferenciaId: await idDe("36178"), quantidade: "3" }, u); v = a.versao; itens.insumo = a.id;
  v = await salvarCronograma(ex, r1, v, { meses: 2, parcelas: [
    { etapaId: e1.id, periodo: 1, percentual: "100" }, { etapaId: e2.id, periodo: 1, percentual: "40" }, { etapaId: e2.id, periodo: 2, percentual: "60" },
  ] }, u);
});
afterAll(async () => { await ex.encerrar?.(); await prisma.$disconnect(); });

describe("relatórios (revisão em elaboração)", () => {
  it("sintético: identificação, itens, totais e aviso de prévia", async () => {
    const d = await montarRelatorio(ex, r1, "sintetico", opc);
    const e = await carregarRevisao(ex, r1);
    expect(d.titulo).toBe("Orçamento sintético");
    expect(d.identificacao).toEqual(expect.arrayContaining([
      { rotulo: "Obra", valor: "OB-77 · Creche Modelo" },
      { rotulo: "Órgão solicitante", valor: "SME" },
      { rotulo: "Processo", valor: "SEI-77/2026" },
      { rotulo: "Local", valor: "Rua B, 2 — Niterói/RJ" },
      { rotulo: "Orçamento", valor: "0007 — Reforma" },
      { rotulo: "Bases de referência", valor: "EMOP RJ 09/2026 — Sem desoneração; SINAPI RJ 09/2026 — Encargos sociais sem desoneração" },
    ]));
    expect(d.identificacao.find((x) => x.rotulo === "Revisão")!.valor).toMatch(/nº 1 .*EM ELABORAÇÃO/);
    expect(d.avisos[0]).toMatch(/PRÉVIA/);
    expect(d.rodape).toMatch(/^Emitido em 17\/10\/2026 12:30 por Teste · Orçamento de Obras/);
    // item EMOP: 211,97 × 1,2223 = 259,09; × 10 = 2.590,90
    expect(valores(acharLinha(d, "01.001.0001-0")!)).toEqual(["1.1", "EMOP", "01.001.0001-0", expect.any(String), "UN", "10.0000", "211.97", "22.230000", "259.09", "2590.90"]);
    const tot = linhas(d).slice(-3).map(valores);
    expect(tot).toEqual([["Custo direto total", e.totais.custoDireto], ["BDI", e.totais.bdi], ["TOTAL GERAL", e.totais.total]]);
    // soma das etapas = total
    const etapas = linhas(d).filter((l) => l.estilo === "grupo1").map((l) => dec(valores(l).at(-1)!));
    expect(etapas.reduce((a, b) => a.plus(b), dec(0)).toFixed(2)).toBe(e.totais.total);
    // toda linha ocupa exatamente as colunas da tabela
    for (const l of linhas(d)) expect(l.celulas.reduce((n, c) => n + celula(c).span, 0)).toBe(d.secoes[0].tabela!.colunas.length);
  });

  it("analítico e CPU: componentes da composição oficial com custo parcial", async () => {
    const d = await montarRelatorio(ex, r1, "analitico", opc);
    const comp = acharLinha(d, "36178")!; // componente da 104658 (coef. 6,4375) — e também item 2.2
    expect(comp).toBeDefined();
    const det = linhas(d).filter((l) => l.estilo === "detalhe").map(valores);
    expect(det.map((x) => x[2])).toEqual(expect.arrayContaining(["88316", "88309", "36178", "34357", "34353"]));
    for (const l of linhas(d)) expect(l.celulas.reduce((n, c) => n + celula(c).span, 0)).toBe(d.secoes[0].tabela!.colunas.length);

    const cpu = await montarRelatorio(ex, r1, "cpu", opc);
    const s = cpu.secoes.find((x) => x.titulo === "CPU — 104658")!;
    expect(s.campos!.find((c) => c.rotulo === "Composição")!.valor).toBe("Analítica oficial publicada");
    const vals = s.tabela!.linhas.map(valores);
    const l36178 = vals.find((x) => x[1] === "36178")!;
    // custo parcial = coef × preço
    expect(dec(l36178[8]!).toFixed(2)).toBe(dec(l36178[5]!).times(l36178[7]!).toDecimalPlaces(2).toFixed(2));
    expect(vals.at(-1)).toEqual(["PREÇO UNITÁRIO COM BDI", "237.68"]);
    // 88309 não tem analítica publicada nas amostras: aparece como componente, sem ser explodido
    expect(vals.some((x) => x[1] === "88309")).toBe(true);
    for (const sec of cpu.secoes) for (const l of sec.tabela?.linhas ?? []) expect(l.celulas.reduce((n, c) => n + celula(c).span, 0)).toBe(sec.tabela!.colunas.length);
  });

  it("curva ABC de serviços: percentuais somam 100% e classes", async () => {
    const d = await montarRelatorio(ex, r1, "abc-servicos", opc);
    const ls = linhas(d).filter((l) => l.estilo !== "total").map(valores);
    expect(ls.map((x) => x[2])).toEqual(["01.001.0001-0", "104658", "36178"].sort((a, b) => {
      const t = (c: string) => dec(ls.find((x) => x[2] === c)![7]!).toNumber();
      return t(b) - t(a);
    }));
    expect(ls.reduce((a, x) => a.plus(x[8]!), dec(0)).toDecimalPlaces(3).toString()).toBe("100");
    expect(ls[0][10]).toBe("A");
    expect(dec(ls.at(-1)![9]!).toDecimalPlaces(3).toString()).toBe("100");
  });

  it("curva ABC de insumos: explode composições em todos os níveis", async () => {
    const d = await montarRelatorio(ex, r1, "abc-insumos", opc);
    const ls = linhas(d).filter((l) => l.estilo !== "total").map(valores);
    const q = (codigo: string) => ls.find((x) => x[2] === codigo)?.[5];
    // 36178: 3 (direto) + 10 × 6,4375 (na 104658)
    expect(q("36178")).toBe("67.375");
    expect(q("34357")).toBe("2.4");
    expect(q("34353")).toBe("86.2");
    // 88309 sem analítica publicada nas amostras: entra inteiro (10 × 0,639)
    // EMOP 01.001.0001-0: 10 × 1,1965 de 02083
    expect(q("02083")).toBe("11.965");
    // 88309 sem analítica e sem preço nas amostras reduzidas: listado à parte, inteiro (10 × 0,639), nunca com preço inventado
    const semPreco = d.secoes.find((x) => x.titulo === "Insumos sem preço na base do item")!.tabela!.linhas.map(valores);
    expect(semPreco.find((x) => x[1] === "88309")).toEqual(["SINAPI", "88309", expect.stringMatching(/serviço sem analítica publicada/), "H", "6.39"]);
    expect(ls.some((x) => x[2] === "88309")).toBe(false);
    // 88316 tem analítica: não aparece como linha, só os seus insumos
    expect(ls.some((x) => x[2] === "88316")).toBe(false);
    // custo de cada linha = quantidade × preço
    for (const x of ls) expect(dec(x[7]!).toFixed(2)).toBe(dec(x[5]!).times(x[6]!).toDecimalPlaces(2).toFixed(2));
    expect(ls.reduce((a, x) => a.plus(x[8]!), dec(0)).toDecimalPlaces(3).toString()).toBe("100");
  });

  it("BDI: parcelas, fórmula do TCU e onde é aplicado", async () => {
    const d = await montarRelatorio(ex, r1, "bdi", opc);
    expect(d.secoes[0].campos!.find((c) => c.rotulo === "BDI global")!.valor).toBe('22,23% — perfil "BDI relatório"');
    expect(d.secoes[0].campos!.find((c) => c.rotulo === "Itens com BDI global")!.valor).toBe("1.1, 2.1, 2.2");
    const p = d.secoes.find((s) => s.titulo === 'Perfil "BDI relatório"')!;
    expect(p.paragrafos).toEqual(expect.arrayContaining([expect.stringMatching(/TCU 2\.622\/2013/), "BDI calculado pelas parcelas: 22,2262%", "BDI aplicado aos itens (2 casas): 22,23%"]));
    expect(p.tabela!.linhas.map(valores).find((x) => x[1] === "Soma I")).toEqual(["I", "Soma I", "5.65"]);
  });

  it("cronograma: valores por mês, acumulado e 100% no fim", async () => {
    const d = await montarRelatorio(ex, r1, "cronograma", opc);
    const e = await carregarRevisao(ex, r1);
    const t = d.secoes[0].tabela!;
    expect(t.colunas.map((c) => c.titulo)).toEqual(["Item", "Etapa", "Valor (R$)", "Mês 1", "Mês 2", "Total (R$)"]);
    const pisos = e.etapas.find((x) => x.titulo === "Pisos")!;
    const lp = t.linhas.map(valores).find((x) => x[1] === "Pisos")!;
    expect(lp[3]).toBe(dec(pisos.total).times(0.4).toDecimalPlaces(2).toFixed(2));
    expect(lp[4]).toBe(dec(pisos.total).minus(lp[3]!).toFixed(2));
    expect(lp[5]).toBe(dec(pisos.total).toFixed(2));
    expect(valores(t.linhas.at(-1)!)).toEqual(["% acumulado do orçamento", expect.any(String), "100.00", ""]);
    expect(d.avisos.filter((a) => /deveria somar/.test(a))).toEqual([]);
  });

  it("memória de cálculo: quantitativo com resultado e cálculo do preço", async () => {
    const d = await montarRelatorio(ex, r1, "memoria", opc);
    const l = valores(acharLinha(d, "1.1")!);
    expect(l[4]).toBe("2 x 5 — resultado: 10,00");
    expect(l[5]).toMatch(/Preço unitário = 211,97 × \(1 \+ 22,23% de BDI\) = R\$ 259,09/);
  });

  it("histórico de preços: competências publicadas no regime do item", async () => {
    const d = await montarRelatorio(ex, r1, "historico", opc);
    const t = d.secoes[0].tabela!;
    expect(t.colunas.map((c) => c.titulo)).toEqual(["Fonte", "Código", "Descrição", "Unid.", "Regime", "09/2026", "Variação"]);
    expect(valores(t.linhas.find((x) => valores(x)[1] === "104658")!)).toEqual(["SINAPI", "104658", expect.any(String), "M2", "Encargos sociais sem desoneração", "194.4500", null]);
    expect(d.avisos).toEqual(expect.arrayContaining([expect.stringMatching(/apenas uma competência/)]));
  });
});

describe("relatórios (revisão fechada)", () => {
  it("usa os dados gravados no fechamento, mesmo após alterar a obra; comparativo", async () => {
    await fecharRevisao(ex, r1, v, u);
    const obra = (await carregarRevisao(ex, r1)).orcamento.obraId;
    await alterarObra(ex, obra, { nome: "Creche Modelo", codigo: "OB-77", processo: "SEI-77/2026", endereco: "Rua B, 2", municipio: "Niterói", orgaoSolicitante: "SME" }, { nome: "Creche Modelo (novo nome)", codigo: "OB-77" }, u);
    const d = await montarRelatorio(ex, r1, "sintetico", opc);
    expect(d.identificacao.find((x) => x.rotulo === "Obra")!.valor).toBe("OB-77 · Creche Modelo");
    expect(d.identificacao.find((x) => x.rotulo === "Revisão")!.valor).toMatch(/fechada em/);
    expect(d.avisos.some((a) => /PRÉVIA/.test(a))).toBe(false);
    const a = await montarRelatorio(ex, r1, "analitico", opc);
    expect(linhas(a).filter((l) => l.estilo === "detalhe").length).toBeGreaterThan(5);

    const n = await novaRevisao(ex, r1, { descricao: "Ajustes" }, u);
    const e2 = await carregarRevisao(ex, n.revisaoId);
    const it = e2.itens.find((x) => x.codigo === "36178")!;
    const { alterarItem } = await import("@/lib/orcamento/servico");
    await alterarItem(ex, n.revisaoId, e2.revisao.versao, it.id, { quantidade: "5" }, u);
    const c = await montarRelatorio(ex, n.revisaoId, "comparativo", { ...opc, outraRevisaoId: r1 });
    const l = linhas(c, 1).map(valores);
    expect(l.find((x) => x[3] === "36178")![0]).toBe("Alterado");
    expect(l.find((x) => x[3] === "104658")![0]).toBe("Igual");
    expect(c.secoes[0].campos![2].valor).toMatch(/^R\$ /);
    await expect(montarRelatorio(ex, n.revisaoId, "comparativo", opc)).rejects.toThrow(/Escolha a revisão/);
    // a revisão nova (aberta) mostra o novo nome da obra
    const d2 = await montarRelatorio(ex, n.revisaoId, "sintetico", opc);
    expect(d2.identificacao.find((x) => x.rotulo === "Obra")!.valor).toBe("OB-77 · Creche Modelo (novo nome)");
  });
});

describe("arquivos PDF e XLSX", () => {
  it("todos os relatórios geram PDF e planilha válidos, com os mesmos valores", async () => {
    const ExcelJS = (await import("exceljs")).default;
    const { gerarXlsx } = await import("@/lib/relatorios/xlsx");
    const { definicaoPdf } = await import("@/lib/relatorios/pdf");
    const { RELATORIOS } = await import("@/lib/relatorios/documento");
    // pdfmake no Node, com a mesma fonte Roboto do navegador
    const pdfmake = (await import("pdfmake")).default as unknown as {
      setFonts: (f: unknown) => void; setUrlAccessPolicy: (f: () => boolean) => void; setLocalAccessPolicy: (f: (p: string) => boolean) => void;
      createPdf: (d: unknown) => { getBuffer: () => Promise<Buffer> };
    };
    const dir = "node_modules/pdfmake/build/fonts/Roboto/";
    pdfmake.setFonts({ Roboto: { normal: `${dir}Roboto-Regular.ttf`, bold: `${dir}Roboto-Medium.ttf`, italics: `${dir}Roboto-Italic.ttf`, bolditalics: `${dir}Roboto-MediumItalic.ttf` } });
    pdfmake.setUrlAccessPolicy(() => false);
    pdfmake.setLocalAccessPolicy((p) => p.startsWith(dir));
    const revs = await prisma.orcamentoRevisao.findMany({ where: { orcamento: { codigo: "0007" } }, orderBy: { numero: "asc" } });
    const alvo = revs.at(-1)!.id;
    for (const r of RELATORIOS) {
      const d = await montarRelatorio(ex, alvo, r.tipo, { ...opc, outraRevisaoId: revs[0].id });
      const pdf = await pdfmake.createPdf({ ...definicaoPdf(d), compress: false }).getBuffer();
      expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
      if (process.env.RELATORIOS_SAIDA) {
        const fs = await import("node:fs");
        fs.writeFileSync(`${process.env.RELATORIOS_SAIDA}/${r.tipo}.pdf`, await pdfmake.createPdf(definicaoPdf(d)).getBuffer());
        fs.writeFileSync(`${process.env.RELATORIOS_SAIDA}/${r.tipo}.xlsx`, Buffer.from(await gerarXlsx(ExcelJS, d)));
      }
      expect(pdf.toString("latin1")).toMatch(/\/Type \/Page\b/);
      const buf = await gerarXlsx(ExcelJS, d);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buf);
      const ws = wb.worksheets[0];
      expect(ws.getCell(1, 1).value).toBe(d.titulo.toUpperCase());
      if (r.tipo === "sintetico") {
        // total geral como número, igual ao do documento
        let total: unknown = null;
        ws.eachRow((row) => { if (row.getCell(1).value === "TOTAL GERAL") total = row.getCell(10).value; });
        const doc = valores(linhas(d).at(-1)!);
        expect(total).toBe(Number(doc[1]));
        expect(ws.getCell(1, 1).font?.bold).toBe(true);
      }
    }
  }, 60_000);
});
