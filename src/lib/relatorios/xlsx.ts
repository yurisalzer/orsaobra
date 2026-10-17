/**
 * Documento → planilha XLSX (exceljs). Números vão como números (com formato
 * pt-BR de exibição), para o usuário poder somar e conferir no Excel.
 * O módulo exceljs é recebido como parâmetro: no navegador ele é carregado
 * só quando o usuário pede a planilha.
 */
import type ExcelJSType from "exceljs";
import { casasDoValor, celula, ehNumerica, type Documento, type TipoColuna } from "./documento";

type ExcelJS = typeof ExcelJSType;

const PREENCHIMENTO: Record<string, string> = { grupo1: "FFE2E8F0", grupo2: "FFF1F5F9", grupo3: "FFF8FAFC", total: "FFCBD5E1", subtotal: "FFF1F5F9", destaque: "FFFFFBEB" };

function formato(tipo: TipoColuna, valor: string): string {
  if (tipo === "percentual") return "0.00\"%\"";
  if (tipo === "inteiro") return "0";
  const casas = casasDoValor(tipo, valor);
  return casas > 0 ? `#,##0.${"0".repeat(casas)}` : "#,##0";
}

export async function gerarXlsx(Excel: ExcelJS, d: Documento): Promise<ArrayBuffer> {
  const wb = new Excel.Workbook();
  wb.creator = "Orçamento de Obras";
  wb.title = d.titulo;
  const ws = wb.addWorksheet(d.titulo.slice(0, 31), {
    pageSetup: { paperSize: 9, orientation: d.orientacao === "paisagem" ? "landscape" : "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } },
    headerFooter: { oddFooter: `&L&7${d.rodape.replace(/&/g, "&&")}&R&7Página &P de &N` },
  });
  const nCols = Math.max(2, ...d.secoes.map((s) => s.tabela?.colunas.length ?? 2));
  // larguras: da maior tabela
  const principal = d.secoes.find((s) => s.tabela && s.tabela.colunas.length === nCols)?.tabela;
  if (principal) {
    const total = principal.colunas.reduce((a, c) => a + c.largura, 0);
    principal.colunas.forEach((c, i) => { ws.getColumn(i + 1).width = Math.max(6, Math.round((c.largura / total) * 160)); });
  }
  const mesclar = (linha: number, de: number, ate: number) => { if (ate > de) ws.mergeCells(linha, de, linha, ate); };
  const texto = (valor: string, opc: { negrito?: boolean; tamanho?: number; cor?: string } = {}) => {
    const r = ws.addRow([valor]);
    mesclar(r.number, 1, nCols);
    r.getCell(1).font = { bold: opc.negrito, size: opc.tamanho ?? 9, color: opc.cor ? { argb: opc.cor } : undefined };
    r.getCell(1).alignment = { wrapText: true, vertical: "top" };
    if (valor.length > 140) r.height = Math.ceil(valor.length / 140) * 12;
    return r;
  };

  // timbre: logo nas primeiras colunas e as linhas de texto ao lado
  if (d.cabecalho && (d.cabecalho.linhas.length || d.cabecalho.logo)) {
    const comLogo = !!d.cabecalho.logo;
    const n = Math.max(d.cabecalho.linhas.length, comLogo ? 4 : 0);
    const inicio = comLogo ? 3 : 1;
    for (let i = 0; i < n; i++) {
      const r = ws.addRow([]);
      r.height = 17;
      const cell = r.getCell(inicio);
      cell.value = d.cabecalho.linhas[i] ?? "";
      cell.font = { bold: true, size: 11 };
      mesclar(r.number, inicio, nCols);
    }
    if (comLogo) {
      const tipo = d.cabecalho.logo!.startsWith("data:image/png") ? "png" : "jpeg";
      const img = wb.addImage({ base64: d.cabecalho.logo!, extension: tipo });
      ws.addImage(img, { tl: { col: 0.15, row: 0.15 }, ext: { width: 80, height: 80 }, editAs: "oneCell" });
    }
    ws.addRow([]);
  }
  texto(d.titulo.toUpperCase(), { negrito: true, tamanho: 13, cor: "FF1E3A5F" });
  for (const i of d.identificacao) {
    const r = ws.addRow([i.rotulo, i.valor]);
    mesclar(r.number, 2, nCols);
    r.getCell(1).font = { bold: true, size: 9 };
    r.getCell(2).font = { size: 9 };
    r.getCell(2).alignment = { wrapText: true, vertical: "top" };
  }
  for (const a of d.avisos) texto(`Atenção: ${a}`, { negrito: true, cor: "FF92400E" });
  ws.addRow([]);

  let primeiraTabela = true;
  for (const s of d.secoes) {
    if (s.titulo) texto(s.titulo, { negrito: true, tamanho: 11, cor: "FF1E3A5F" });
    for (const c of s.campos ?? []) {
      const r = ws.addRow([c.rotulo, c.valor]);
      mesclar(r.number, 2, nCols);
      r.getCell(1).font = { bold: true, size: 9 };
      r.getCell(2).alignment = { wrapText: true };
    }
    if (s.tabela) {
      const t = s.tabela;
      const cab = ws.addRow(t.colunas.map((c) => c.titulo));
      cab.eachCell((cell) => {
        cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 9 };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A5F" } };
        cell.alignment = { wrapText: true, vertical: "middle" };
      });
      if (primeiraTabela) {
        ws.views = [{ state: "frozen", ySplit: cab.number }];
        ws.pageSetup.printTitlesRow = `${cab.number}:${cab.number}`;
        primeiraTabela = false;
      }
      for (const l of t.linhas) {
        const r = ws.addRow([]);
        let col = 1;
        for (const c of l.celulas) {
          const { valor, tipo, span } = celula(c);
          const tp = tipo ?? t.colunas[col - 1]?.tipo ?? "texto";
          const cell = r.getCell(col);
          if (valor !== null && valor !== "" && ehNumerica(tp) && span === 1 && /^-?\d+(\.\d+)?$/.test(valor)) {
            cell.value = Number(valor);
            cell.numFmt = formato(tp, valor);
          } else {
            cell.value = valor ?? "";
            cell.alignment = { wrapText: true, vertical: "top" };
          }
          mesclar(r.number, col, col + span - 1);
          col += span;
        }
        const estilo = l.estilo ?? "normal";
        r.eachCell({ includeEmpty: true }, (cell) => {
          cell.font = { size: estilo === "detalhe" ? 8 : 9, bold: ["grupo1", "grupo2", "total"].includes(estilo), italic: estilo === "detalhe" };
          if (PREENCHIMENTO[estilo]) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: PREENCHIMENTO[estilo] } };
          cell.border = { top: { style: "hair", color: { argb: "FFCBD5E1" } }, bottom: { style: "hair", color: { argb: "FFCBD5E1" } } };
        });
      }
    }
    for (const p of s.paragrafos ?? []) texto(p, { tamanho: 8, cor: "FF334155" });
    ws.addRow([]);
  }
  texto(d.rodape, { tamanho: 8, cor: "FF64748B" });
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}
