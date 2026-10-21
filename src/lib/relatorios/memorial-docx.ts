/**
 * Memorial descritivo → .docx (biblioteca docx, no navegador ou nos testes).
 * Formatação do modelo: A4 retrato, Arial 10 pt, entrelinha 1,15, parágrafos
 * justificados com recuo de 0,75 cm na primeira linha, títulos em negrito,
 * cabeçalho com logo e linhas do cabeçalho do orçamento, data à direita e
 * número da página no rodapé.
 */
import type * as Docx from "docx";
import type { MemorialParaGerar } from "./memorial";

type LibDocx = typeof Docx;

const TW = { recuo: 425, depoisCorpo: 200, depoisTitulo1: 220, depoisTitulo2: 120 };

export function paragrafosDe(texto: string): string[] {
  return texto.split(/\n+/).map((p) => p.trim()).filter(Boolean);
}

function base64ParaBytes(dataUrl: string): { bytes: Uint8Array; tipo: "png" | "jpg" } {
  const [cab, b64] = dataUrl.split(",");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { bytes, tipo: /jpe?g/i.test(cab) ? "jpg" : "png" };
}

/** largura/altura do logo em pixels (96 dpi) — o modelo usa ~1,5 cm de altura */
export interface OpcoesDocx { logo?: { largura: number; altura: number } }

export async function gerarDocx(lib: LibDocx, m: MemorialParaGerar, o: OpcoesDocx = {}): Promise<Blob | Uint8Array> {
  const { AlignmentType, BorderStyle, Document, Footer, Header, ImageRun, Packer, PageNumber, Paragraph, Table, TableCell, TableRow, TextRun, VerticalAlign, WidthType } = lib;
  const semBorda = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
  const bordas = { top: semBorda, bottom: semBorda, left: semBorda, right: semBorda, insideHorizontal: semBorda, insideVertical: semBorda };

  const cab = m.cabecalho;
  const linhas = cab?.linhas ?? [];
  const altura = 55;
  const logo = cab?.logo ? base64ParaBytes(cab.logo) : null;
  const dims = o.logo ?? { largura: altura, altura };
  const escala = altura / dims.altura;
  const celulaLinhas = (largura: number) => new TableCell({
    borders: bordas, width: { size: largura, type: WidthType.DXA }, verticalAlign: VerticalAlign.CENTER,
    children: [new Paragraph({ spacing: { after: 0 }, children: linhas.map((l, i) => new TextRun({ text: l, bold: true, size: 18, break: i > 0 ? 1 : undefined })) })],
  });
  const timbre = !cab || !(linhas.length || logo) ? [] : logo
    ? [new Table({
        borders: bordas,
        width: { size: 6628, type: WidthType.DXA },
        columnWidths: [1809, 4819],
        rows: [new TableRow({
          children: [
            new TableCell({
              borders: bordas, width: { size: 1809, type: WidthType.DXA }, verticalAlign: VerticalAlign.CENTER,
              children: [new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [new ImageRun({ type: logo.tipo, data: logo.bytes, transformation: { width: Math.round(dims.largura * escala), height: altura } })],
              })],
            }),
            celulaLinhas(4819),
          ],
        })],
      })]
    : [new Table({ borders: bordas, width: { size: 6628, type: WidthType.DXA }, columnWidths: [6628], rows: [new TableRow({ children: [celulaLinhas(6628)] })] })];

  const corpo: (InstanceType<typeof Paragraph>)[] = [
    new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "Memorial Descritivo", bold: true, italics: true, size: 28 })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 20 }, children: [new TextRun({ text: m.obra, bold: true })] }),
    new Paragraph({ spacing: { after: TW.depoisTitulo1 }, children: [] }),
  ];
  for (const s of m.secoes) {
    corpo.push(new Paragraph({
      keepNext: true,
      spacing: { after: s.nivel === 1 ? TW.depoisTitulo1 : TW.depoisTitulo2 },
      children: [new TextRun({ text: s.titulo, bold: true })],
    }));
    for (const p of paragrafosDe(s.texto)) {
      corpo.push(new Paragraph({
        alignment: AlignmentType.JUSTIFIED,
        indent: { firstLine: TW.recuo },
        spacing: { after: TW.depoisCorpo },
        children: [new TextRun({ text: s.destaque ? p.toUpperCase() : p, bold: !!s.destaque })],
      }));
    }
  }

  const doc = new Document({
    creator: "Orçamento de Obras",
    title: `Memorial Descritivo — ${m.obra}`,
    styles: {
      default: {
        document: { run: { font: "Arial", size: 20 }, paragraph: { spacing: { after: TW.depoisCorpo, line: 276 } } },
      },
    },
    sections: [{
      properties: {
        page: {
          size: { width: 11906, height: 16838 },
          margin: { top: 1807, right: 1134, bottom: 1134, left: 1134, header: 340, footer: 454 },
        },
      },
      headers: {
        default: new Header({
          children: [
            ...timbre,
            new Paragraph({ alignment: AlignmentType.RIGHT, spacing: { after: 0 }, children: [new TextRun({ text: m.data, size: 16 })] }),
          ],
        }),
      },
      footers: {
        default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ children: [PageNumber.CURRENT] })] })] }),
      },
      children: corpo,
    }],
  });
  return typeof window === "undefined" ? Packer.toBuffer(doc) : Packer.toBlob(doc);
}
