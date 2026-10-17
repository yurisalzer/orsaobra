/**
 * Documento → definição do pdfmake (A4, fonte Roboto). Só monta a estrutura;
 * a geração do arquivo fica com quem chama (navegador ou testes).
 */
import type { Content, TableCell, TDocumentDefinitions } from "pdfmake/interfaces";
import { celula, colunasDaLinha, ehNumerica, formatarCelula, type Documento, type Linha, type Secao } from "./documento";

const COR = { borda: "#cbd5e1", grupo1: "#e2e8f0", grupo2: "#f1f5f9", grupo3: "#f8fafc", total: "#cbd5e1", subtotal: "#f1f5f9", destaque: "#fffbeb", cabecalho: "#1e3a5f" };

function linhaPdf(l: Linha, colunas: NonNullable<Secao["tabela"]>["colunas"]): TableCell[] {
  const saida: TableCell[] = [];
  let col = 0;
  const estilo = l.estilo ?? "normal";
  const fill = estilo === "normal" || estilo === "detalhe" ? undefined : COR[estilo];
  for (const c of l.celulas) {
    const { valor, tipo, span } = celula(c);
    const t = tipo ?? colunas[col]?.tipo ?? "texto";
    const numerica = ehNumerica(t) && span === 1;
    saida.push({
      text: formatarCelula(valor, t),
      colSpan: span > 1 ? span : undefined,
      alignment: numerica ? "right" : "left",
      bold: estilo === "grupo1" || estilo === "total" || estilo === "grupo2",
      italics: estilo === "detalhe",
      color: estilo === "detalhe" ? "#334155" : undefined,
      fontSize: estilo === "detalhe" ? 6.5 : undefined,
      fillColor: fill,
      noWrap: numerica || (t === "codigo" && span === 1),
    });
    for (let i = 1; i < span; i++) saida.push({ text: "" });
    col += span;
  }
  return saida;
}

function secaoPdf(s: Secao, primeira: boolean): Content[] {
  const out: Content[] = [];
  if (s.titulo) out.push({ text: s.titulo, style: "tituloSecao", pageBreak: s.novaPagina && !primeira ? "before" : undefined });
  if (s.campos?.length) {
    out.push({
      table: { widths: ["auto", "*"], body: s.campos.map((c) => [{ text: c.rotulo, bold: true }, { text: c.valor }]) },
      layout: "noBorders", margin: [0, 0, 0, 4],
    });
  }
  if (s.tabela) {
    const t = s.tabela;
    const total = t.colunas.reduce((a, c) => a + c.largura, 0);
    out.push({
      table: {
        headerRows: 1,
        dontBreakRows: true,
        widths: t.colunas.map((c) => `${((c.largura / total) * 100).toFixed(2)}%`),
        body: [
          t.colunas.map((c) => ({ text: c.titulo, style: "cabecalhoTabela", alignment: ehNumerica(c.tipo) ? "right" : "left" })),
          ...t.linhas.map((l) => linhaPdf(l, t.colunas)),
        ],
      },
      layout: {
        hLineWidth: () => 0.4, vLineWidth: () => 0.4, hLineColor: () => COR.borda, vLineColor: () => COR.borda,
        paddingLeft: () => 2, paddingRight: () => 2, paddingTop: () => 1.5, paddingBottom: () => 1.5,
      },
      margin: [0, 2, 0, 6],
    });
  }
  for (const p of s.paragrafos ?? []) out.push({ text: p, style: "paragrafo" });
  return out;
}

export function definicaoPdf(d: Documento): TDocumentDefinitions {
  const timbre: Content[] = d.cabecalho && (d.cabecalho.linhas.length || d.cabecalho.logo)
    ? [{
        columns: [
          ...(d.cabecalho.logo ? [{ image: d.cabecalho.logo, fit: [62, 62] as [number, number], width: 70 }] : []),
          { stack: d.cabecalho.linhas.map((l) => ({ text: l, bold: true, fontSize: 9.5, lineHeight: 1.15 })), margin: [4, 4, 0, 0] as [number, number, number, number], width: "*" },
        ],
        columnGap: 6,
        margin: [0, 0, 0, 4],
      }, { canvas: [{ type: "line", x1: 0, y1: 0, x2: d.orientacao === "paisagem" ? 794 : 547, y2: 0, lineWidth: 0.6, lineColor: COR.cabecalho }], margin: [0, 0, 0, 6] }]
    : [];
  const cabecalho: Content[] = [
    ...timbre,
    { text: d.titulo.toUpperCase(), style: "titulo", alignment: timbre.length ? "center" : "left" },
    {
      // identificação compacta: grade de 3 colunas, pares rótulo/valor lado a lado
      table: {
        widths: ["*", "*", "*"],
        body: d.identificacao.map((linha) => {
          const spans = colunasDaLinha(linha);
          return linha.flatMap((p, i): TableCell[] => [
            { text: [{ text: `${p.rotulo}: `, bold: true }, { text: p.valor }], colSpan: spans[i] > 1 ? spans[i] : undefined },
            ...Array.from({ length: spans[i] - 1 }, (): TableCell => ({ text: "" })),
          ]);
        }),
      },
      layout: { defaultBorder: false, paddingLeft: () => 0, paddingRight: () => 8, paddingTop: () => 0.5, paddingBottom: () => 0.5 },
      margin: [0, 2, 0, 3],
    },
    ...d.avisos.map((a): Content => ({ text: `Atenção: ${a}`, style: "aviso" })),
  ];
  return {
    pageSize: "A4",
    pageOrientation: d.orientacao === "paisagem" ? "landscape" : "portrait",
    pageMargins: [24, 28, 24, 30],
    info: { title: d.titulo, creator: "Orçamento de Obras", subject: d.identificacao.flat().map((i) => `${i.rotulo}: ${i.valor}`).join(" | ") },
    defaultStyle: { font: "Roboto", fontSize: 7.5, lineHeight: 1.1 },
    styles: {
      titulo: { fontSize: 12, bold: true, color: COR.cabecalho, margin: [0, 0, 0, 4] },
      tituloSecao: { fontSize: 9.5, bold: true, color: COR.cabecalho, margin: [0, 6, 0, 3] },
      cabecalhoTabela: { bold: true, color: "#ffffff", fillColor: COR.cabecalho, fontSize: 7 },
      paragrafo: { fontSize: 7, color: "#334155", margin: [0, 1, 0, 2] },
      aviso: { fontSize: 7.5, bold: true, color: "#92400e", margin: [0, 1, 0, 2] },
    },
    footer: (pagina: number, total: number) => ({
      columns: [
        { text: d.rodape, fontSize: 6.5, color: "#64748b" },
        { text: `Página ${pagina} de ${total}`, fontSize: 6.5, color: "#64748b", alignment: "right", width: 70 },
      ],
      margin: [24, 8, 24, 0],
    }),
    content: [...cabecalho, ...d.secoes.flatMap((s, i) => secaoPdf(s, i === 0))],
  };
}
