/**
 * Boletim de medição e cronograma de desembolso → planilha XLSX (exceljs),
 * com os números como números (para somar e conferir no Excel).
 */
import type ExcelJSType from "exceljs";
import type { Boletim, Desembolso } from "../medicoes/relatorios";
import { dataBr, type OpcoesDocumentoMedicao } from "./medicao-pdf";

type ExcelJS = typeof ExcelJSType;
type Planilha = ExcelJSType.Worksheet;

const FMT2 = "#,##0.00";
const FMT4 = "#,##0.00##";
const CINZA = "FFE2E8F0";
const CLARO = "FFF1F5F9";
const borda = { top: { style: "thin" as const, color: { argb: "FF94A3B8" } }, left: { style: "thin" as const, color: { argb: "FF94A3B8" } }, bottom: { style: "thin" as const, color: { argb: "FF94A3B8" } }, right: { style: "thin" as const, color: { argb: "FF94A3B8" } } };

function timbre(Excel: ExcelJS, wb: ExcelJSType.Workbook, ws: Planilha, cab: Boletim["cabecalho"], nCols: number) {
  if (!cab || (!cab.linhas.length && !cab.logo)) return;
  const inicio = cab.logo ? 3 : 1;
  const n = Math.max(cab.linhas.length, cab.logo ? 4 : 0);
  for (let i = 0; i < n; i++) {
    const r = ws.addRow([]);
    r.getCell(inicio).value = cab.linhas[i] ?? "";
    r.getCell(inicio).font = { bold: true, size: 10 };
    ws.mergeCells(r.number, inicio, r.number, Math.min(nCols, inicio + 6));
  }
  if (cab.logo) {
    const id = wb.addImage({ base64: cab.logo, extension: cab.logo.startsWith("data:image/png") ? "png" : "jpeg" });
    ws.addImage(id, { tl: { col: 0.1, row: ws.rowCount - n + 0.1 }, ext: { width: 60, height: 60 } });
  }
  void Excel;
}

function linhaTexto(ws: Planilha, nCols: number, partes: string, opc: { negrito?: boolean; tamanho?: number } = {}) {
  const r = ws.addRow([partes]);
  ws.mergeCells(r.number, 1, r.number, nCols);
  r.getCell(1).font = { bold: opc.negrito, size: opc.tamanho ?? 10 };
  r.getCell(1).alignment = { wrapText: true, vertical: "top" };
  if (partes.length > 160) r.height = Math.ceil(partes.length / 160) * 14;
  return r;
}

function assinaturasXlsx(ws: Planilha, nCols: number, o: OpcoesDocumentoMedicao) {
  // cada fileira de assinaturas: a largura dividida em 2n+1 faixas, assinaturas nas faixas ímpares
  const fileira = (blocos: string[][]) => {
    if (!blocos.length) return;
    ws.addRow([]); ws.addRow([]);
    const n = blocos.length;
    const faixa = Math.max(1, Math.floor(nCols / (2 * n + 1)));
    const sobra = nCols - faixa * (2 * n + 1);
    const largura = faixa + (n === 1 ? sobra % 2 : 0);
    const altura = Math.max(...blocos.map((b) => b.length));
    const linhas = Array.from({ length: altura }, () => ws.addRow([]));
    blocos.forEach((textos, k) => {
      const c = Math.floor(sobra / 2) + (2 * k + 1) * faixa + 1;
      for (let i = c; i < c + largura; i++) linhas[0].getCell(i).border = { top: { style: "thin" } };
      textos.forEach((t, j) => {
        const cell = linhas[j].getCell(c);
        cell.value = t;
        cell.alignment = { horizontal: "center" };
        cell.font = j === 0 ? { bold: true, size: 10 } : { size: 9 };
      });
      linhas.forEach((r) => ws.mergeCells(r.number, c, r.number, c + largura - 1));
    });
  };
  fileira(o.fiscais.filter((f) => f.nome.trim()).map((f) => [f.nome, f.cargo].filter(Boolean)));
  const e = o.empresa;
  if (e.responsavel.trim() || e.nome.trim()) fileira([[e.responsavel, e.registro, e.nome, e.cnpj ? `CNPJ ${e.cnpj}` : ""].filter(Boolean)]);
}

export async function gerarBoletimXlsx(Excel: ExcelJS, b: Boletim, o: OpcoesDocumentoMedicao): Promise<ArrayBuffer> {
  const m = b.medicao;
  const c = b.contrato;
  const wb = new Excel.Workbook();
  wb.creator = "Orçamento de Obras";
  const ws = wb.addWorksheet(`Medição ${m.numero}`, {
    pageSetup: { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 } },
    headerFooter: { oddFooter: `&L&7${o.rodape.replace(/&/g, "&&")}&RPágina &P de &N` },
  });
  const N = 13;
  [6, 14, 50, 8, 11, 12, 14, 11, 11, 11, 14, 14, 9].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  timbre(Excel, wb, ws, b.cabecalho, N);
  linhaTexto(ws, N, `Medição ${m.numero} — Contrato ${c.numero} — ${dataBr(m.inicio)} à ${dataBr(m.fim)}${o.empenho?.trim() ? ` — Empenho ${o.empenho.trim()}` : ""}`, { negrito: true, tamanho: 12 });
  linhaTexto(ws, N, `Empreiteira: ${c.empresa ?? "—"}`, { negrito: true });
  linhaTexto(ws, N, `Obra: ${c.objeto.toUpperCase()}`);
  linhaTexto(ws, N, `O.S.: ${dataBr(c.dataOs)}    Prazo: ${c.prazoExecucaoDias ? `${c.prazoExecucaoDias} dias` : "—"}    Período: ${m.dias} dias corridos${c.processo ? `    Processo: ${c.processo}` : ""}    Data término: ${dataBr(c.termino)}`);
  ws.addRow([]);
  const h1 = ws.addRow(["Item", "Código", "Descrição", "Unid.", "Quant. Contr.", "Preço Unit. (R$)", "Valor Contr. (R$)", c.porQuantidade ? "Quantitativos" : "Percentuais (%)", "", "", "Valores", "", "%"]);
  const h2 = ws.addRow(["", "", "", "", "", "", "", "Antes", "Medido", "Saldo", "Medido", "Saldo", "Medido"]);
  for (let col = 1; col <= 7; col++) ws.mergeCells(h1.number, col, h2.number, col);
  ws.mergeCells(h1.number, 8, h1.number, 10);
  ws.mergeCells(h1.number, 11, h1.number, 12);
  for (const r of [h1, h2]) r.eachCell({ includeEmpty: true }, (cell) => {
    cell.font = { bold: true, size: 9 }; cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true }; cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: CINZA } }; cell.border = borda;
  });
  ws.views = [{ state: "frozen", ySplit: h2.number }];
  for (const l of b.linhas) {
    if (l.tipo === "grupo") {
      const r = ws.addRow([l.numero, l.titulo, "", "", null, null, Number(l.contratado), null, null, null, Number(l.medido), Number(l.saldo), Number(l.percentual)]);
      ws.mergeCells(r.number, 2, r.number, 4);
      r.eachCell({ includeEmpty: true }, (cell, col) => {
        cell.font = { bold: true, italic: l.nivel > 0 }; cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: l.nivel === 0 ? CINZA : CLARO } }; cell.border = borda;
        if (col >= 5) cell.numFmt = FMT2;
      });
    } else {
      const r = ws.addRow([l.numero ?? "", l.codigo ?? "", l.descricao, l.unidade ?? "", Number(l.quantidade), Number(l.precoUnitario), Number(l.valorTotal),
        Number(l.antes), Number(l.medido), Number(l.saldo), Number(l.valorMedido), Number(l.valorSaldo), Number(l.percentual)]);
      r.eachCell({ includeEmpty: true }, (cell, col) => {
        cell.border = borda;
        cell.alignment = { vertical: "top", wrapText: col === 3 };
        if ([5, 6, 8, 9, 10].includes(col)) cell.numFmt = FMT4;
        if ([7, 11, 12, 13].includes(col)) cell.numFmt = FMT2;
      });
    }
  }
  const t = b.totais;
  ws.addRow([]);
  for (const [rotulo, valor] of [["Total contratado", t.contratado], ["Valor desta medição", t.medicao], ["Medido até a medição anterior", t.anterior], ["Total acumulado", t.acumulado], ["Saldo do contrato", t.saldo]] as const) {
    const r = ws.addRow([]);
    r.getCell(9).value = rotulo; r.getCell(9).font = { bold: true };
    ws.mergeCells(r.number, 9, r.number, 11);
    r.getCell(12).value = Number(valor); r.getCell(12).numFmt = `"R$ "${FMT2}`;
  }
  const rp = ws.addRow([]);
  rp.getCell(9).value = "Percentual acumulado"; rp.getCell(9).font = { bold: true }; ws.mergeCells(rp.number, 9, rp.number, 11);
  rp.getCell(12).value = Number(t.percentualAcumulado) / 100; rp.getCell(12).numFmt = "0.00%";
  if (m.observacao) { ws.addRow([]); linhaTexto(ws, N, `Observações: ${m.observacao}`); }
  if (m.situacao !== "FECHADA") { ws.addRow([]); linhaTexto(ws, N, "MEDIÇÃO NÃO FECHADA — documento de conferência, sujeito a alteração.", { negrito: true }); }
  assinaturasXlsx(ws, N, o);
  return wb.xlsx.writeBuffer() as Promise<ArrayBuffer>;
}

export async function gerarDesembolsoXlsx(Excel: ExcelJS, d: Desembolso, o: OpcoesDocumentoMedicao): Promise<ArrayBuffer> {
  const wb = new Excel.Workbook();
  wb.creator = "Orçamento de Obras";
  const ws = wb.addWorksheet("Desembolso", {
    pageSetup: { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 } },
    headerFooter: { oddFooter: `&L&7${o.rodape.replace(/&/g, "&&")}&RPágina &P de &N` },
  });
  const P = d.periodos.length;
  const N = 3 + P + 1;
  ws.getColumn(1).width = 5; ws.getColumn(2).width = 34; ws.getColumn(3).width = 4;
  for (let k = 0; k < P; k++) ws.getColumn(4 + k).width = 13;
  ws.getColumn(N).width = 15;
  timbre(Excel, wb, ws, d.cabecalho, N);
  linhaTexto(ws, N, `${d.contrato.obraCodigo ? `Obra ${d.contrato.obraCodigo} — ` : ""}${d.contrato.objeto.toUpperCase()}`, { negrito: true });
  linhaTexto(ws, N, `CRONOGRAMA DE DESEMBOLSO — ${d.medicao}ª MEDIÇÃO — Contrato ${d.contrato.numero}`, { negrito: true, tamanho: 12 });
  ws.addRow([]);
  const h1 = ws.addRow(["Nº", "ETAPAS", "", d.rotuloPeriodos, ...Array(P - 1).fill(""), "TOTAL"]);
  const h2 = ws.addRow(["", "", "", ...d.periodos.map((p) => `${p.numero} (${dataBr(p.inicio).slice(0, 5)} a ${dataBr(p.fim).slice(0, 5)})${p.realizado ? "" : " prev."}`), ""]);
  for (const col of [1, 2, 3, N]) ws.mergeCells(h1.number, col, h2.number, col);
  if (P > 1) ws.mergeCells(h1.number, 4, h1.number, 3 + P);
  for (const r of [h1, h2]) r.eachCell({ includeEmpty: true }, (cell) => {
    cell.font = { bold: true, size: 9 }; cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true }; cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: CINZA } }; cell.border = borda;
  });
  for (const g of d.grupos) {
    const rp = ws.addRow([g.numero, g.titulo.toUpperCase(), "%", ...g.percentuais.map((v) => Number(v) / 100), 1]);
    const rv = ws.addRow(["", "", "R$", ...g.valores.map(Number), Number(g.total)]);
    ws.mergeCells(rp.number, 1, rv.number, 1);
    ws.mergeCells(rp.number, 2, rv.number, 2);
    rp.eachCell({ includeEmpty: true }, (cell, col) => { cell.border = borda; if (col > 3) cell.numFmt = "0.00%"; if (col <= 2) { cell.font = { bold: true }; cell.alignment = { vertical: "middle", wrapText: true }; } });
    rv.eachCell({ includeEmpty: true }, (cell, col) => {
      cell.border = borda; if (col > 3) cell.numFmt = FMT2;
      const k = col - 4;
      if (k >= 0 && k < P && Number(g.valores[k]) > 0) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: d.periodos[k].realizado ? "FFCBD5E1" : "FFF1F5F9" } };
    });
  }
  const rm = ws.addRow(["TOTAL", "", "M", ...d.mensal.map(Number), Number(d.total)]);
  const ra = ws.addRow(["", "", "A", ...d.acumulado.map(Number), ""]);
  ws.mergeCells(rm.number, 1, ra.number, 2);
  ws.mergeCells(rm.number, N, ra.number, N);
  for (const r of [rm, ra]) r.eachCell({ includeEmpty: true }, (cell, col) => {
    cell.font = { bold: true }; cell.border = borda; cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: CINZA } }; if (col > 3) cell.numFmt = FMT2;
  });
  ws.addRow([]);
  linhaTexto(ws, N, "Períodos realizados = medições fechadas; demais = previsto. M = valor do período; A = acumulado.", { tamanho: 9 });
  if (o.nota?.trim()) linhaTexto(ws, N, `* ${o.nota.trim()}`, { negrito: true, tamanho: 9 });
  assinaturasXlsx(ws, N, o);
  return wb.xlsx.writeBuffer() as Promise<ArrayBuffer>;
}

/** Memória de cálculo da medição: itens medidos, quantidade/percentual e a memória. */
export async function gerarMemoriaMedicaoXlsx(Excel: ExcelJS, b: Boletim, o: OpcoesDocumentoMedicao): Promise<ArrayBuffer> {
  const m = b.medicao;
  const c = b.contrato;
  const wb = new Excel.Workbook();
  wb.creator = "Orçamento de Obras";
  const ws = wb.addWorksheet(`Memória medição ${m.numero}`, {
    pageSetup: { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 } },
    headerFooter: { oddFooter: `&L&7${o.rodape.replace(/&/g, "&&")}&RPágina &P de &N` },
  });
  const N = 7;
  [7, 14, 50, 8, 12, 60, 12].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  timbre(Excel, wb, ws, b.cabecalho, N);
  linhaTexto(ws, N, `MEMÓRIA DE CÁLCULO — Medição ${m.numero} — Contrato ${c.numero} — ${dataBr(m.inicio)} à ${dataBr(m.fim)}`, { negrito: true, tamanho: 12 });
  linhaTexto(ws, N, `Empreiteira: ${c.empresa ?? "—"}`, { negrito: true });
  linhaTexto(ws, N, `Obra: ${c.objeto.toUpperCase()}`);
  ws.addRow([]);
  const h = ws.addRow(["Item", "Código", "Descrição", "Unid.", c.porQuantidade ? "Quant. medida" : "% medido", "Memória de cálculo", "Resultado"]);
  h.eachCell((cell) => { cell.font = { bold: true, size: 9 }; cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true }; cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: CINZA } }; cell.border = borda; });
  ws.views = [{ state: "frozen", ySplit: h.number }];
  let grupos: Extract<Boletim["linhas"][number], { tipo: "grupo" }>[] = [];
  let algum = false;
  for (const l of b.linhas) {
    if (l.tipo === "grupo") { grupos = [...grupos.filter((g) => g.nivel < l.nivel), l]; continue; }
    if (!Number(l.medido)) continue;
    for (const g of grupos) {
      const r = ws.addRow([g.numero, g.titulo]);
      ws.mergeCells(r.number, 2, r.number, N);
      r.eachCell({ includeEmpty: true }, (cell) => { cell.font = { bold: true, italic: g.nivel > 0 }; cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: g.nivel === 0 ? CINZA : CLARO } }; cell.border = borda; });
    }
    grupos = [];
    algum = true;
    const r = ws.addRow([l.numero ?? "", l.codigo ?? "", l.descricao, l.unidade ?? "", Number(l.medido), l.memoria ?? "—",
      l.memoriaResultado ? `${l.memoriaResultado}${l.memoriaDiverge ? " (difere do medido)" : ""}` : ""]);
    r.eachCell({ includeEmpty: true }, (cell, col) => {
      cell.border = borda;
      cell.alignment = { vertical: "top", wrapText: col === 3 || col === 6 };
      if (col === 5) cell.numFmt = FMT4;
    });
    const linhasMem = (l.memoria ?? "").split("\n").reduce((a, t) => a + Math.max(1, Math.ceil(t.length / 70)), 0);
    r.height = Math.max(15, Math.ceil(l.descricao.length / 60) * 12, linhasMem * 12);
  }
  if (!algum) linhaTexto(ws, N, "Nenhum item medido nesta medição.");
  if (m.situacao !== "FECHADA") { ws.addRow([]); linhaTexto(ws, N, "MEDIÇÃO NÃO FECHADA — documento de conferência, sujeito a alteração.", { negrito: true }); }
  assinaturasXlsx(ws, N, o);
  return wb.xlsx.writeBuffer() as Promise<ArrayBuffer>;
}
