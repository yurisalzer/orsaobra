/**
 * Modelo único dos relatórios. O servidor monta um `Documento` (só dados, com
 * números como texto decimal exato); o navegador o transforma em PDF, XLSX ou
 * na visualização em tela. Assim os três formatos mostram exatamente os mesmos
 * valores.
 */
import { dec, formatarNumero } from "../calculo/decimal";

export type TipoRelatorio =
  | "sintetico" | "analitico" | "cpu" | "abc-servicos" | "abc-insumos"
  | "bdi" | "cronograma" | "comparativo" | "historico" | "memoria";

export const RELATORIOS: { tipo: TipoRelatorio; nome: string; descricao: string }[] = [
  { tipo: "sintetico", nome: "Orçamento sintético", descricao: "Etapas e itens com quantidades, custos, BDI e preços." },
  { tipo: "analitico", nome: "Orçamento analítico", descricao: "Cada serviço com os componentes da sua composição." },
  { tipo: "cpu", nome: "Composições de preço unitário (CPU)", descricao: "Uma composição por serviço: coeficientes, preços e custo." },
  { tipo: "abc-servicos", nome: "Curva ABC de serviços", descricao: "Serviços ordenados pelo valor, com classes A, B e C." },
  { tipo: "abc-insumos", nome: "Curva ABC de insumos", descricao: "Insumos de todas as composições, somados e ordenados pelo custo." },
  { tipo: "bdi", nome: "Demonstrativo de BDI", descricao: "Parcelas, fórmula e percentual de cada perfil de BDI usado." },
  { tipo: "cronograma", nome: "Cronograma físico-financeiro", descricao: "Percentual e valor de cada etapa por mês, com acumulado." },
  { tipo: "comparativo", nome: "Comparativo entre revisões", descricao: "Itens incluídos, excluídos e alterados entre duas revisões." },
  { tipo: "historico", nome: "Histórico de preços", descricao: "Preço de referência de cada item nas competências publicadas." },
  { tipo: "memoria", nome: "Memória de cálculo", descricao: "Memória do quantitativo e cálculo do preço de cada item." },
];

/** moeda = 2 casas; preco = preço de referência como publicado (2 a 4 casas, ex.: insumos EMOP) */
export type TipoColuna = "texto" | "codigo" | "moeda" | "preco" | "quantidade" | "coeficiente" | "percentual" | "inteiro";

export interface Coluna {
  titulo: string;
  tipo: TipoColuna;
  /** peso relativo da largura */
  largura: number;
}

/** Valor da célula: texto, número decimal (como texto) ou célula com tipo próprio. */
export type Celula = string | null | { valor: string | null; tipo?: TipoColuna; span?: number };

export type EstiloLinha = "normal" | "grupo1" | "grupo2" | "grupo3" | "detalhe" | "subtotal" | "total" | "destaque";

export interface Linha {
  celulas: Celula[];
  estilo?: EstiloLinha;
}

export interface Tabela {
  colunas: Coluna[];
  linhas: Linha[];
}

export interface Secao {
  titulo?: string;
  /** pares rótulo/valor (ex.: cabeçalho de uma CPU) */
  campos?: { rotulo: string; valor: string }[];
  paragrafos?: string[];
  tabela?: Tabela;
  /** começa em nova página no PDF */
  novaPagina?: boolean;
}

export interface Documento {
  tipo: TipoRelatorio;
  /** timbre: logo (data URL PNG/JPEG) e linhas de texto (ex.: órgão, secretaria) */
  cabecalho: { linhas: string[]; logo: string | null } | null;
  titulo: string;
  orientacao: "retrato" | "paisagem";
  /** identificação: obra, orçamento, revisão, bases, datas */
  identificacao: { rotulo: string; valor: string }[];
  avisos: string[];
  secoes: Secao[];
  /** ex.: "Emitido em 17/10/2026 14:32 por Fulano · Orçamento de Obras 0.1.0" */
  rodape: string;
  nomeArquivo: string;
}

export const celula = (c: Celula): { valor: string | null; tipo?: TipoColuna; span: number } =>
  c !== null && typeof c === "object" ? { valor: c.valor, tipo: c.tipo, span: c.span ?? 1 } : { valor: c, span: 1 };

export const ehNumerica = (t: TipoColuna) => t !== "texto" && t !== "codigo";

/** Casas decimais de exibição de cada tipo numérico (mínimo; quantidades e coeficientes mostram as casas informadas). */
export function casasDoValor(tipo: TipoColuna, valor: string): number {
  const d = dec(valor);
  switch (tipo) {
    case "moeda": return 2;
    case "percentual": return 2;
    case "inteiro": return 0;
    case "quantidade": case "preco": return Math.min(Math.max(d.decimalPlaces(), 2), 4);
    case "coeficiente": return Math.min(Math.max(d.decimalPlaces(), 4), 10);
    default: return 2;
  }
}

/** Texto exibido no PDF e na tela (pt-BR). */
export function formatarCelula(valor: string | null, tipo: TipoColuna): string {
  if (valor === null || valor === "") return "";
  if (!ehNumerica(tipo)) return valor;
  if (!/^-?\d+(\.\d+)?$/.test(valor)) return valor; // ex.: "—", "vários"
  const t = formatarNumero(valor, casasDoValor(tipo, valor));
  return tipo === "percentual" ? `${t}%` : t;
}
