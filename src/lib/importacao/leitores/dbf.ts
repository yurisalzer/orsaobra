/**
 * Leitor de arquivos DBF (dBase III/IV/FoxPro) em fluxo contínuo.
 *
 * - Lê de um ReadableStream (funciona no navegador e no Node) sem carregar o
 *   arquivo inteiro na memória.
 * - Campos numéricos são devolvidos como TEXTO exato, para conversão posterior
 *   em Decimal — nunca passam por ponto flutuante.
 * - Registros marcados como excluídos ("*") são ignorados e contados.
 */

export interface CampoDbf {
  nome: string;
  tipo: string; // C, N, F, D, L, M...
  tamanho: number;
  decimais: number;
}

export interface CabecalhoDbf {
  versao: number;
  ultimaAtualizacao: string | null; // AAAA-MM-DD conforme gravado no arquivo
  totalRegistros: number;
  tamanhoCabecalho: number;
  tamanhoRegistro: number;
  campos: CampoDbf[];
}

export type RegistroDbf = Record<string, string | null>;

export type Decodificador = (bytes: Uint8Array) => string;

/** Codificações comuns em DBF brasileiros. */
export const decodificadores: Record<string, Decodificador> = {
  latin1: (b) => new TextDecoder("latin1").decode(b),
  cp1252: (b) => new TextDecoder("windows-1252").decode(b),
  cp850: decodificarCp850,
};

class LeitorBytes {
  private buffer = new Uint8Array(0);
  private fim = false;
  constructor(private readonly reader: ReadableStreamDefaultReader<Uint8Array>) {}

  /** Lê exatamente n bytes (ou menos, se o arquivo terminar). */
  async ler(n: number): Promise<Uint8Array> {
    while (this.buffer.length < n && !this.fim) {
      const { value, done } = await this.reader.read();
      if (done) {
        this.fim = true;
        break;
      }
      const novo = new Uint8Array(this.buffer.length + value.length);
      novo.set(this.buffer);
      novo.set(value, this.buffer.length);
      this.buffer = novo;
    }
    const saida = this.buffer.subarray(0, Math.min(n, this.buffer.length));
    this.buffer = this.buffer.subarray(saida.length);
    return saida.slice();
  }
}

export class ErroDbf extends Error {}

export async function* lerDbf(
  fluxo: ReadableStream<Uint8Array>,
  opcoes: {
    decodificar?: Decodificador;
    aoLerCabecalho?: (c: CabecalhoDbf) => void;
    /** false = preserva espaços dos campos texto (necessário para juntar descrições quebradas em vários campos). */
    aparar?: boolean;
  } = {},
): AsyncGenerator<{ linha: number; registro: RegistroDbf }, { excluidos: number; lidos: number }> {
  const decodificar = opcoes.decodificar ?? decodificadores.latin1;
  const aparar = opcoes.aparar ?? true;
  const leitor = new LeitorBytes(fluxo.getReader());

  const h = await leitor.ler(32);
  if (h.length < 32) throw new ErroDbf("Arquivo DBF truncado (cabeçalho incompleto).");
  const dv = new DataView(h.buffer, h.byteOffset, h.byteLength);
  const versao = h[0];
  const ano = h[1], mes = h[2], dia = h[3];
  const totalRegistros = dv.getUint32(4, true);
  const tamanhoCabecalho = dv.getUint16(8, true);
  const tamanhoRegistro = dv.getUint16(10, true);
  if (tamanhoCabecalho < 33 || tamanhoRegistro < 1) throw new ErroDbf("Cabeçalho DBF inválido.");

  const resto = await leitor.ler(tamanhoCabecalho - 32);
  if (resto.length < tamanhoCabecalho - 32) throw new ErroDbf("Arquivo DBF truncado (descritores de campos).");
  const campos: CampoDbf[] = [];
  for (let o = 0; o + 32 <= resto.length && resto[o] !== 0x0d; o += 32) {
    const bytesNome = resto.subarray(o, o + 11);
    const zero = bytesNome.indexOf(0);
    const nome = new TextDecoder("latin1").decode(zero >= 0 ? bytesNome.subarray(0, zero) : bytesNome).trim();
    campos.push({ nome, tipo: String.fromCharCode(resto[o + 11]), tamanho: resto[o + 16], decimais: resto[o + 17] });
  }
  if (campos.length === 0) throw new ErroDbf("DBF sem campos.");
  const somaCampos = campos.reduce((a, c) => a + c.tamanho, 1);
  if (somaCampos !== tamanhoRegistro) {
    throw new ErroDbf(`Tamanho de registro inconsistente: campos somam ${somaCampos}, cabeçalho indica ${tamanhoRegistro}.`);
  }
  const cab: CabecalhoDbf = {
    versao,
    ultimaAtualizacao: mes >= 1 && mes <= 12 && dia >= 1 && dia <= 31
      ? `${ano < 80 ? 2000 + ano : 1900 + ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`
      : null,
    totalRegistros,
    tamanhoCabecalho,
    tamanhoRegistro,
    campos,
  };
  opcoes.aoLerCabecalho?.(cab);

  let excluidos = 0;
  let lidos = 0;
  for (let i = 0; i < totalRegistros; i++) {
    const r = await leitor.ler(tamanhoRegistro);
    if (r.length === 0 || (r.length === 1 && r[0] === 0x1a)) {
      throw new ErroDbf(`Arquivo DBF truncado: esperados ${totalRegistros} registros, encontrados ${i}.`);
    }
    if (r.length < tamanhoRegistro) throw new ErroDbf(`Registro ${i + 1} incompleto.`);
    if (r[0] === 0x2a) {
      excluidos++;
      continue;
    }
    const registro: RegistroDbf = {};
    let o = 1;
    for (const c of campos) {
      const bruto = r.subarray(o, o + c.tamanho);
      o += c.tamanho;
      const ehTexto = c.tipo === "C" || c.tipo === "M";
      const lido = (ehTexto ? decodificar(bruto) : new TextDecoder("latin1").decode(bruto)).replace(/\u0000/g, "");
      const texto = ehTexto && !aparar ? lido : lido.trim();
      registro[c.nome] = texto.trim() === "" ? null : texto;
    }
    lidos++;
    yield { linha: i + 1, registro };
  }
  return { excluidos, lidos };
}

/** Cabeçalho apenas (para identificação de layout). */
export async function lerCabecalhoDbf(fluxo: ReadableStream<Uint8Array>): Promise<CabecalhoDbf> {
  let cab: CabecalhoDbf | undefined;
  const it = lerDbf(fluxo, { aoLerCabecalho: (c) => (cab = c) });
  try {
    await it.next();
  } finally {
    await it.return?.({ excluidos: 0, lidos: 0 });
  }
  if (!cab) throw new ErroDbf("Não foi possível ler o cabeçalho.");
  return cab;
}

// Tabela CP850 (bytes 0x80–0xFF), usada por DBFs gerados em sistemas DOS.
const CP850 =
  "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜø£Ø×ƒáíóúñÑªº¿®¬½¼¡«»░▒▓│┤ÁÂÀ©╣║╗╝¢¥┐└┴┬├─┼ãÃ╚╔╩╦╠═╬¤ðÐÊËÈıÍÎÏ┘┌█▄¦Ì▀ÓßÔÒõÕµþÞÚÛÙýÝ¯´­±‗¾¶§÷¸°¨·¹³²■ ";
function decodificarCp850(b: Uint8Array): string {
  let s = "";
  for (const x of b) s += x < 0x80 ? String.fromCharCode(x) : CP850[x - 0x80];
  return s;
}
