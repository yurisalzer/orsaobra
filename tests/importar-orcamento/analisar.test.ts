import ExcelJS from "exceljs";
import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { analisarGrade, encontrarCabecalho, lerLinhas, lerNumero, montarEstrutura, type Grade } from "@/lib/orcamento/importar/analisar";
import { gradeDoPdf, lerPlanilha, type TextoPdf } from "@/lib/orcamento/importar/ler-arquivo";
import { LINHAS_EXEMPLO } from "./exemplo";

async function xlsxExemplo(): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet("Capa").addRow(["Planilha orçamentária"]);
  const ws = wb.addWorksheet("Orçamento");
  for (const l of LINHAS_EXEMPLO) ws.addRow(l);
  ws.mergeCells("G8:H8");
  return new Uint8Array(await wb.xlsx.writeBuffer()).slice().buffer;
}

function xlsExemplo(): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(LINHAS_EXEMPLO), "Planilha1");
  return XLSX.write(wb, { bookType: "biff8", type: "array" }) as ArrayBuffer;
}

function conferirExemplo(g: Grade) {
  const a = analisarGrade(g);
  expect(a.cabecalho.linha).toBe(8); // título em duas linhas (7 e 8)
  expect(a.cabecalho.titulos[6]).toBe("PREÇO UNITÁRIO (R$) S/ BDI");
  expect(a.cabecalho.titulos[7]).toBe("PREÇO UNITÁRIO (R$) C/ BDI");
  expect(a.mapa).toEqual({ item: 0, fonte: 1, codigo: 2, descricao: 3, unidade: 4, quantidade: 5, custoUnitario: 6, precoUnitario: 7, total: 8 });
  const linhas = lerLinhas(g, a.cabecalho, a.mapa);
  expect(linhas.map((l) => `${l.tipo}:${l.item ?? ""}`)).toEqual(["ETAPA:1", "ITEM:1.1", "ETAPA:2", "ITEM:2.1", "ITEM:2.2", "IGNORADA:", "IGNORADA:"]);
  const i21 = linhas[3];
  expect(i21).toMatchObject({ codigo: "104658", fonte: "SINAPI", unidade: "M", quantidade: "1234.5", custoUnitario: "194.45", precoUnitario: "243.06", total: "300057.57" });
  expect(linhas[1]).toMatchObject({ quantidade: "4", custoUnitario: "211.97" });
  const e = montarEstrutura(linhas);
  expect(e.etapas.map((x) => x.titulo)).toEqual(["SERVIÇOS PRELIMINARES", "ACESSIBILIDADE"]);
  expect(e.itens.map((x) => `${x.codigo}@${e.etapas.find((t) => t.chave === x.etapaChave)!.titulo}`)).toEqual([
    "01.001.0001-0@SERVIÇOS PRELIMINARES", "104658@ACESSIBILIDADE", "999999@ACESSIBILIDADE",
  ]);
  expect(a.dados).toMatchObject({
    obraNome: "Reforma da Escola Municipal Aldo Silva", processo: "12.345/2026", endereco: "Rua das Palmeiras, 200 - Centro", municipio: "Macaé",
    orgaoSolicitante: "PREFEITURA MUNICIPAL DE MACAÉ", bdi: "25.00", desonerado: false,
    referencias: [{ fonte: "EMOP", competencia: "2026-09" }, { fonte: "SINAPI", competencia: "2026-09" }],
  });
}

describe("importação de orçamento — análise", () => {
  it("números: planilha, escrita brasileira e americana", () => {
    expect(lerNumero(1234.5)).toBe("1234.5");
    expect(lerNumero(0.1 + 0.2)).toBe("0.3");
    expect(lerNumero("1.234,56")).toBe("1234.56");
    expect(lerNumero("R$ 12,50")).toBe("12.50");
    expect(lerNumero("1.234")).toBe("1234");
    expect(lerNumero("1,234.50")).toBe("1234.50");
    expect(lerNumero("10.5")).toBe("10.5");
    expect(lerNumero("abc")).toBeNull();
    expect(lerNumero("")).toBeNull();
  });

  it("lê .xlsx (escolhe a aba da tabela) e identifica colunas, etapas, itens e dados de cadastro", async () => {
    const abas = await lerPlanilha(await xlsxExemplo());
    expect(abas.map((a) => a.nome)).toEqual(["Capa", "Orçamento"]);
    conferirExemplo(abas[1].grade);
  });

  it("lê .xls (formato antigo do Excel) com o mesmo resultado", async () => {
    const abas = await lerPlanilha(xlsExemplo());
    conferirExemplo(abas[0].grade);
  });

  it("sem títulos reconhecíveis, sugere colunas pelo conteúdo", () => {
    const g: Grade = [
      ["1", "01.001.0001-0", "PLACA DE IDENTIFICACAO DE OBRA PUBLICA", "m2", 4, 264.96],
      ["2", "01.001.0002-0", "TAPUME DE CHAPA DE MADEIRA COMPENSADA", "m2", 10, 80.12],
      ["3", "104658", "PISO PODOTATIL DE ALERTA OU DIRECIONAL", "m", 3, 243.06],
    ];
    const cab = encontrarCabecalho(g);
    expect(cab.linha).toBeNull();
    const a = analisarGrade(g);
    expect(a.mapa).toMatchObject({ item: 0, codigo: 1, descricao: 2, unidade: 3, quantidade: 4 });
    expect(a.porTitulo).toEqual([]);
  });

  it("PDF: remonta a tabela pela posição dos textos, junta descrição quebrada e descarta timbre e rodapé repetidos", () => {
    const t = (texto: string, x: number, y: number, largura = texto.length * 4): TextoPdf => ({ texto, x, y, largura, altura: 8 });
    const cab = (y: number) => [t("Item", 20, y), t("Código", 50, y), t("Descrição", 120, y), t("Und", 330, y), t("Quant.", 370, y), t("Unitário", 420, y), t("Total", 490, y)];
    const pag1 = [
      t("PREFEITURA MUNICIPAL DE MACAÉ", 150, 20), t("Obra: OB-001", 20, 40), t("Processo: SEI-1/2026", 250, 40),
      ...cab(70),
      t("1", 20, 85), t("SERVIÇOS PRELIMINARES", 120, 85),
      t("1.1", 20, 97), t("01.001.0001-0", 50, 97), t("PLACA DE IDENTIFICACAO DE OBRA", 120, 97), t("M2", 332, 97), t("4,00", 380, 97, 16), t("264,96", 430, 97, 24), t("1.059,84", 490, 97, 32),
      t("PUBLICA EM CHAPA GALVANIZADA", 120, 107),
      t("Página 1 de 2", 260, 800),
    ];
    const pag2 = [
      t("PREFEITURA MUNICIPAL DE MACAÉ", 150, 20), ...cab(70),
      t("2", 20, 85), t("ACESSIBILIDADE", 120, 85),
      t("2.1", 20, 97), t("104658", 50, 97), t("PISO PODOTATIL", 120, 97), t("M", 333, 97), t("3,00", 380, 97, 16), t("243,06", 430, 97, 24), t("729,18", 490, 97, 24),
      t("Página 2 de 2", 260, 800),
    ];
    const { grade } = gradeDoPdf([pag1, pag2]);
    const a = analisarGrade(grade);
    expect(a.mapa).toMatchObject({ item: 0, codigo: 1, descricao: 2, unidade: 3, quantidade: 4, custoUnitario: 5, total: 6 });
    expect(a.dados).toMatchObject({ obraCodigo: "OB-001", processo: "SEI-1/2026", orgaoSolicitante: "PREFEITURA MUNICIPAL DE MACAÉ" });
    const linhas = lerLinhas(grade, a.cabecalho, a.mapa, { continuacao: true });
    expect(linhas.map((l) => `${l.tipo}:${l.item}`)).toEqual(["ETAPA:1", "ITEM:1.1", "ETAPA:2", "ITEM:2.1"]);
    expect(linhas[1]).toMatchObject({ descricao: "PLACA DE IDENTIFICACAO DE OBRA PUBLICA EM CHAPA GALVANIZADA", quantidade: "4.00", custoUnitario: "264.96", total: "1059.84" });
  });
});
