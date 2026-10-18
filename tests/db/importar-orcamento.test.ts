import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { executorPg, type Executor } from "@/lib/banco/executor";
import { analisarGrade, fonteCitada, lerLinhas, montarEstrutura } from "@/lib/orcamento/importar/analisar";
import { lerPdf, lerPlanilha } from "@/lib/orcamento/importar/ler-arquivo";
import { conferirCodigos, criarEtapasImportadas, importarItens } from "@/lib/orcamento/importar/servidor";
import { adicionarItem, carregarRevisao, criarEtapa, criarObra, criarOrcamento } from "@/lib/orcamento/servico";
import { montarRelatorio } from "@/lib/relatorios/montar";
import { prisma } from "./ajuda";
import { carregarAmostras } from "./carga";

let ex: Executor;
let u: string;
let rev: Record<string, string>;
let original: string;
const arquivos: { pdf?: ArrayBuffer; xlsx?: ArrayBuffer } = {};
const idDe = async (codigo: string) => (await prisma.itemReferencia.findFirstOrThrow({ where: { codigo } })).id;
const bases = () => [{ baseRevisaoId: rev.EMOP, regime: "SEM_DESONERACAO" }, { baseRevisaoId: rev.SINAPI, regime: "SEM_DESONERACAO" }];
const ab = (b: Uint8Array) => b.slice().buffer as ArrayBuffer;

beforeAll(async () => {
  ex = await executorPg(process.env.DATABASE_URL!);
  const c = await carregarAmostras(ex);
  u = c.usuarioId;
  rev = c.revisoes;
  const obra = await criarObra(ex, { nome: "Creche Modelo", codigo: "OB-77", processo: "SEI-77/2026", endereco: "Rua B, 2", municipio: "Niterói", orgaoSolicitante: "SME" }, u);
  const o = await criarOrcamento(ex, { obraId: obra, codigo: "0007", titulo: "Reforma da creche", bases: bases() }, u);
  original = o.revisaoId;
  let v = 1;
  const e1 = await criarEtapa(ex, original, v, { titulo: "Serviços preliminares" }, u); v = e1.versao;
  const e2 = await criarEtapa(ex, original, v, { titulo: "Pisos e acessibilidade" }, u); v = e2.versao;
  let a = await adicionarItem(ex, original, v, { etapaId: e1.id, itemReferenciaId: await idDe("01.001.0001-0"), quantidade: "10" }, u); v = a.versao;
  a = await adicionarItem(ex, original, v, { etapaId: e2.id, itemReferenciaId: await idDe("104658"), quantidade: "12,5" }, u); v = a.versao;
  a = await adicionarItem(ex, original, v, { etapaId: e2.id, itemReferenciaId: await idDe("36178"), quantidade: "3" }, u); v = a.versao;

  // o orçamento sintético do próprio sistema, em PDF e Excel
  const d = await montarRelatorio(ex, original, "sintetico", { emitidoPor: "Teste", agora: new Date("2026-10-17T15:30:00Z") });
  const { definicaoPdf } = await import("@/lib/relatorios/pdf");
  const { gerarXlsx } = await import("@/lib/relatorios/xlsx");
  const ExcelJS = (await import("exceljs")).default;
  const pdfmake = (await import("pdfmake")).default as unknown as {
    setFonts: (f: unknown) => void; setUrlAccessPolicy: (f: () => boolean) => void; setLocalAccessPolicy: (f: (p: string) => boolean) => void;
    createPdf: (d: unknown) => { getBuffer: () => Promise<Buffer> };
  };
  const dir = "node_modules/pdfmake/build/fonts/Roboto/";
  pdfmake.setFonts({ Roboto: { normal: `${dir}Roboto-Regular.ttf`, bold: `${dir}Roboto-Medium.ttf`, italics: `${dir}Roboto-Italic.ttf`, bolditalics: `${dir}Roboto-MediumItalic.ttf` } });
  pdfmake.setUrlAccessPolicy(() => false);
  pdfmake.setLocalAccessPolicy((p) => p.startsWith(dir));
  arquivos.pdf = ab(new Uint8Array(await pdfmake.createPdf(definicaoPdf(d)).getBuffer()));
  arquivos.xlsx = ab(new Uint8Array(await gerarXlsx(ExcelJS, d)));
  if (process.env.RELATORIOS_SAIDA) {
    const fs = await import("node:fs");
    fs.writeFileSync(`${process.env.RELATORIOS_SAIDA}/importar.pdf`, Buffer.from(arquivos.pdf));
    fs.writeFileSync(`${process.env.RELATORIOS_SAIDA}/importar.xlsx`, Buffer.from(arquivos.xlsx));
  }
});
afterAll(async () => { await ex.encerrar?.(); await prisma.$disconnect(); });

const pdfjsNode = async () => (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as Parameters<typeof lerPdf>[1];

/** Fluxo da tela: lê, analisa, confere os códigos, cria o orçamento e grava etapas e itens. */
async function importar(grade: Parameters<typeof analisarGrade>[0], continuacao: boolean, arquivo: string) {
  const a = analisarGrade(grade);
  const linhas = lerLinhas(grade, a.cabecalho, a.mapa, { continuacao });
  const est = montarEstrutura(linhas);
  const cands = await conferirCodigos(ex, bases(), est.itens.map((i) => i.codigo ?? ""));
  const escolher = (codigo: string, fonte: string | null) => {
    const cs = cands.filter((c) => c.consulta === codigo.toUpperCase() && c.custo);
    return (fonte ? cs.find((c) => c.fonte === fonteCitada(fonte)) : null) ?? (cs.length === 1 ? cs[0] : null);
  };
  const obra = await criarObra(ex, { nome: a.dados.obraNome ?? "Obra importada", codigo: a.dados.obraCodigo, processo: a.dados.processo, endereco: a.dados.endereco, orgaoSolicitante: a.dados.orgaoSolicitante }, u);
  const o = await criarOrcamento(ex, { obraId: obra, codigo: a.dados.codigoOrcamento, titulo: a.dados.titulo ?? arquivo, bases: bases() }, u);
  const et = await criarEtapasImportadas(ex, o.revisaoId, 1, est.etapas, { arquivo, linhas: grade.length, itens: est.itens.length }, u);
  const r = await importarItens(ex, o.revisaoId, et.versao, est.itens.map((i) => ({
    ref: i.indice, etapaId: et.ids[i.etapaChave], itemReferenciaId: escolher(i.codigo!, i.fonte)!.itemReferenciaId, quantidade: i.quantidade!,
  })), u);
  return { a, o, r, est };
}

describe("importar orçamento", () => {
  it("confere códigos nas bases escolhidas: EMOP sem sufixo, código inexistente, custo da base", async () => {
    const c = await conferirCodigos(ex, bases(), ["01.001.0001", "104658", " 104658 ", "999999", "36178"]);
    const de = (q: string) => c.filter((x) => x.consulta === q);
    // EMOP sem o sufixo: as variações existentes; a do regime escolhido tem preço
    expect(de("01.001.0001").filter((x) => x.custo).map((x) => x.codigo)).toEqual(["01.001.0001-0"]);
    expect(de("104658")).toHaveLength(1);
    expect(de("104658")[0]).toMatchObject({ fonte: "SINAPI", tipo: "COMPOSICAO", custo: "194.4500" });
    expect(de("999999")).toEqual([]);
    expect(de("36178")[0]).toMatchObject({ tipo: "INSUMO", unidade: "UN" });
  });

  for (const formato of ["pdf", "xlsx"] as const) {
    it(`importa o orçamento sintético em ${formato.toUpperCase()}: dados de cadastro, etapas, itens e o mesmo total`, async () => {
      const grade = formato === "pdf" ? (await lerPdf(arquivos.pdf!, await pdfjsNode())).grade : (await lerPlanilha(arquivos.xlsx!))[0].grade;
      const { a, o, r, est } = await importar(grade, formato === "pdf", `sintetico.${formato}`);
      expect(a.dados).toMatchObject({ obraCodigo: "OB-77", processo: "SEI-77/2026", orgaoSolicitante: "SME", codigoOrcamento: "0007", titulo: "Reforma da creche", desonerado: false });
      expect(est.etapas.map((e) => e.titulo)).toEqual(["Serviços preliminares", "Pisos e acessibilidade"]);
      expect(r).toMatchObject({ gravados: 3, falhas: [] });
      const novo = await carregarRevisao(ex, o.revisaoId);
      const velho = await carregarRevisao(ex, original);
      expect(novo.itens.map((i) => [i.numero, i.codigo, i.quantidade, i.precoTotal])).toEqual(velho.itens.map((i) => [i.numero, i.codigo, i.quantidade, i.precoTotal]));
      expect(novo.totais.total).toBe(velho.totais.total);
      expect(await prisma.auditoria.count({ where: { acao: "ORCAMENTO_IMPORTADO", entidadeId: o.revisaoId } })).toBe(1);
    });
  }

  it("itens sem preço na base do orçamento não são gravados e voltam como falha", async () => {
    const obra = await criarObra(ex, { nome: "Obra falhas" }, u);
    const o = await criarOrcamento(ex, { obraId: obra, titulo: "Só EMOP", bases: [bases()[0]] }, u);
    const et = await criarEtapasImportadas(ex, o.revisaoId, 1, [{ chave: "e1", titulo: "Etapa única", paiChave: null }], { arquivo: "x.xlsx", linhas: 3, itens: 2 }, u);
    const r = await importarItens(ex, o.revisaoId, et.versao, [
      { ref: 1, etapaId: et.ids.e1, itemReferenciaId: await idDe("01.001.0001-0"), quantidade: "2.5" },
      { ref: 2, etapaId: et.ids.e1, itemReferenciaId: await idDe("104658"), quantidade: "1" }, // SINAPI fora das bases deste orçamento
      { ref: 3, etapaId: et.ids.e1, itemReferenciaId: await idDe("01.001.0001-0"), quantidade: "1.123456" },
    ], u);
    expect(r.gravados).toBe(1);
    expect(r.falhas.map((f) => f.ref)).toEqual([2, 3]);
    expect(r.falhas[1].motivo).toMatch(/4 casas/);
    await expect(importarItens(ex, o.revisaoId, et.versao, [], u)).resolves.toMatchObject({ gravados: 0 });
    await expect(importarItens(ex, o.revisaoId, 1, [{ ref: 1, etapaId: et.ids.e1, itemReferenciaId: await idDe("01.001.0001-0"), quantidade: "1" }], u)).rejects.toThrow(/alterado por outra pessoa/);
  });
});
