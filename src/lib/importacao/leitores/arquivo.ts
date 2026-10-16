/** Arquivo (ou entrada de um ZIP/RAR) que pode ser lido em fluxo. */
export interface ArquivoEntrada {
  /** Nome sem diretórios, normalizado (NFC). */
  nome: string;
  /** Caminho original dentro do pacote, quando houver. */
  caminho: string;
  tamanho: number;
  abrir(): ReadableStream<Uint8Array>;
  bytes(): Promise<Uint8Array>;
}

export function nomeBase(caminho: string): string {
  return caminho.split(/[\\/]/).pop()!.normalize("NFC");
}

export function arquivoDeBytes(caminho: string, dados: Uint8Array): ArquivoEntrada {
  return {
    nome: nomeBase(caminho),
    caminho,
    tamanho: dados.length,
    abrir: () => fluxoDeBytes(dados),
    bytes: async () => dados,
  };
}

export function fluxoDeBytes(dados: Uint8Array, pedaco = 1 << 16): ReadableStream<Uint8Array> {
  let pos = 0;
  return new ReadableStream({
    pull(ctrl) {
      if (pos >= dados.length) return ctrl.close();
      ctrl.enqueue(dados.subarray(pos, pos + pedaco));
      pos += pedaco;
    },
  });
}

export async function lerTudo(fluxo: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const partes: Uint8Array[] = [];
  let total = 0;
  const r = fluxo.getReader();
  for (;;) {
    const { value, done } = await r.read();
    if (done) break;
    partes.push(value);
    total += value.length;
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of partes) { out.set(p, o); o += p.length; }
  return out;
}

/** SHA-256 em hexadecimal (Web Crypto: navegador e Node). */
export async function sha256Hex(dados: Uint8Array): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", dados as unknown as ArrayBuffer);
  return Array.from(new Uint8Array(h), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Identifica o tipo pelo conteúdo (assinatura), não pela extensão. */
export function tipoPorAssinatura(inicio: Uint8Array): "zip" | "rar" | "dbf" | "desconhecido" {
  if (inicio[0] === 0x50 && inicio[1] === 0x4b && inicio[2] === 0x03 && inicio[3] === 0x04) return "zip";
  if (inicio[0] === 0x52 && inicio[1] === 0x61 && inicio[2] === 0x72 && inicio[3] === 0x21) return "rar";
  // dBase III/IV/FoxPro: 1º byte de versão conhecido e data plausível
  if ([0x03, 0x04, 0x05, 0x30, 0x31, 0x83, 0x8b, 0xf5].includes(inicio[0]) && inicio[2] >= 1 && inicio[2] <= 12 && inicio[3] >= 1 && inicio[3] <= 31) return "dbf";
  return "desconhecido";
}
