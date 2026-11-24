/// <reference lib="webworker" />
/**
 * Web Worker do assistente de importação: abre ZIP/RAR, identifica o layout,
 * calcula SHA-256 e lê os registros SEM travar a tela. Os lotes são enviados
 * à página um a um (a página só pede o próximo depois que o servidor gravou).
 */
import { configurarWasmRar } from "@/lib/importacao/leitores/pacote";
import { identificar, lerEmLotes, type Identificado } from "@/lib/importacao/processar";
import type { ArquivoEntrada } from "@/lib/importacao/leitores/arquivo";

declare const self: DedicatedWorkerGlobalScope;

configurarWasmRar(async () => (await fetch("/unrar.wasm")).arrayBuffer());

/**
 * Registros por envio. Pequeno de propósito: no plano gratuito da Cloudflare
 * cada requisição tem poucos milissegundos de processamento, e lotes de 2.000
 * estouravam o limite (o servidor descartava o envio).
 */
const TAMANHO_LOTE = 300;

let atual: Identificado | null = null;
const esperas = new Map<number, (ok: boolean) => void>();
let seq = 0;

function deArquivo(f: File): ArquivoEntrada {
  let cache: Uint8Array | null = null;
  const bytes = async () => (cache ??= new Uint8Array(await f.arrayBuffer()));
  return { nome: f.name.normalize("NFC"), caminho: f.name, tamanho: f.size, abrir: () => f.stream() as ReadableStream<Uint8Array>, bytes };
}

self.onmessage = async (ev: MessageEvent) => {
  const m = ev.data;
  try {
    if (m.tipo === "identificar") {
      atual = await identificar((m.arquivos as File[]).map(deArquivo), { uf: m.uf, fonte: m.fonte });
      self.postMessage({ tipo: "identificado", identificacao: atual.identificacao, originais: atual.originais });
    } else if (m.tipo === "ler") {
      if (!atual) throw new Error("Nenhum arquivo identificado.");
      const total = await lerEmLotes(
        atual,
        (lote) => new Promise<void>((ok, falha) => {
          const id = ++seq;
          esperas.set(id, (sucesso) => (sucesso ? ok() : falha(new Error("Envio interrompido."))));
          self.postMessage({ tipo: "lote", id, lote });
        }),
        { tamanhoLote: TAMANHO_LOTE, regimes: m.regimes, aoProgresso: (p) => self.postMessage({ tipo: "progresso", progresso: p }) },
      );
      self.postMessage({ tipo: "fim", total });
    } else if (m.tipo === "ack") {
      esperas.get(m.id)?.(m.ok);
      esperas.delete(m.id);
    }
  } catch (e) {
    self.postMessage({ tipo: "erro", mensagem: (e as Error).message });
  }
};
