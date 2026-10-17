import type { ArquivoEntrada } from "./leitores/arquivo";

export type TipoItemImp = "INSUMO" | "COMPOSICAO";
export type FonteOficial = "SINAPI" | "EMOP" | "SICRO";
export type SeveridadeImp = "ERRO" | "AVISO" | "INFO";

interface Origem {
  arquivo: string;
  planilha?: string | null;
  linha?: number | null;
}

export interface RegItem extends Origem {
  tipo: TipoItemImp;
  codigo: string;
  descricao: string | null;
  unidade: string | null;
  grupo?: string | null;
  atributos?: Record<string, unknown> | null;
  /** Menor = fonte preferida quando o mesmo item aparece em vários lugares. */
  prioridade: number;
}

export interface RegPreco extends Origem {
  tipo: TipoItemImp;
  codigo: string;
  /** Código do regime declarado em Identificacao.regimes; null = preço único. */
  regime: string | null;
  valorTexto: string | null;
  /** Decimal em texto ("123.45"); null = preço ausente/não publicado. */
  valor: string | null;
  origemPreco?: string | null;
  atributos?: Record<string, unknown> | null;
}

export interface RegComponente extends Origem {
  composicao: string;
  regime: string | null;
  ordem: number;
  componenteTipo: TipoItemImp;
  componenteCodigo: string;
  coeficienteTexto: string | null;
  coeficiente: string | null;
  percentualTexto?: string | null;
  percentual?: string | null;
  situacao?: string | null;
}

export interface Ocorrencia extends Partial<Origem> {
  regra: string;
  severidade: SeveridadeImp;
  mensagem: string;
  campo?: string | null;
  valor?: string | null;
}

export interface RegimeDeclarado {
  codigo: string;
  nome: string;
  descricao?: string;
}

export interface Identificacao {
  adaptador: string;
  versao: string;
  fonte: FonteOficial;
  uf: string;
  /** "AAAA-MM" */
  competencia: string;
  layout: string;
  regimes: RegimeDeclarado[];
  /** Arquivos efetivamente usados e o papel de cada um. */
  arquivos: { nome: string; papel: string }[];
  dataEmissao?: string | null;
  observacoes: string[];
}

export type ResultadoIdentificacao =
  | { ok: true; identificacao: Identificacao }
  | { ok: false; motivo: string }
  | null; // arquivo não pertence a este adaptador

export interface Emissor {
  item(r: RegItem): void | Promise<void>;
  preco(r: RegPreco): void | Promise<void>;
  componente(r: RegComponente): void | Promise<void>;
  ocorrencia(o: Ocorrencia): void | Promise<void>;
}

export interface Adaptador {
  id: string;
  versao: string;
  fonte: FonteOficial;
  descricao: string;
  identificar(arquivos: ArquivoEntrada[], opcoes: { uf: string }): Promise<ResultadoIdentificacao>;
  ler(arquivos: ArquivoEntrada[], ident: Identificacao, emitir: Emissor): Promise<void>;
  /**
   * Quando o regime está embutido no código do item (EMOP), informa-o para
   * permitir importar só os regimes escolhidos. null = item sem regime.
   */
  regimeDoCodigo?(tipo: TipoItemImp, codigo: string): string | null;
}

/** Converte "MM/AAAA" → "AAAA-MM". */
export function competenciaDeMesAno(s: string | null | undefined): string | null {
  const m = /^\s*(\d{2})\/(\d{4})\s*$/.exec(s ?? "");
  if (!m || Number(m[1]) < 1 || Number(m[1]) > 12) return null;
  return `${m[2]}-${m[1]}`;
}
