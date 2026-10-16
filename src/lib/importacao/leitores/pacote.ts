import { unzipSync, type Unzipped } from "fflate";
import { arquivoDeBytes, nomeBase, tipoPorAssinatura, type ArquivoEntrada } from "./arquivo";

export class ErroPacote extends Error {}

/** Limites contra arquivos maliciosos (ex.: "zip bomb"). */
const LIMITE_DESCOMPACTADO = 400 * 1024 * 1024;
const LIMITE_ENTRADAS = 500;

function seguro(caminho: string) {
  if (caminho.includes("..") || caminho.startsWith("/") || /^[A-Za-z]:/.test(caminho)) {
    throw new ErroPacote(`Caminho inválido dentro do pacote: ${caminho}`);
  }
}

export async function expandirZip(dados: Uint8Array, filtro: (nome: string) => boolean = () => true): Promise<ArquivoEntrada[]> {
  let total = 0;
  let entradas = 0;
  let conteudo: Unzipped;
  try {
    conteudo = unzipSync(dados, {
      filter: (f) => {
        if (++entradas > LIMITE_ENTRADAS) throw new ErroPacote("ZIP com entradas demais.");
        seguro(f.name);
        if (f.name.endsWith("/")) return false;
        const usar = filtro(nomeBase(f.name));
        if (usar) {
          total += f.originalSize;
          if (total > LIMITE_DESCOMPACTADO) throw new ErroPacote("Conteúdo descompactado excede o limite.");
        }
        return usar;
      },
    });
  } catch (e) {
    if (e instanceof ErroPacote) throw e;
    throw new ErroPacote(`ZIP inválido: ${(e as Error).message}`);
  }
  return Object.entries(conteudo).map(([caminho, bytes]) => arquivoDeBytes(caminho, bytes));
}

export async function expandirRar(dados: Uint8Array, filtro: (nome: string) => boolean = () => true): Promise<ArquivoEntrada[]> {
  const { createExtractorFromData } = await import("node-unrar-js");
  let extrator;
  try {
    extrator = await createExtractorFromData({ data: dados.buffer.slice(dados.byteOffset, dados.byteOffset + dados.byteLength) as ArrayBuffer });
  } catch (e) {
    throw new ErroPacote(`RAR inválido: ${(e as Error).message}`);
  }
  const lista = [...extrator.getFileList().fileHeaders];
  if (lista.length > LIMITE_ENTRADAS) throw new ErroPacote("RAR com entradas demais.");
  let total = 0;
  for (const h of lista) {
    seguro(h.name);
    if (!h.flags.directory && filtro(nomeBase(h.name))) total += h.unpSize;
  }
  if (total > LIMITE_DESCOMPACTADO) throw new ErroPacote("Conteúdo descompactado excede o limite.");
  const { files } = extrator.extract({ files: (h) => !h.flags.directory && filtro(nomeBase(h.name)) });
  const out: ArquivoEntrada[] = [];
  for (const f of files) {
    if (!f.extraction) continue;
    out.push(arquivoDeBytes(f.fileHeader.name, f.extraction));
  }
  return out;
}

/**
 * Recebe os arquivos enviados e devolve a lista "achatada": ZIP e RAR são
 * abertos (um nível); demais arquivos passam como estão. O tipo é decidido
 * pela assinatura do conteúdo, não pela extensão.
 */
export async function expandirPacotes(arquivos: ArquivoEntrada[], filtro?: (nome: string) => boolean): Promise<ArquivoEntrada[]> {
  const out: ArquivoEntrada[] = [];
  for (const a of arquivos) {
    const bytes = await a.bytes();
    const tipo = tipoPorAssinatura(bytes.subarray(0, 8));
    const ehXlsx = /\.xlsx$/i.test(a.nome);
    if (tipo === "zip" && !ehXlsx) out.push(...(await expandirZip(bytes, filtro)));
    else if (tipo === "rar") out.push(...(await expandirRar(bytes, filtro)));
    else out.push(a);
  }
  return out;
}
