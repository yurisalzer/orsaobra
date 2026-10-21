/**
 * Memorial descritivo → definição do pdfmake, com a mesma diagramação do
 * .docx: A4 retrato, margens de 2 cm (3,19 cm no topo, para o cabeçalho),
 * texto de 10 pt justificado com recuo na primeira linha e número da página
 * no rodapé.
 */
import type { Content, TDocumentDefinitions } from "pdfmake/interfaces";
import type { MemorialParaGerar } from "./memorial";
import { paragrafosDe } from "./memorial-docx";

const PT = (cm: number) => (cm / 2.54) * 72;

export function definicaoPdfMemorial(m: MemorialParaGerar): TDocumentDefinitions {
  const cab = m.cabecalho;
  const margem = PT(2);
  const header = (): Content => ({
    margin: [margem, PT(0.6), margem, 0],
    stack: [
      cab && (cab.linhas.length || cab.logo)
        ? {
            columns: [
              { width: 90, stack: cab.logo ? [{ image: cab.logo, fit: [44, 44], alignment: "center" }] : [{ text: "" }] },
              { width: "*", stack: cab.linhas.map((l) => ({ text: l, bold: true, fontSize: 9, lineHeight: 1.05 })), margin: [0, 2, 0, 0] },
            ],
            columnGap: 0,
          }
        : { text: "" },
      { text: m.data, fontSize: 8, alignment: "right", margin: [0, 2, 0, 0] },
    ],
  });
  const conteudo: Content[] = [
    { text: "Memorial Descritivo", bold: true, italics: true, fontSize: 14, alignment: "center", margin: [0, 0, 0, 10] },
    { text: m.obra, bold: true, alignment: "center", margin: [0, 0, 0, 22] },
  ];
  for (const s of m.secoes) {
    conteudo.push({ text: s.titulo, bold: true, margin: [0, 0, 0, s.nivel === 1 ? 11 : 6], headlineLevel: 1 } as Content);
    for (const p of paragrafosDe(s.texto)) {
      conteudo.push({ text: s.destaque ? p.toUpperCase() : p, bold: !!s.destaque, alignment: "justify", leadingIndent: PT(0.75), margin: [0, 0, 0, 10] });
    }
  }
  return {
    pageSize: "A4",
    pageOrientation: "portrait",
    pageMargins: [margem, PT(3.19), margem, margem],
    info: { title: `Memorial Descritivo — ${m.obra}`, creator: "Orçamento de Obras" },
    defaultStyle: { font: "Roboto", fontSize: 10, lineHeight: 1.15 },
    header,
    footer: (pagina: number) => ({ text: String(pagina), alignment: "right", fontSize: 10, margin: [margem, PT(0.4), margem, 0] }),
    // título de seção não fica sozinho no pé da página
    pageBreakBefore: (atual, q) => !!(atual as { headlineLevel?: number }).headlineLevel && q.getFollowingNodesOnPage().length === 0,
    content: conteudo,
  };
}
