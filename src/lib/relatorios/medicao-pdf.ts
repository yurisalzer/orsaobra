/**
 * Boletim de medição e cronograma de desembolso → definição do pdfmake
 * (A4 paisagem), na diagramação do modelo da Prefeitura de Macaé: cabeçalho
 * repetido em todas as páginas com a medição, o contrato, o período e o empenho.
 */
import type { Content, TableCell, TDocumentDefinitions } from "pdfmake/interfaces";
import { formatarNumero } from "../calculo/decimal";
import type { Boletim, Desembolso } from "../medicoes/relatorios";

export interface OpcoesDocumentoMedicao {
  empenho?: string;
  /** assinaturas no fim do documento */
  assinaturas: { nome: string; cargo: string }[];
  /** nota no pé do cronograma (ex.: limite de 90% dos pagamentos) */
  nota?: string;
  rodape: string;
}

const COR = { borda: "#64748b", grupo: "#e2e8f0", subgrupo: "#f1f5f9", total: "#cbd5e1", realizado: "#111827", previsto: "#9ca3af" };
export const dataBr = (d: string | null) => (d ? d.split("-").reverse().join("/") : "—");
const casas = (v: string) => Math.min(Math.max((v.split(".")[1] ?? "").replace(/0+$/, "").length, 2), 4);
export const n2 = (v: string) => formatarNumero(v, 2);
export const nq = (v: string) => formatarNumero(v, casas(v));
const moeda = (v: string) => `R$ ${n2(v)}`;
const LARGURA = 842 - 40;

function timbre(cab: Boletim["cabecalho"], largura: number): Content {
  if (!cab || (!cab.linhas.length && !cab.logo)) return { text: "", width: largura } as Content;
  return {
    width: largura,
    columns: [
      ...(cab.logo ? [{ image: cab.logo, fit: [52, 52] as [number, number], width: 58 }] : []),
      { width: "*", stack: cab.linhas.map((l) => ({ text: l, bold: true, fontSize: 7.5, lineHeight: 1.15 })), margin: [2, 4, 0, 0] as [number, number, number, number] },
    ],
    columnGap: 4,
  } as Content;
}

const LARG_ASSINATURA = 230;

/**
 * Assinaturas lado a lado, cada uma num bloco de largura fixa (linha, nome e
 * cargo centralizados no mesmo bloco), distribuídas por igual na largura da página.
 */
function assinaturas(a: OpcoesDocumentoMedicao["assinaturas"]): Content {
  const validas = a.filter((x) => x.nome.trim() || x.cargo.trim());
  if (!validas.length) return { text: "" };
  const espaco = { width: "*", text: "" };
  const blocos = validas.map((x) => ({
    width: LARG_ASSINATURA,
    stack: [
      { canvas: [{ type: "line", x1: 0, y1: 0, x2: LARG_ASSINATURA, y2: 0, lineWidth: 0.6 }] },
      { text: x.nome.trim() || " ", alignment: "center", fontSize: 8.5, margin: [0, 3, 0, 0] },
      { text: x.cargo.trim() || " ", alignment: "center", fontSize: 7.5, color: "#334155" },
    ],
  }));
  return {
    columns: [espaco, ...blocos.flatMap((b) => [b, espaco])],
    columnGap: 0,
    margin: [0, 40, 0, 0],
    unbreakable: true,
  } as Content;
}

// ---------------------------------------------------------------------------
// Boletim de medição
// ---------------------------------------------------------------------------

export function definicaoBoletim(b: Boletim, o: OpcoesDocumentoMedicao): TDocumentDefinitions {
  const m = b.medicao;
  const c = b.contrato;
  const linhasObjeto = Math.ceil(c.objeto.length / 125);
  const topo = 112 + linhasObjeto * 12;
  const header = (pagina: number, total: number): Content => ({
    margin: [20, 14, 20, 0],
    stack: [
      {
        columns: [
          timbre(b.cabecalho, 330),
          { width: "*", stack: [{ text: `Medição ${m.numero}`, fontSize: 13 }, { text: `Contrato ${c.numero}`, fontSize: 13, margin: [0, 4, 0, 0] }], margin: [0, 6, 0, 0] },
          {
            width: 190,
            table: {
              widths: ["*", "auto"],
              body: [
                [{ text: "" }, { text: `${dataBr(m.inicio)} à ${dataBr(m.fim)}`, fontSize: 9, alignment: "right" }],
                [{ text: o.empenho?.trim() ? "Empenho" : "", fontSize: 13, alignment: "right" }, { text: o.empenho?.trim() ?? "", fontSize: 9, alignment: "right", margin: [0, 4, 0, 0] }],
              ],
            },
            layout: "noBorders",
            margin: [0, 6, 0, 0],
          },
        ],
      },
      {
        columns: [
          { text: [{ text: "Empreiteira:   ", bold: true }, { text: c.empresa ?? "—" }], fontSize: 9.5, width: "*" },
          { text: `Página ${pagina} de ${total}`, fontSize: 8, alignment: "right", width: 90 },
        ],
        margin: [0, 6, 0, 2],
      },
      { canvas: [{ type: "line", x1: 0, y1: 0, x2: LARGURA, y2: 0, lineWidth: 0.6 }] },
      { text: [{ text: "Obra: ", bold: true }, { text: c.objeto.toUpperCase() }], fontSize: 9.5, alignment: "justify", margin: [0, 5, 0, 3] },
      {
        columns: [
          { text: [{ text: "O.S.: ", bold: true }, dataBr(c.dataOs)], fontSize: 8.5 },
          { text: [{ text: "Prazo: ", bold: true }, c.prazoExecucaoDias ? `${c.prazoExecucaoDias} dias` : "—"], fontSize: 8.5 },
          { text: [{ text: "Período: ", bold: true }, `${m.dias} dias corridos`], fontSize: 8.5 },
          { text: c.processo ? [{ text: "Processo: ", bold: true }, c.processo] : "", fontSize: 8.5 },
          { text: [{ text: "Data término: ", bold: true }, dataBr(c.termino)], fontSize: 8.5, alignment: "right" },
        ],
      },
    ],
  });

  const qtdOuPct = c.porQuantidade ? "Quantitativos" : "Percentuais (%)";
  const cab = (t: string, extra: object = {}): TableCell => ({ text: t, bold: true, alignment: "center", fontSize: 7, ...extra });
  const corpo: TableCell[][] = [
    [
      cab("Item", { rowSpan: 2 }), cab("Código", { rowSpan: 2 }), cab("Descrição", { rowSpan: 2 }), cab("Unid.", { rowSpan: 2 }),
      cab("Quant.\nContr.", { rowSpan: 2 }), cab("Preço\nUnit. (R$)", { rowSpan: 2 }), cab("Valor\nContr. (R$)", { rowSpan: 2 }),
      cab(qtdOuPct, { colSpan: 3 }), "", "", cab("Valores", { colSpan: 2 }), "", cab("%"),
    ],
    ["", "", "", "", "", "", "", cab("Antes"), cab("Medido"), cab("Saldo"), cab("Medido"), cab("Saldo"), cab("Medido")],
  ];
  const num = (t: string, extra: object = {}): TableCell => ({ text: t, alignment: "right", noWrap: true, ...extra });
  for (const l of b.linhas) {
    if (l.tipo === "grupo") {
      const fill = l.nivel === 0 ? COR.grupo : COR.subgrupo;
      const est = { bold: true, fillColor: fill, fontSize: l.nivel === 0 ? 8.5 : 7.5, italics: l.nivel > 0 };
      corpo.push([
        { text: l.numero, ...est }, { text: l.titulo, colSpan: 3, ...est }, "", "", { text: "", fillColor: fill }, { text: "", fillColor: fill },
        num(n2(l.contratado), { fillColor: fill, bold: true }), { text: "", fillColor: fill }, { text: "", fillColor: fill }, { text: "", fillColor: fill },
        num(n2(l.medido), { fillColor: fill, bold: true }), num(n2(l.saldo), { fillColor: fill, bold: true }), num(n2(l.percentual), { fillColor: fill, bold: true }),
      ]);
    } else {
      corpo.push([
        { text: l.numero ?? "" }, { text: l.codigo ?? "", fontSize: 6.5 }, { text: l.descricao }, { text: l.unidade ?? "", alignment: "center" },
        num(nq(l.quantidade)), num(nq(l.precoUnitario)), num(n2(l.valorTotal)),
        num(nq(l.antes)), num(nq(l.medido)), num(nq(l.saldo)), num(n2(l.valorMedido)), num(n2(l.valorSaldo)), num(n2(l.percentual)),
      ]);
    }
  }
  const t = b.totais;
  const conteudo: Content[] = [
    {
      table: { headerRows: 2, dontBreakRows: true, widths: [24, 50, "*", 30, 46, 50, 58, 46, 46, 46, 56, 58, 30], body: corpo },
      layout: {
        hLineWidth: (i: number) => (i <= 2 ? 0.8 : 0.3), vLineWidth: () => 0.4, hLineColor: () => COR.borda, vLineColor: () => COR.borda,
        paddingLeft: () => 2, paddingRight: () => 2, paddingTop: () => 1.5, paddingBottom: () => 1.5,
      },
    },
    {
      unbreakable: true,
      stack: [
        {
          columns: [
            { text: [{ text: "Total Contratado: ", bold: true }, moeda(t.contratado)], fontSize: 10, alignment: "center" },
            { text: [{ text: "Valor Medição: ", bold: true }, moeda(t.medicao)], fontSize: 10, alignment: "right" },
          ],
          margin: [0, 8, 0, 2],
        },
        { text: [{ text: "Total Acumulado: ", bold: true }, `${moeda(t.acumulado)} (${n2(t.percentualAcumulado)}%)`], fontSize: 10, alignment: "right" },
        {
          margin: [0, 6, 0, 0],
          table: {
            widths: ["auto", "auto"],
            body: [
              [{ text: "Dados do contrato", bold: true, colSpan: 2, fontSize: 8.5 }, ""],
              ["Valor do contrato", moeda(t.contratado)],
              ["Medido até a medição anterior", moeda(t.anterior)],
              ["Saldo após esta medição", moeda(t.saldo)],
              ...(c.regimeNome ? [["Regime de execução", c.regimeNome]] : []),
            ],
          },
          layout: "noBorders",
          fontSize: 8,
        } as Content,
        ...(m.observacao ? [{ text: [{ text: "Observações: ", bold: true }, m.observacao], fontSize: 8, margin: [0, 6, 0, 0] } as Content] : []),
        ...(m.situacao !== "FECHADA" ? [{ text: "MEDIÇÃO NÃO FECHADA — documento de conferência, sujeito a alteração.", bold: true, color: "#b45309", fontSize: 9, margin: [0, 6, 0, 0] } as Content] : []),
        assinaturas(o.assinaturas),
      ],
    } as Content,
  ];
  return {
    pageSize: "A4",
    pageOrientation: "landscape",
    pageMargins: [20, topo, 20, 26],
    info: { title: `Medição ${m.numero} — Contrato ${c.numero}`, creator: "Orçamento de Obras" },
    defaultStyle: { font: "Roboto", fontSize: 7, lineHeight: 1.1 },
    header,
    footer: () => ({ text: o.rodape, fontSize: 6.5, color: "#64748b", margin: [20, 8, 20, 0] }),
    content: conteudo,
  };
}

// ---------------------------------------------------------------------------
// Cronograma de desembolso
// ---------------------------------------------------------------------------

const POR_PAGINA = 10;

export function definicaoDesembolso(d: Desembolso, o: OpcoesDocumentoMedicao): TDocumentDefinitions {
  const header = (): Content => ({
    margin: [20, 14, 20, 0],
    columns: [
      timbre(d.cabecalho, 300),
      { text: d.contrato.obraCodigo ? `Obra ${d.contrato.obraCodigo}` : "", bold: true, fontSize: 8.5, alignment: "center", width: 120, margin: [0, 18, 0, 0] },
      { text: d.contrato.objeto.toUpperCase(), bold: true, fontSize: 8.5, alignment: "right", width: "*", margin: [0, 18, 0, 0] },
    ],
  });
  const blocos: number[][] = [];
  // páginas com o mesmo número de períodos (12 → 6 + 6, e não 10 + 2)
  const porPagina = Math.ceil(d.periodos.length / Math.max(1, Math.ceil(d.periodos.length / POR_PAGINA)));
  for (let i = 0; i < d.periodos.length; i += porPagina) blocos.push(d.periodos.slice(i, i + porPagina).map((_, k) => i + k));
  if (!blocos.length) blocos.push([]);
  const conteudo: Content[] = [];
  blocos.forEach((idx, b) => {
    const ultimoBloco = b === blocos.length - 1;
    const cabCell = (t: string, extra: object = {}): TableCell => ({ text: t, bold: true, alignment: "center", fontSize: 7.5, ...extra });
    const corpo: TableCell[][] = [
      [cabCell("Nº", { rowSpan: 2, margin: [0, 10, 0, 0] }), cabCell("ETAPAS", { rowSpan: 2, margin: [0, 10, 0, 0] }), cabCell("", { rowSpan: 2 }),
        ...(idx.length ? [cabCell(`${d.rotuloPeriodos}${blocos.length > 1 ? ` (${b + 1}/${blocos.length})` : ""}`, { colSpan: idx.length }), ...idx.slice(1).map(() => "")] : []),
        cabCell("TOTAL", { rowSpan: 2, margin: [0, 10, 0, 0] })],
      ["", "", "", ...idx.map((k): TableCell => {
        const p = d.periodos[k];
        return { stack: [{ text: String(p.numero), bold: true, fontSize: 8 }, { text: `${dataBr(p.inicio).slice(0, 5)} a ${dataBr(p.fim).slice(0, 5)}`, fontSize: 5.5, color: "#475569" }], alignment: "center" };
      }), ""],
    ];
    for (const g of d.grupos) {
      corpo.push([
        { text: g.numero, rowSpan: 3, bold: true, margin: [0, 12, 0, 0] }, { text: g.titulo.toUpperCase(), rowSpan: 3, bold: true, margin: [0, 10, 0, 0] }, { text: "%", bold: true, alignment: "center" },
        ...idx.map((k): TableCell => ({ text: `${n2(g.percentuais[k])}%`, alignment: "center" })),
        { text: "100,00%", alignment: "center" },
      ]);
      corpo.push(["", "", "",
        ...idx.map((k): TableCell => (Number(g.valores[k]) > 0
          ? { text: " ", fillColor: d.periodos[k].realizado ? COR.realizado : COR.previsto, fontSize: 5 }
          : { text: " ", fontSize: 5 })),
        { text: " ", fontSize: 5 }]);
      corpo.push(["", "", { text: "R$", bold: true, alignment: "center" },
        ...idx.map((k): TableCell => ({ text: Number(g.valores[k]) ? n2(g.valores[k]) : "-", alignment: "right" })),
        { text: n2(g.total), alignment: "right" }]);
    }
    corpo.push([{ text: "TOTAL", colSpan: 2, rowSpan: 2, bold: true, alignment: "center", margin: [0, 6, 0, 0], fillColor: COR.grupo }, "", { text: "M", bold: true, alignment: "center", fillColor: COR.grupo },
      ...idx.map((k): TableCell => ({ text: n2(d.mensal[k]), alignment: "right", fillColor: COR.grupo })),
      { text: n2(d.total), rowSpan: 2, bold: true, alignment: "right", margin: [0, 6, 0, 0], fillColor: COR.grupo }]);
    corpo.push(["", "", { text: "A", bold: true, alignment: "center", fillColor: COR.grupo },
      ...idx.map((k): TableCell => ({ text: n2(d.acumulado[k]), alignment: "right", fillColor: COR.grupo })), ""]);
    conteudo.push({
      text: `CRONOGRAMA DE DESEMBOLSO — ${d.medicao}ª MEDIÇÃO`, bold: true, fontSize: 9.5, alignment: "center", margin: [0, 0, 0, 4],
      pageBreak: b > 0 ? "before" : undefined,
    });
    conteudo.push({
      table: { headerRows: 2, dontBreakRows: true, widths: [16, 120, 14, ...idx.map(() => "*" as const), 66], body: corpo },
      layout: {
        hLineWidth: () => 0.5, vLineWidth: () => 0.5, hLineColor: () => COR.borda, vLineColor: () => COR.borda,
        paddingLeft: () => 2, paddingRight: () => 2, paddingTop: () => 2, paddingBottom: () => 2,
      },
    });
    if (ultimoBloco) {
      conteudo.push({
        columns: [
          { width: "auto", canvas: [{ type: "rect", x: 0, y: 2, w: 16, h: 6, color: COR.realizado }] },
          { width: "auto", text: "Realizado (medições fechadas)", fontSize: 7, margin: [3, 1, 14, 0] },
          { width: "auto", canvas: [{ type: "rect", x: 0, y: 2, w: 16, h: 6, color: COR.previsto }] },
          { width: "auto", text: "Previsto", fontSize: 7, margin: [3, 1, 14, 0] },
          { width: "*", text: "M = valor do período · A = acumulado", fontSize: 7, color: "#475569", margin: [0, 1, 0, 0] },
        ],
        margin: [0, 4, 0, 0],
      });
      if (o.nota?.trim()) conteudo.push({ text: `* ${o.nota.trim()}`, bold: true, fontSize: 7.5, margin: [0, 4, 0, 0] });
      conteudo.push(assinaturas(o.assinaturas));
    }
  });
  return {
    pageSize: "A4",
    pageOrientation: "landscape",
    pageMargins: [20, 80, 20, 26],
    info: { title: `Cronograma de desembolso — ${d.medicao}ª medição — Contrato ${d.contrato.numero}`, creator: "Orçamento de Obras" },
    defaultStyle: { font: "Roboto", fontSize: 7, lineHeight: 1.1 },
    header,
    footer: (pagina: number, total: number) => ({
      columns: [{ text: o.rodape, fontSize: 6.5, color: "#64748b" }, { text: `Página ${pagina} de ${total}`, fontSize: 6.5, color: "#64748b", alignment: "right", width: 70 }],
      margin: [20, 8, 20, 0],
    }),
    content: conteudo,
  };
}
