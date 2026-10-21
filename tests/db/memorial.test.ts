import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as Docx from "docx";
import { unzipSync, strFromU8 } from "fflate";
import { writeFileSync, mkdirSync } from "node:fs";
import { executorPg, type Executor } from "@/lib/banco/executor";
import { salvarPerfil } from "@/lib/orcamento/bdi";
import { adicionarItem, carregarRevisao, criarEtapa, criarObra, criarOrcamento, fecharRevisao, salvarCronograma } from "@/lib/orcamento/servico";
import { carregarMemorial, salvarMemorial, situacaoMemorial, sugerirMemorial } from "@/lib/relatorios/memorial";
import { gerarDocx } from "@/lib/relatorios/memorial-docx";
import { definicaoPdfMemorial } from "@/lib/relatorios/memorial-pdf";
import { categoriaDoItem, porExtenso } from "@/lib/relatorios/memorial-textos";
import { prisma } from "./ajuda";
import { carregarAmostras } from "./carga";

let ex: Executor;
let u: string;
let rev: Record<string, string>;
let r1: string;
let etapas: string[] = [];
let v = 1;
const idDe = async (codigo: string) => (await prisma.itemReferencia.findFirstOrThrow({ where: { codigo } })).id;
const agora = new Date("2026-10-14T15:00:00Z");

beforeAll(async () => {
  ex = await executorPg(process.env.DATABASE_URL!);
  const c = await carregarAmostras(ex);
  u = c.usuarioId;
  rev = c.revisoes;
  const perfil = await salvarPerfil(ex, { nome: "BDI memorial", parcelas: [{ tipo: "L", nome: "Lucro", percentual: "10" }] }, u);
  const obra = await criarObra(ex, {
    nome: "Creche do Parque", codigo: "0001", processo: "SEI-0001/2026", endereco: "Rua A, 10", municipio: "Macaé", orgaoSolicitante: "Defesa Civil",
    descricao: "Contratação de empresa especializada para reforma da creche do Parque, com fornecimento de mão de obra, materiais e equipamentos.",
  }, u);
  const o = await criarOrcamento(ex, { obraId: obra, titulo: "Reforma da creche", bdiPerfilId: perfil, bases: [{ baseRevisaoId: rev.EMOP, regime: "SEM_DESONERACAO" }, { baseRevisaoId: rev.SINAPI, regime: "SEM_DESONERACAO" }] }, u);
  r1 = o.revisaoId;
  const e1 = await criarEtapa(ex, r1, v, { titulo: "Serviços preliminares" }, u); v = e1.versao;
  const e2 = await criarEtapa(ex, r1, v, { titulo: "Acessibilidade" }, u); v = e2.versao;
  etapas = [e1.id, e2.id];
  v = (await adicionarItem(ex, r1, v, { etapaId: e1.id, itemReferenciaId: await idDe("01.001.0001-0"), quantidade: "10" }, u)).versao;
  v = (await adicionarItem(ex, r1, v, { etapaId: e2.id, itemReferenciaId: await idDe("104658"), quantidade: "200" }, u)).versao;
});
afterAll(async () => { await ex.encerrar?.(); await prisma.$disconnect(); });

describe("memorial descritivo", () => {
  it("textos por tipo de serviço e número por extenso", () => {
    expect(categoriaDoItem("DEMOLICAO MANUAL DE ALVENARIA DE TIJOLOS").id).toBe("demolicao");
    expect(categoriaDoItem("ALUGUEL CONTAINER (MODULO METALICO ICAVEL),P/ESCRITORIO C/WC").id).toBe("canteiro");
    expect(categoriaDoItem("SONDAGEM A PERCUSSAO EM TERRENO COMUM").id).toBe("sondagem");
    expect(categoriaDoItem("PISO PODOTÁTIL DE ALERTA OU DIRECIONAL, DE CONCRETO").id).toBe("acessibilidade");
    expect(categoriaDoItem("TRANSPORTE DE MATERIAL DE QUALQUER NATUREZA").id).toBe("residuos");
    expect(categoriaDoItem("SERVIÇO SEM CATEGORIA CONHECIDA").id).toBe("geral");
    expect([1, 12, 21, 100, 120].map(porExtenso)).toEqual(["um", "doze", "vinte e um", "cem", "cento e vinte"]);
  });

  it("só fica disponível com a revisão fechada e o cronograma completo", async () => {
    let s = await situacaoMemorial(ex, await carregarRevisao(ex, r1));
    expect(s.pronto).toBe(false);
    expect(s.pendencias.join(" ")).toMatch(/concluída e bloqueada/);
    expect(s.pendencias.join(" ")).toMatch(/cronograma físico-financeiro não foi preenchido/);
    v = await salvarCronograma(ex, r1, v, { meses: 3, parcelas: [{ etapaId: etapas[0], periodo: 1, percentual: "100" }, { etapaId: etapas[1], periodo: 2, percentual: "60" }] }, u);
    s = await situacaoMemorial(ex, await carregarRevisao(ex, r1));
    expect(s.pendencias.join(" ")).toMatch(/etapa 2 “Acessibilidade” soma 60,00%/);
    v = await salvarCronograma(ex, r1, v, { meses: 3, parcelas: [{ etapaId: etapas[0], periodo: 1, percentual: "100" }, { etapaId: etapas[1], periodo: 2, percentual: "60" }, { etapaId: etapas[1], periodo: 3, percentual: "40" }] }, u);
    await expect(salvarMemorial(ex, r1, await sugerirMemorial(ex, r1, agora), u)).rejects.toThrow(/concluída e bloqueada/);
    await fecharRevisao(ex, r1, v, u);
    s = await situacaoMemorial(ex, await carregarRevisao(ex, r1));
    expect(s).toMatchObject({ pronto: true, pendencias: [], meses: 3 });
  });

  it("sugestão segue o modelo: seções, escopo por etapa, normas, lei 14.133 e valores da planilha", async () => {
    const m = await sugerirMemorial(ex, r1, agora);
    const e = await carregarRevisao(ex, r1);
    expect(m.data).toBe("14 de outubro de 2026");
    expect(m.obra).toBe("OBRA: 0001 — REFORMA DA CRECHE");
    expect(m.secoes.map((s) => s.titulo)).toEqual([
      "1) OBJETO", "1.1) JUSTIFICATIVA", "1.2) CONSIDERAÇÕES GERAIS", "2) ESCOPO DOS SERVIÇOS",
      "1- SERVIÇOS PRELIMINARES", "1.1 – Limite de plasticidade", "2- ACESSIBILIDADE", "2.1 – Piso podotátil de alerta ou direcional",
      "3) RELEVÂNCIA TÉCNICA", "4) SUBCONTRATAÇÕES", "5) RECURSOS", "5.1) Mão de Obra", "5.2) Equipamentos", "5.3) Materiais",
    ]);
    const texto = (t: string) => m.secoes.find((s) => s.titulo === t)!.texto;
    expect(texto("1) OBJETO")).toBe("CONTRATAÇÃO DE EMPRESA ESPECIALIZADA PARA REFORMA DA CRECHE DO PARQUE, COM FORNECIMENTO DE MÃO DE OBRA, MATERIAIS E EQUIPAMENTOS.");
    expect(m.secoes[0].destaque).toBe(true);
    expect(texto("1.1) JUSTIFICATIVA")).toMatch(/processo administrativo nº SEI-0001\/2026/);
    expect(texto("1.1) JUSTIFICATIVA")).toMatch(/\[Complementar/);
    const cg = texto("1.2) CONSIDERAÇÕES GERAIS");
    expect(cg).toContain("Planilha Orçamentária Não Desonerada — Reforma da creche");
    expect(cg).toContain(`valor global de R$ ${Number(e.totais.total).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`);
    expect(cg).toContain("3 (três) meses");
    expect(cg).toMatch(/ABNT NBR 9050.*ABNT NBR 16537/);
    expect(cg).toMatch(/NR-1 .*NR-6 .*NR-18/);
    expect(cg).toMatch(/art\. 117 da Lei nº 14\.133\/2021/);
    expect(cg).toMatch(/art\. 618 do Código Civil/);
    expect(texto("2.1 – Piso podotátil de alerta ou direcional")).toMatch(/^Item 2\.1 \(SINAPI 104658, 200,00 M2\): PISO PODOTÁTIL/);
    expect(texto("2.1 – Piso podotátil de alerta ou direcional")).toContain("ABNT NBR 9050");
    expect(texto("1- SERVIÇOS PRELIMINARES")).toMatch(/^Compreende os serviços do item 1\.1 da planilha orçamentária, no valor de R\$/);
    const rel = texto("3) RELEVÂNCIA TÉCNICA");
    expect(rel).toMatch(/o item 2\.1 \(Piso podotátil de alerta ou direcional\) corresponde a R\$ [\d.,]+, aproximadamente [\d,]+% do valor global/);
    expect(rel).toMatch(/art\. 67, §§ 1º e 2º, da Lei nº 14\.133\/2021/);
    expect(texto("4) SUBCONTRATAÇÕES")).toMatch(/art\. 122 da Lei nº 14\.133\/2021/);
  });

  it("texto editado é gravado e volta ao carregar; gera DOCX e PDF", async () => {
    const m = await sugerirMemorial(ex, r1, agora);
    m.secoes[1].texto = "Justificativa definida pela Secretaria.\nSegundo parágrafo.";
    await salvarMemorial(ex, r1, m, u);
    const c = await carregarMemorial(ex, r1, agora);
    expect(c.salvo).not.toBeNull();
    expect(c.conteudo.secoes[1].texto).toBe("Justificativa definida pela Secretaria.\nSegundo parágrafo.");
    expect(c.sugestao.secoes[1].texto).toMatch(/\[Complementar/);
    expect(c.nomeArquivo).toBe("Memorial_descritivo_Reforma_da_creche_rev1");
    expect(await prisma.auditoria.count({ where: { acao: "MEMORIAL_SALVO", entidadeId: r1 } })).toBe(1);
    await expect(salvarMemorial(ex, r1, { ...m, secoes: [{ ...m.secoes[0], titulo: " " }] }, u)).rejects.toThrow(/Informe o título/);

    const para = { ...c.conteudo, cabecalho: { linhas: ["Estado do Rio de Janeiro", "Prefeitura Municipal de Macaé"], logo: null }, nomeArquivo: c.nomeArquivo };
    const docx = (await gerarDocx(Docx, para)) as Uint8Array;
    const arquivos = unzipSync(new Uint8Array(docx));
    const xml = strFromU8(arquivos["word/document.xml"]);
    expect(xml).toContain("Memorial Descritivo");
    expect(xml).toContain("OBRA: 0001 — REFORMA DA CRECHE");
    expect(xml).toContain("Justificativa definida pela Secretaria.");
    expect(xml).toMatch(/<w:pgSz w:w="11906" w:h="16838"/);
    expect(xml).toMatch(/w:firstLine="425"/);
    const cab = Object.keys(arquivos).filter((k) => /word\/header\d*\.xml/.test(k)).map((k) => strFromU8(arquivos[k])).join("");
    expect(cab).toContain("Prefeitura Municipal de Macaé");
    expect(cab).toContain("14 de outubro de 2026");
    mkdirSync("test-results", { recursive: true });
    writeFileSync("test-results/memorial.docx", docx);

    const pdf = definicaoPdfMemorial(para);
    expect(pdf.pageSize).toBe("A4");
    expect(JSON.stringify(pdf.content)).toContain("Justificativa definida pela Secretaria.");
  });
});
