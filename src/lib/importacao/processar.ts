/**
 * Orquestra identificação do layout e leitura em lotes. Roda no navegador
 * (assistente web, enviando lotes ao servidor) ou no Node (linha de comando).
 */
import { ADAPTADORES } from "./adaptadores";
import { sha256Hex, type ArquivoEntrada } from "./leitores/arquivo";
import { expandirPacotes } from "./leitores/pacote";
import type { Lote } from "./servico";
import type { Adaptador, Emissor, FonteOficial, Identificacao } from "./tipos";

/** Só estes arquivos de dentro dos pacotes interessam aos adaptadores. */
const RELEVANTE = /\.(dbf|xlsx)$/i;

export interface Identificado {
  adaptador: Adaptador;
  identificacao: Identificacao;
  entradas: ArquivoEntrada[];
  originais: { nome: string; tamanho: number; sha256: string }[];
}

export async function identificar(originais: ArquivoEntrada[], opcoes: { uf: string; fonte?: FonteOficial }): Promise<Identificado> {
  if (originais.length === 0) throw new Error("Nenhum arquivo enviado.");
  const hashes = [];
  for (const o of originais) hashes.push({ nome: o.nome, tamanho: o.tamanho, sha256: await sha256Hex(await o.bytes()) });
  const entradas = await expandirPacotes(originais, (n) => RELEVANTE.test(n));
  const recusas: string[] = [];
  for (const ad of ADAPTADORES) {
    if (opcoes.fonte && ad.fonte !== opcoes.fonte) continue;
    const r = await ad.identificar(entradas, { uf: opcoes.uf });
    if (r === null) continue;
    if (!r.ok) { recusas.push(`${ad.descricao}: ${r.motivo}`); continue; }
    return { adaptador: ad, identificacao: r.identificacao, entradas, originais: hashes };
  }
  throw new Error(
    recusas.length
      ? `Arquivos reconhecidos, mas com problema de layout:\n${recusas.join("\n")}`
      : `Layout não reconhecido. Arquivos encontrados: ${entradas.map((e) => e.nome).join(", ") || "nenhum"}. ` +
        "Envie o ZIP oficial do SINAPI (formato XLSX), o RAR/DBFs oficiais da EMOP ou os relatórios XLSX do SICRO. Se o layout oficial mudou, é necessário um novo adaptador.",
  );
}

export interface Progresso { itens: number; precos: number; componentes: number; ocorrencias: number }

/** Lê com o adaptador e entrega lotes de até `tamanhoLote` registros. */
export async function lerEmLotes(
  id: Identificado,
  destino: (lote: Lote) => Promise<void>,
  opcoes: { tamanhoLote?: number; aoProgresso?: (p: Progresso) => void; regimes?: string[] } = {},
): Promise<Progresso> {
  // filtro de regimes escolhidos pelo usuário (padrão: todos os publicados)
  const escolhidos = opcoes.regimes ? new Set(opcoes.regimes) : null;
  const regimeDoCodigo = id.adaptador.regimeDoCodigo?.bind(id.adaptador);
  const aceita = (regime: string | null | undefined) => !escolhidos || regime == null || escolhidos.has(regime);
  const aceitaCodigo = (tipo: "INSUMO" | "COMPOSICAO", codigo: string) => aceita(regimeDoCodigo?.(tipo, codigo));
  const limite = opcoes.tamanhoLote ?? 2000;
  let lote: Required<Lote> = { itens: [], precos: [], componentes: [], ocorrencias: [] };
  const total: Progresso = { itens: 0, precos: 0, componentes: 0, ocorrencias: 0 };
  // registros com atributos grandes (ex.: composição analítica do SICRO) contam pelo tamanho:
  // cada lote deve caber no limite de envio ao servidor
  let bytes = 0;
  const LIMITE_BYTES = 1_500_000;
  const pesar = (a: unknown) => { if (a) bytes += JSON.stringify(a).length; };
  const tamanho = () => lote.itens.length + lote.precos.length + lote.componentes.length + lote.ocorrencias.length + Math.floor((bytes / LIMITE_BYTES) * limite);
  const descarregar = async () => {
    if (tamanho() === 0) return;
    const enviar = lote;
    lote = { itens: [], precos: [], componentes: [], ocorrencias: [] };
    bytes = 0;
    await destino(enviar);
    opcoes.aoProgresso?.({ ...total });
  };
  const emissor: Emissor = {
    async item(r) { if (!aceitaCodigo(r.tipo, r.codigo)) return; lote.itens.push(r); pesar(r.atributos); total.itens++; if (tamanho() >= limite) await descarregar(); },
    async preco(r) { if (!aceita(r.regime) || !aceitaCodigo(r.tipo, r.codigo)) return; lote.precos.push(r); pesar(r.atributos); total.precos++; if (tamanho() >= limite) await descarregar(); },
    async componente(r) { if (!aceita(r.regime) || !aceitaCodigo("COMPOSICAO", r.composicao)) return; lote.componentes.push(r); total.componentes++; if (tamanho() >= limite) await descarregar(); },
    async ocorrencia(o) { lote.ocorrencias.push(o); total.ocorrencias++; if (tamanho() >= limite) await descarregar(); },
  };
  await id.adaptador.ler(id.entradas, id.identificacao, emissor);
  await descarregar();
  return total;
}
