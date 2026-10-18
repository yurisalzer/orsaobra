/**
 * Leitura do arquivo do orçamento a importar (no navegador; também usado nos
 * testes). Planilhas (.xls e .xlsx) pela SheetJS; PDF pelo pdf.js, remontando
 * a tabela a partir da posição de cada texto na página.
 *
 * PDF digitalizado (imagem) não tem texto: não há como ler sem OCR.
 */
import { campoDoTitulo, normalizar, type Campo, type Grade } from "./analisar";

export class ErroLeitura extends Error {}

export interface AbaLida {
  nome: string;
  grade: Grade;
}

export async function lerPlanilha(dados: ArrayBuffer): Promise<AbaLida[]> {
  const XLSX = await import("xlsx");
  let wb;
  try {
    wb = XLSX.read(dados, { type: "array", cellDates: false, cellFormula: false, cellHTML: false });
  } catch (e) {
    throw new ErroLeitura(`Não foi possível ler a planilha: ${(e as Error).message}`);
  }
  return wb.SheetNames.map((nome) => {
    const ws = wb.Sheets[nome];
    const linhas = XLSX.utils.sheet_to_json<(string | number | boolean | null)[]>(ws, { header: 1, raw: true, defval: null, blankrows: true });
    const grade: Grade = linhas.map((l) => l.map((c) => (typeof c === "boolean" ? String(c) : typeof c === "string" ? c.trim() || null : c ?? null)));
    return { nome, grade };
  }).filter((a) => a.grade.some((l) => l.some((c) => c !== null)));
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

/** Texto posicionado (coordenadas a partir do topo da página, em pontos). */
export interface TextoPdf {
  texto: string;
  x: number;
  y: number;
  largura: number;
  altura: number;
}

interface Segmento { texto: string; x0: number; x1: number }
interface LinhaPdf { pagina: number; y: number; segmentos: Segmento[] }

/** Agrupa os textos em linhas (mesma altura) e junta os pedaços próximos. */
function linhasDaPagina(itens: TextoPdf[], pagina: number): LinhaPdf[] {
  const ordenados = itens.filter((i) => i.texto.trim()).sort((a, b) => a.y - b.y || a.x - b.x);
  const linhas: { y: number; altura: number; itens: TextoPdf[] }[] = [];
  for (const it of ordenados) {
    const l = linhas[linhas.length - 1];
    if (l && Math.abs(it.y - l.y) <= Math.max(2, Math.min(l.altura, it.altura) * 0.45)) l.itens.push(it);
    else linhas.push({ y: it.y, altura: it.altura || 8, itens: [it] });
  }
  return linhas.map((l) => {
    const xs = l.itens.sort((a, b) => a.x - b.x);
    const segs: Segmento[] = [];
    for (const it of xs) {
      const s = segs[segs.length - 1];
      const folga = s ? it.x - s.x1 : Infinity;
      if (s && folga < Math.max(3, l.altura * 0.6)) {
        s.texto += (folga > l.altura * 0.12 && !s.texto.endsWith(" ") ? " " : "") + it.texto;
        s.x1 = Math.max(s.x1, it.x + it.largura);
      } else segs.push({ texto: it.texto, x0: it.x, x1: it.x + it.largura });
    }
    return { pagina, y: l.y, segmentos: segs.map((s) => ({ ...s, texto: s.texto.replace(/\s+/g, " ").trim() })).filter((s) => s.texto) };
  });
}

function camposDoCabecalho(segs: Segmento[]): number {
  const usados = new Set<Campo>();
  for (const s of segs) {
    const k = campoDoTitulo(s.texto, usados);
    if (k) usados.add(k);
  }
  const essenciais = ["descricao", "quantidade", "codigo", "unidade"].filter((k) => usados.has(k as Campo)).length;
  return essenciais >= 2 ? usados.size : 0;
}

/** Junta duas linhas de título (ex.: "Preço" / "unitário") pelas colunas que se sobrepõem. */
function juntarTitulos(a: Segmento[], b: Segmento[]): Segmento[] {
  const r = a.map((s) => ({ ...s }));
  for (const s of b) {
    const alvo = r.find((x) => s.x0 < x.x1 + 2 && s.x1 > x.x0 - 2);
    if (alvo) { alvo.texto = `${alvo.texto} ${s.texto}`; alvo.x0 = Math.min(alvo.x0, s.x0); alvo.x1 = Math.max(alvo.x1, s.x1); }
    else r.push({ ...s });
  }
  return r.sort((x, y) => x.x0 - y.x0);
}

const RODAPE = /^(p[aá]g(ina)?\.?\s*\d+(\s*(de|\/)\s*\d+)?|\d+\s*(de|\/)\s*\d+)$/i;

/**
 * Monta a grade a partir dos textos de cada página. As colunas vêm da linha
 * de cabeçalho (posição dos títulos); nas páginas seguintes, o que fica acima
 * do cabeçalho repetido (timbre, identificação) é descartado.
 */
export function gradeDoPdf(paginas: TextoPdf[][]): { grade: Grade; texto: string } {
  let todas = paginas.flatMap((p, i) => linhasDaPagina(p, i));
  // linhas que se repetem em várias páginas (timbre, rodapé "Emitido em… Página 2 de 5") saem
  if (paginas.length > 1) {
    const chave = (l: LinhaPdf) => normalizar(l.segmentos.map((s) => s.texto).join(" ")).replace(/\d+/g, "#");
    const paginasDe = new Map<string, Set<number>>();
    for (const l of todas) paginasDe.set(chave(l), (paginasDe.get(chave(l)) ?? new Set()).add(l.pagina));
    const repetidas = (l: LinhaPdf) => (paginasDe.get(chave(l))?.size ?? 0) >= Math.min(3, paginas.length) && camposDoCabecalho(l.segmentos) === 0;
    const primeira = new Set<string>();
    todas = todas.filter((l) => {
      if (!repetidas(l)) return true;
      // mantém a 1ª ocorrência do que fica acima da tabela (identificação), descarta o resto
      const k = chave(l);
      if (l.pagina === 0 && !primeira.has(k) && l.y < 300) { primeira.add(k); return true; }
      return false;
    });
  }
  const texto = todas.map((l) => l.segmentos.map((s) => s.texto).join("  ")).join("\n");
  // cabeçalho: melhor linha (ou par de linhas próximas)
  let melhor: { i: number; fim: number; segs: Segmento[]; pontos: number } | null = null;
  for (let i = 0; i < todas.length; i++) {
    const um = camposDoCabecalho(todas[i].segmentos);
    if (um && (!melhor || um > melhor.pontos)) melhor = { i, fim: i, segs: todas[i].segmentos, pontos: um };
    const prox = todas[i + 1];
    if (prox && prox.pagina === todas[i].pagina && prox.y - todas[i].y < 16) {
      const segs = juntarTitulos(todas[i].segmentos, prox.segmentos);
      const dois = camposDoCabecalho(segs);
      if (dois && (!melhor || dois > melhor.pontos)) melhor = { i, fim: i + 1, segs, pontos: dois };
    }
  }
  if (!melhor) {
    // sem cabeçalho: cada pedaço de texto vira uma célula (o usuário indica as colunas)
    return { grade: todas.filter((l) => !RODAPE.test(l.segmentos.map((s) => s.texto).join(" "))).map((l) => l.segmentos.map((s) => s.texto)), texto };
  }
  const colunas = melhor.segs;
  const limites = colunas.map((c, k) => (k === 0 ? -Infinity : (colunas[k - 1].x1 + c.x0) / 2));
  const colunaDe = (s: Segmento) => {
    const centro = (s.x0 + s.x1) / 2;
    let k = 0;
    while (k + 1 < limites.length && centro >= limites[k + 1]) k++;
    return k;
  };
  const grade: Grade = [];
  const titulosNorm = normalizar(colunas.map((c) => c.texto).join(" "));
  let ignorarAteCabecalho = false;
  let paginaAtual = -1;
  for (let i = 0; i < todas.length; i++) {
    const l = todas[i];
    const textoLinha = l.segmentos.map((s) => s.texto).join(" ");
    if (i < melhor.i) { grade.push(l.segmentos.map((s) => s.texto)); continue; }
    if (i >= melhor.i && i <= melhor.fim) {
      if (i === melhor.fim) grade.push(colunas.map((c) => c.texto));
      continue;
    }
    if (l.pagina !== paginaAtual) {
      paginaAtual = l.pagina;
      // a página tem o cabeçalho repetido? então o que vem antes dele é timbre
      ignorarAteCabecalho = l.pagina > todas[melhor.i].pagina && todas.some((x, j) => j >= i && x.pagina === l.pagina && camposDoCabecalho(x.segmentos) >= Math.max(2, melhor!.pontos - 2));
    }
    if (ignorarAteCabecalho) {
      if (camposDoCabecalho(l.segmentos) >= Math.max(2, melhor.pontos - 2)) ignorarAteCabecalho = false;
      // linha seguinte de título (2ª linha do cabeçalho repetido)
      continue;
    }
    if (RODAPE.test(textoLinha.trim())) continue;
    if (normalizar(textoLinha) === titulosNorm) continue;
    const linha: (string | null)[] = colunas.map(() => null);
    for (const s of l.segmentos) {
      const k = colunaDe(s);
      linha[k] = linha[k] ? `${linha[k]} ${s.texto}` : s.texto;
    }
    grade.push(linha);
  }
  return { grade, texto };
}

/** Carrega o pdf.js (navegador: sem worker separado; o processamento é leve). */
async function carregarPdfjs() {
  const pdfjs = await import("pdfjs-dist");
  if (typeof window !== "undefined" && !(globalThis as { pdfjsWorker?: unknown }).pdfjsWorker) {
    // "worker" no próprio processo: evita servir um arquivo de worker à parte
    (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = await import("pdfjs-dist/build/pdf.worker.min.mjs");
  }
  return pdfjs;
}

type Pdfjs = Pick<typeof import("pdfjs-dist"), "getDocument">;

/** Lê os textos posicionados de todas as páginas. */
export async function textosDoPdf(dados: ArrayBuffer, pdfjs?: Pdfjs): Promise<TextoPdf[][]> {
  const lib = pdfjs ?? (await carregarPdfjs());
  let doc;
  try {
    doc = await lib.getDocument({ data: new Uint8Array(dados), isEvalSupported: false, useSystemFonts: false, disableFontFace: true }).promise;
  } catch (e) {
    throw new ErroLeitura(`Não foi possível abrir o PDF: ${(e as Error).message}`);
  }
  const paginas: TextoPdf[][] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const p = await doc.getPage(n);
    const altura = p.getViewport({ scale: 1 }).height;
    const c = await p.getTextContent();
    paginas.push(c.items.flatMap((it) => {
      if (!("str" in it) || !it.str.trim()) return [];
      const h = Math.abs(it.transform[3]) || it.height || 8;
      return [{ texto: it.str, x: it.transform[4], y: altura - it.transform[5] - h, largura: it.width, altura: h }];
    }));
  }
  await doc.destroy();
  if (!paginas.some((p) => p.length)) throw new ErroLeitura("O PDF não tem texto selecionável (provavelmente é digitalizado). Use a planilha original ou um PDF gerado pelo sistema de orçamento.");
  return paginas;
}

export async function lerPdf(dados: ArrayBuffer, pdfjs?: Pdfjs) {
  return gradeDoPdf(await textosDoPdf(dados, pdfjs));
}
