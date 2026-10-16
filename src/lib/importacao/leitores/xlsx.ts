/**
 * Leitor de XLSX em fluxo, para navegador e servidor.
 *
 * - A planilha (XML) é descompactada e interpretada aos pedaços: as linhas
 *   são entregues uma a uma, sem montar a planilha inteira na memória.
 * - Valores vêm como TEXTO exatamente como gravados no arquivo (sem passar
 *   por float). Números com mais de 15 dígitos significativos (artefato do
 *   Excel, ex.: 1.2789999999999999) são normalizados para a representação
 *   mais curta equivalente — o mesmo valor que o Excel exibe.
 * - Fórmulas são preservadas (o SINAPI guarda códigos dentro de fórmulas).
 */
import { Unzip, UnzipInflate, unzipSync, strFromU8 } from "fflate";
import { SaxesParser } from "saxes";

export class ErroXlsx extends Error {}

export interface Celula {
  valor: string | null;
  formula?: string;
  tipo: string; // n, s, str, inlineStr, b, e
}

export interface LinhaXlsx {
  numero: number; // 1 = primeira linha
  celulas: Map<number, Celula>; // índice de coluna (0 = A)
}

export function colunaParaIndice(ref: string): number {
  let n = 0;
  for (const ch of ref) {
    const c = ch.charCodeAt(0);
    if (c < 65 || c > 90) break;
    n = n * 26 + (c - 64);
  }
  return n - 1;
}

function normalizarNumero(v: string): string {
  const digitos = v.replace(/^[-+]/, "").replace(/[eE].*$/, "").replace(".", "").replace(/^0+/, "");
  return digitos.length > 15 ? String(Number(v)) : v;
}

export class PastaXlsx {
  private constructor(
    private readonly dados: Uint8Array,
    readonly abas: { nome: string; caminho: string }[],
    private readonly textos: string[],
  ) {}

  static async abrir(dados: Uint8Array): Promise<PastaXlsx> {
    let partes: Record<string, Uint8Array>;
    try {
      partes = unzipSync(dados, {
        filter: (f) => ["xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/sharedStrings.xml"].includes(f.name),
      });
    } catch (e) {
      throw new ErroXlsx(`Arquivo XLSX inválido: ${(e as Error).message}`);
    }
    if (!partes["xl/workbook.xml"]) throw new ErroXlsx("Arquivo não é uma pasta de trabalho XLSX.");
    const rels = new Map<string, string>();
    parse(strFromU8(partes["xl/_rels/workbook.xml.rels"] ?? new Uint8Array()), (p) => {
      p.on("opentag", (t) => {
        if (t.name === "Relationship") {
          const alvo = String(t.attributes.Target);
          rels.set(String(t.attributes.Id), alvo.startsWith("/") ? alvo.slice(1) : `xl/${alvo}`);
        }
      });
    });
    const abas: { nome: string; caminho: string }[] = [];
    parse(strFromU8(partes["xl/workbook.xml"]), (p) => {
      p.on("opentag", (t) => {
        if (t.name === "sheet") {
          const caminho = rels.get(String(t.attributes["r:id"]));
          if (caminho) abas.push({ nome: String(t.attributes.name), caminho });
        }
      });
    });
    const textos: string[] = [];
    if (partes["xl/sharedStrings.xml"]) {
      let atual = "";
      let emT = false;
      let emFonetica = 0;
      parse(strFromU8(partes["xl/sharedStrings.xml"]), (p) => {
        p.on("opentag", (t) => {
          if (t.name === "si") atual = "";
          else if (t.name === "rPh") emFonetica++;
          else if (t.name === "t" && !emFonetica) emT = true;
        });
        p.on("text", (x) => { if (emT) atual += x; });
        p.on("closetag", (t) => {
          if (t.name === "t") emT = false;
          else if (t.name === "rPh") emFonetica--;
          else if (t.name === "si") textos.push(atual);
        });
      });
    }
    return new PastaXlsx(dados, abas, textos);
  }

  /** Lê as linhas de uma aba, em fluxo. */
  async *linhas(nomeAba: string): AsyncGenerator<LinhaXlsx> {
    const aba = this.abas.find((a) => a.nome === nomeAba);
    if (!aba) throw new ErroXlsx(`Aba "${nomeAba}" não encontrada.`);

    const fila: LinhaXlsx[] = [];
    let erro: Error | null = null;
    const textos = this.textos;
    const p = new SaxesParser();
    let linha: LinhaXlsx | null = null;
    let cel: { col: number; tipo: string; valor: string; formula: string; temValor: boolean } | null = null;
    let campo: "v" | "f" | "t" | null = null;
    let proximaLinha = 1;
    p.on("opentag", (t) => {
      switch (t.name) {
        case "row": {
          const r = t.attributes.r ? Number(t.attributes.r) : proximaLinha;
          linha = { numero: r, celulas: new Map() };
          proximaLinha = r + 1;
          break;
        }
        case "c": {
          const ref = String(t.attributes.r ?? "");
          const col = ref ? colunaParaIndice(ref) : linha ? linha.celulas.size : 0;
          cel = { col, tipo: String(t.attributes.t ?? "n"), valor: "", formula: "", temValor: false };
          break;
        }
        case "v": campo = "v"; break;
        case "f": campo = "f"; break;
        case "t": if (cel) campo = "t"; break;
      }
    });
    p.on("text", (x) => {
      if (!cel || !campo) return;
      if (campo === "f") cel.formula += x;
      else { cel.valor += x; cel.temValor = true; }
    });
    p.on("closetag", (t) => {
      if (t.name === "v" || t.name === "f" || t.name === "t") campo = null;
      else if (t.name === "c" && cel && linha) {
        let valor: string | null = cel.temValor ? cel.valor : null;
        if (valor !== null) {
          if (cel.tipo === "s") valor = textos[Number(valor)] ?? null;
          else if (cel.tipo === "n") valor = normalizarNumero(valor.trim());
        }
        linha.celulas.set(cel.col, { valor, formula: cel.formula || undefined, tipo: cel.tipo });
        cel = null;
      } else if (t.name === "row" && linha) {
        fila.push(linha);
        linha = null;
      }
    });
    p.on("error", (e) => { erro = new ErroXlsx(`XML inválido na aba "${nomeAba}": ${e.message}`); });

    const decod = new TextDecoder("utf-8");
    let encontrado = false;
    const uz = new Unzip((f) => {
      if (f.name !== aba.caminho) return;
      encontrado = true;
      f.ondata = (e, dados, fim) => {
        if (e) { erro = new ErroXlsx(e.message); return; }
        try {
          p.write(decod.decode(dados, { stream: !fim }));
          if (fim) p.close();
        } catch (x) {
          erro ??= x as Error;
        }
      };
      f.start();
    });
    uz.register(UnzipInflate);

    const PEDACO = 1 << 16;
    for (let pos = 0; pos < this.dados.length; pos += PEDACO) {
      const fim = pos + PEDACO >= this.dados.length;
      uz.push(this.dados.subarray(pos, pos + PEDACO), fim);
      if (erro) throw erro;
      while (fila.length) yield fila.shift()!;
    }
    if (erro) throw erro;
    if (!encontrado) throw new ErroXlsx(`Conteúdo da aba "${nomeAba}" ausente no arquivo.`);
    while (fila.length) yield fila.shift()!;
  }
}

function parse(xml: string, configurar: (p: SaxesParser) => void) {
  const p = new SaxesParser();
  configurar(p);
  p.write(xml).close();
}

/** Atalho: texto de uma célula (null se vazia). */
export function texto(l: LinhaXlsx, col: number): string | null {
  const v = l.celulas.get(col)?.valor;
  if (v === undefined || v === null) return null;
  const t = v.trim();
  return t === "" ? null : t;
}
