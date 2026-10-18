/**
 * Importação de orçamento: análise da tabela lida do arquivo (planilha ou PDF).
 *
 * Tudo aqui é puro (sem banco e sem navegador): recebe a grade de células,
 * encontra a linha de cabeçalho, sugere a coluna de cada campo do orçamento,
 * classifica as linhas (etapa, item ou ignorada) e procura os dados de
 * cadastro (obra, processo, BDI, data-base…) acima da tabela.
 *
 * Nada é inventado: o que não for identificado fica em branco para o usuário
 * informar. Os preços do arquivo servem só para conferência — no orçamento,
 * o preço de cada item vem da base de referência escolhida.
 */

/** Célula: texto, ou número quando a planilha guarda o valor como número. */
export type Valor = string | number | null;
export type Grade = Valor[][];

export const CAMPOS = [
  { campo: "item", nome: "Item (numeração)", obrigatorio: false },
  { campo: "codigo", nome: "Código", obrigatorio: true },
  { campo: "fonte", nome: "Fonte / banco", obrigatorio: false },
  { campo: "descricao", nome: "Descrição", obrigatorio: true },
  { campo: "unidade", nome: "Unidade", obrigatorio: false },
  { campo: "quantidade", nome: "Quantidade", obrigatorio: true },
  { campo: "custoUnitario", nome: "Custo unitário (sem BDI)", obrigatorio: false },
  { campo: "precoUnitario", nome: "Preço unitário (com BDI)", obrigatorio: false },
  { campo: "total", nome: "Total", obrigatorio: false },
] as const;
export type Campo = (typeof CAMPOS)[number]["campo"];
export type Mapa = Partial<Record<Campo, number>>;

export const normalizar = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();

export function textoDe(v: Valor): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(Number(v.toFixed(8))) : "";
  return String(v).replace(/\s+/g, " ").trim();
}

/**
 * Número de uma célula. Números da planilha valem como estão; textos seguem a
 * escrita brasileira ("1.234,56"; "1.234" = mil duzentos e trinta e quatro).
 * Retorna o decimal com ponto ("1234.56") ou null.
 */
export function lerNumero(v: Valor): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? String(Number(v.toFixed(8))) : null;
  let s = v.replace(/R\$|%|\s/g, "");
  if (!s) return null;
  const negativo = /^\(.*\)$/.test(s) || s.startsWith("-");
  s = s.replace(/^[(-]+|\)$/g, "");
  let r: string;
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s) || /^\d+,\d+$/.test(s)) r = s.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(,\d{3})+\.\d+$/.test(s)) r = s.replace(/,/g, ""); // escrita americana
  else if (/^\d+(\.\d+)?$/.test(s)) r = s;
  else return null;
  r = r.replace(/^0+(?=\d)/, "");
  return negativo && Number(r) !== 0 ? `-${r}` : r;
}

// ---------------------------------------------------------------------------
// Cabeçalho e colunas
// ---------------------------------------------------------------------------

/** Campo sugerido pelo título da coluna (ou null). `usados` evita repetir campos de preço. */
export function campoDoTitulo(titulo: string, usados: Set<Campo> = new Set()): Campo | null {
  const t = normalizar(titulo).replace(/[()]/g, " ").replace(/\s+/g, " ").trim();
  if (!t || t.length > 60) return null;
  const comBdi = /(c\/|com|c\.)\s*bdi|bdi incl/.test(t);
  const semBdi = /(s\/|sem|s\.)\s*bdi/.test(t);
  if (/\bunit|\bp\.?\s?u\.?$|^pu\b|preco unit/.test(t)) {
    if (comBdi) return "precoUnitario";
    if (semBdi) return "custoUnitario";
    return usados.has("custoUnitario") ? "precoUnitario" : "custoUnitario";
  }
  if (/^(item|itens|n[o°º]?\.?|num(ero)?|ord(em)?)\.?$|^item\b/.test(t)) return "item";
  if (/^(fonte|banco|base|tabela|origem|sistema|ref\.? fonte)\b/.test(t)) return "fonte";
  if (/^cod|codigo|^ref(erencia)?\.?$|^composicao$/.test(t)) return "codigo";
  if (/descri|discrimina|especifica|^servicos?$|^objeto$/.test(t)) return "descricao";
  if (/^(un|und|unid|unidade|u\.m\.?|um)\.?$/.test(t)) return "unidade";
  if (/^quant|^qtd|^qtde|^qde|^quantitativo/.test(t)) return "quantidade";
  if (/total|^valor|parcial|importancia/.test(t)) return "total";
  return null;
}

/** Linha parece cabeçalho: quantos campos distintos os títulos sugerem. */
function pontuarCabecalho(linha: Valor[]): number {
  const usados = new Set<Campo>();
  for (const c of linha) {
    if (typeof c !== "string") continue;
    const k = campoDoTitulo(c, usados);
    if (k) usados.add(k);
  }
  const essenciais = ["descricao", "quantidade", "codigo", "unidade"].filter((k) => usados.has(k as Campo)).length;
  return essenciais >= 2 ? usados.size : 0;
}

const numerica = (v: Valor) => lerNumero(v) !== null;

export interface Cabecalho {
  /** Índice da linha de cabeçalho (a última, se o título ocupar duas linhas). */
  linha: number | null;
  /** Título de cada coluna (junta as duas linhas do cabeçalho, quando houver). */
  titulos: string[];
}

export function encontrarCabecalho(g: Grade): Cabecalho {
  let melhor = -1;
  let pontos = 0;
  for (let i = 0; i < Math.min(g.length, 80); i++) {
    const p = pontuarCabecalho(g[i] ?? []);
    if (p > pontos) { pontos = p; melhor = i; }
  }
  const largura = Math.max(0, ...g.slice(0, 200).map((l) => l.length));
  if (melhor < 0) return { linha: null, titulos: Array.from({ length: largura }, () => "") };
  const cab = g[melhor].map(textoDe);
  // subtítulos na linha de baixo ("Preço unitário" → "s/ BDI" | "c/ BDI")
  const prox = g[melhor + 1] ?? [];
  const proxTemTitulos = prox.some((c) => typeof c === "string" && /bdi|unit|total|r\$/i.test(c)) && prox.filter(numerica).length < 2;
  let linha = melhor;
  const titulos = Array.from({ length: largura }, (_, c) => cab[c] ?? "");
  if (proxTemTitulos) {
    linha = melhor + 1;
    let pai = "";
    for (let c = 0; c < largura; c++) {
      if (titulos[c]) pai = titulos[c];
      const sub = textoDe(prox[c] ?? null);
      if (sub) titulos[c] = `${titulos[c] || pai} ${sub}`.trim();
    }
  }
  return { linha, titulos };
}

const RE_ITEM = /^\d{1,3}(\.\d{1,3})*\.?$/;
const RE_CODIGOS = [
  /^\d{2}\.\d{3}\.\d{4}(-\w)?$/, // EMOP
  /^[A-Z]{2} ?\d{2}\.\d{2}\.\d{4}/, // SCO-Rio
  /^\d{4,7}(\/\d+)?$/, // SINAPI / SICRO
  /^[A-Z]{1,4}[-. ]?\d{3,}/, // outros (ex.: "COMP-001")
];
const pareceCodigo = (s: string) => RE_CODIGOS.some((r) => r.test(s.toUpperCase()));
const UNIDADES = new Set(["m", "m2", "m²", "m3", "m³", "un", "und", "unid", "kg", "t", "h", "l", "vb", "cj", "pc", "pç", "mes", "mês", "km", "ml", "dm3", "cm", "ha", "conj", "jg", "par", "x", "tkm", "m3xkm", "txkm", "un.", "u", "dia", "sc", "gl"]);
const pareceUnidade = (s: string) => UNIDADES.has(normalizar(s).replace(/\s/g, "")) || /^(m|m2|m3|un|kg|h|t)\/?\w{0,4}$/i.test(s.trim());

/** Sugere o mapeamento: primeiro pelos títulos; o que faltar, pelo conteúdo das colunas. */
export function sugerirMapa(g: Grade, cab: Cabecalho): { mapa: Mapa; porTitulo: Campo[] } {
  const mapa: Mapa = {};
  const usados = new Set<Campo>();
  cab.titulos.forEach((t, c) => {
    const k = campoDoTitulo(t, usados);
    if (!k) return;
    if (k === "total" && usados.has("total")) {
      // vários "total": prefere o com BDI
      if (/(c\/|com)\s*bdi/i.test(t)) mapa.total = c;
      return;
    }
    if (usados.has(k)) return;
    usados.add(k);
    mapa[k] = c;
  });
  const porTitulo = [...usados];
  const dados = g.slice((cab.linha ?? -1) + 1, (cab.linha ?? -1) + 301).filter((l) => l.some((c) => textoDe(c)));
  const ocupadas = () => new Set(Object.values(mapa));
  const proporcao = (c: number, f: (s: string) => boolean) => {
    const ne = dados.map((l) => textoDe(l[c] ?? null)).filter(Boolean);
    return ne.length ? ne.filter(f).length / ne.length : 0;
  };
  const largura = Math.max(cab.titulos.length, ...dados.map((l) => l.length));
  const livres = () => Array.from({ length: largura }, (_, c) => c).filter((c) => !ocupadas().has(c));
  if (mapa.codigo === undefined) {
    const c = livres().map((c) => ({ c, p: proporcao(c, (s) => pareceCodigo(s) && !RE_ITEM.test(s)) })).sort((a, b) => b.p - a.p)[0];
    if (c && c.p >= 0.3) mapa.codigo = c.c;
  }
  if (mapa.unidade === undefined) {
    const c = livres().map((c) => ({ c, p: proporcao(c, pareceUnidade) })).sort((a, b) => b.p - a.p)[0];
    if (c && c.p >= 0.4) mapa.unidade = c.c;
  }
  if (mapa.descricao === undefined) {
    const media = (c: number) => {
      const ne = dados.map((l) => textoDe(l[c] ?? null)).filter((s) => s && !numerica(s));
      return ne.length ? ne.reduce((a, s) => a + s.length, 0) / dados.length : 0;
    };
    const c = livres().map((c) => ({ c, m: media(c) })).sort((a, b) => b.m - a.m)[0];
    if (c && c.m >= 12) mapa.descricao = c.c;
  }
  if (mapa.item === undefined) {
    const c = livres().filter((c) => c < (mapa.descricao ?? largura)).map((c) => ({ c, p: proporcao(c, (s) => RE_ITEM.test(s)) })).sort((a, b) => b.p - a.p)[0];
    if (c && c.p >= 0.6) mapa.item = c.c;
  }
  if (mapa.quantidade === undefined && mapa.unidade !== undefined) {
    const c = livres().filter((c) => c > mapa.unidade!).find((c) => proporcao(c, (s) => numerica(s)) >= 0.6);
    if (c !== undefined) mapa.quantidade = c;
  }
  return { mapa, porTitulo };
}

// ---------------------------------------------------------------------------
// Linhas
// ---------------------------------------------------------------------------

export type TipoLinha = "ETAPA" | "ITEM" | "IGNORADA";

export interface LinhaImportada {
  /** Linha na grade (0 = primeira). */
  indice: number;
  tipo: TipoLinha;
  item: string | null;
  codigo: string | null;
  fonte: string | null;
  descricao: string;
  unidade: string | null;
  quantidade: string | null;
  custoUnitario: string | null;
  precoUnitario: string | null;
  total: string | null;
  /** Motivo de linha ignorada ou observação. */
  nota?: string;
}

const RE_TOTAL = /^(sub-? ?total|total|valor total|custo (direto|total)|bdi\b|total geral|soma|valor do bdi|total da etapa|total do orcamento)/;

/**
 * Classifica as linhas abaixo do cabeçalho. `continuacao`: textos soltos
 * (sem item, código, unidade nem quantidade) continuam a descrição da linha
 * anterior — comum em PDF, onde a descrição quebra em várias linhas.
 */
export function lerLinhas(g: Grade, cab: Cabecalho, mapa: Mapa, opcoes: { continuacao?: boolean } = {}): LinhaImportada[] {
  const col = (l: Valor[], k: Campo) => (mapa[k] === undefined ? "" : textoDe(l[mapa[k]!] ?? null));
  const num = (l: Valor[], k: Campo) => (mapa[k] === undefined ? null : lerNumero(l[mapa[k]!] ?? null));
  const linhas: LinhaImportada[] = [];
  for (let i = (cab.linha ?? -1) + 1; i < g.length; i++) {
    const l = g[i] ?? [];
    if (!l.some((c) => textoDe(c))) continue;
    const base: LinhaImportada = {
      indice: i, tipo: "IGNORADA", item: col(l, "item") || null, codigo: col(l, "codigo") || null, fonte: col(l, "fonte") || null,
      descricao: col(l, "descricao"), unidade: col(l, "unidade") || null, quantidade: num(l, "quantidade"),
      custoUnitario: num(l, "custoUnitario"), precoUnitario: num(l, "precoUnitario"), total: num(l, "total"),
    };
    const textoLinha = normalizar(l.map(textoDe).filter(Boolean).join(" "));
    if (pontuarCabecalho(l) >= 3) { linhas.push({ ...base, nota: "cabeçalho repetido" }); continue; }
    const desc = normalizar(base.descricao);
    if (RE_TOTAL.test(desc) || (!base.descricao && RE_TOTAL.test(textoLinha))) { linhas.push({ ...base, nota: "linha de total" }); continue; }
    const qtd = base.quantidade !== null && Number(base.quantidade) > 0;
    // item: tem quantidade e unidade (ou um código com cara de código). Linha de etapa costuma trazer
    // o total da etapa em alguma coluna numérica, mas não tem unidade.
    const codigoValido = !!base.codigo && pareceCodigo(base.codigo);
    if (qtd && (base.codigo || base.descricao) && (mapa.unidade === undefined || base.unidade || codigoValido)) { linhas.push({ ...base, tipo: "ITEM" }); continue; }
    const soTexto = base.descricao && !base.item && !base.codigo && !base.unidade && base.quantidade === null;
    const anterior = linhas[linhas.length - 1];
    if (opcoes.continuacao && soTexto && anterior && anterior.tipo !== "IGNORADA") {
      anterior.descricao = `${anterior.descricao} ${base.descricao}`.trim();
      continue;
    }
    // título de etapa escrito fora da coluna de descrição (célula mesclada)
    if (!base.descricao && !base.unidade) {
      const livre = l.map((c, k) => (k === mapa.item ? "" : textoDe(c))).find((t) => t && lerNumero(t) === null && !pareceCodigo(t) && t.length >= 3);
      if (livre) { base.descricao = livre; if (base.codigo === livre) base.codigo = null; if (base.fonte === livre) base.fonte = null; }
    }
    if (base.descricao && !base.unidade && !codigoValido && (base.quantidade === null || mapa.unidade !== undefined)) {
      linhas.push({ ...base, tipo: "ETAPA", quantidade: null });
      continue;
    }
    if (base.codigo || base.descricao) linhas.push({ ...base, nota: qtd ? undefined : "sem quantidade" });
  }
  return linhas;
}

/** Fonte provável pelo formato do código (null = ambíguo, decide a conferência nas bases). */
export function fontePeloCodigo(codigo: string): string | null {
  const c = codigo.trim().toUpperCase();
  if (/^\d{2}\.\d{3}\.\d{4}(-\w)?$/.test(c)) return "EMOP";
  if (/^[A-Z]{2} ?\d{2}\.\d{2}\.\d{4}/.test(c)) return "SCO";
  return null;
}

/** Fonte citada na coluna "fonte" (ou null). */
export function fonteCitada(texto: string | null): string | null {
  const t = normalizar(texto ?? "");
  if (/emop/.test(t)) return "EMOP";
  if (/sinapi/.test(t)) return "SINAPI";
  if (/sicro|dnit/.test(t)) return "SICRO";
  if (/\bsco\b|rio ?obras|sco-?rio/.test(t)) return "SCO";
  if (/propri|cotac|mercado/.test(t)) return "PROPRIA";
  return null;
}

// ---------------------------------------------------------------------------
// Estrutura: etapas e itens
// ---------------------------------------------------------------------------

export interface EtapaImportada {
  chave: string;
  titulo: string;
  paiChave: string | null;
}

export interface ItemEstruturado extends LinhaImportada {
  etapaChave: string;
}

/**
 * Monta etapas (com subetapas pela numeração: "1" → "1.1") e associa cada
 * item à etapa mais recente. Itens antes de qualquer etapa vão para
 * "Itens importados".
 */
export function montarEstrutura(linhas: LinhaImportada[]): { etapas: EtapaImportada[]; itens: ItemEstruturado[] } {
  const etapas: EtapaImportada[] = [];
  const itens: ItemEstruturado[] = [];
  const porNumero = new Map<string, string>();
  let atual: string | null = null;
  let chaves = 0;
  const limpar = (n: string | null) => (n ?? "").replace(/\.$/, "");
  for (const l of linhas) {
    if (l.tipo === "ETAPA") {
      const numero = limpar(l.item);
      let pai: string | null = null;
      if (numero.includes(".")) pai = porNumero.get(numero.slice(0, numero.lastIndexOf("."))) ?? null;
      const chave = `e${++chaves}`;
      const titulo = (l.descricao || l.codigo || "Etapa").slice(0, 200);
      etapas.push({ chave, titulo, paiChave: pai });
      if (numero) porNumero.set(numero, chave);
      atual = chave;
    } else if (l.tipo === "ITEM") {
      // item numerado "2.3" quando a etapa "2" existe: pertence a ela, mesmo se outra veio antes
      const numero = limpar(l.item);
      const doNumero = numero.includes(".") ? porNumero.get(numero.slice(0, numero.lastIndexOf("."))) : undefined;
      if (!atual && !doNumero) {
        atual = `e${++chaves}`;
        etapas.push({ chave: atual, titulo: "Itens importados", paiChave: null });
      }
      itens.push({ ...l, etapaChave: doNumero ?? atual! });
    }
  }
  // etapas sem itens (nem subetapas com itens) são descartadas: costumam ser rodapés ou observações
  const comItens = new Set(itens.map((i) => i.etapaChave));
  let mudou = true;
  while (mudou) {
    mudou = false;
    for (const e of etapas) if (comItens.has(e.chave) && e.paiChave && !comItens.has(e.paiChave)) { comItens.add(e.paiChave); mudou = true; }
  }
  return { etapas: etapas.filter((e) => comItens.has(e.chave)), itens };
}

// ---------------------------------------------------------------------------
// Dados de cadastro (acima da tabela)
// ---------------------------------------------------------------------------

export interface DadosIdentificados {
  obraNome?: string;
  obraCodigo?: string;
  processo?: string;
  descricao?: string;
  endereco?: string;
  municipio?: string;
  orgaoSolicitante?: string;
  titulo?: string;
  codigoOrcamento?: string;
  /** BDI em % (decimal com ponto). */
  bdi?: string;
  /** Bases citadas: fonte e competência (AAAA-MM). */
  referencias: { fonte: string; competencia: string | null }[];
  /** true = com desoneração; false = sem; undefined = não identificado. */
  desonerado?: boolean;
}

const ROTULOS: { chave: Exclude<keyof DadosIdentificados, "referencias" | "desonerado" | "bdi">; re: RegExp }[] = [
  { chave: "obraCodigo", re: /^(codigo da obra|cod\.? da obra|obra n[o°º]\.?|n[o°º]\.? da obra|numero da obra)$/ },
  { chave: "processo", re: /^(processo|proc\.?|n[o°º]\.? do processo|processo administrativo|processo n[o°º]\.?|sei)$/ },
  { chave: "obraNome", re: /^(obra|empreendimento|nome da obra|projeto)$/ },
  { chave: "descricao", re: /^(descricao|objeto|descricao da obra|servico|servicos)$/ },
  { chave: "endereco", re: /^(endereco|local|localizacao|logradouro|local da obra)$/ },
  { chave: "municipio", re: /^(municipio|cidade|municipio\/uf|cidade\/uf)$/ },
  { chave: "orgaoSolicitante", re: /^(orgao|orgao solicitante|solicitante|contratante|cliente|secretaria|unidade solicitante)$/ },
  { chave: "titulo", re: /^(titulo|orcamento|nome do orcamento)$/ },
  { chave: "codigoOrcamento", re: /^(codigo do orcamento|orcamento n[o°º]\.?|n[o°º]\.? do orcamento)$/ },
];

/** Procura "Rótulo: valor" nos textos antes da tabela (e o BDI e as bases em todo o texto). */
export function identificarDados(textoAntes: string[][], textoTodo: string): DadosIdentificados {
  const d: DadosIdentificados = { referencias: [] };
  for (const celulas of textoAntes) {
    // células da linha; "Rótulo: valor" pode estar numa célula ou dividido em duas
    const partes = celulas.map((c) => c.trim()).filter(Boolean);
    for (let i = 0; i < partes.length; i++) {
      // vários pares na mesma célula/linha ("Obra: X  Processo: Y")
      const re = /([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ°º./ ]{1,40}?)\s*:\s*/g;
      const achados: { rotulo: string; ini: number; fim: number }[] = [];
      for (let m; (m = re.exec(partes[i])); ) achados.push({ rotulo: m[1], ini: m.index, fim: re.lastIndex });
      if (!achados.length) continue;
      achados.forEach((a, k) => {
        const valor = partes[i].slice(a.fim, achados[k + 1]?.ini ?? undefined).trim() || (k === achados.length - 1 ? partes[i + 1] ?? "" : "");
        // o rótulo pode trazer texto anterior ("PREFEITURA X Obra"): usa as últimas palavras que casam
        const palavras = normalizar(a.rotulo).split(" ");
        for (let n = Math.min(4, palavras.length); n >= 1; n--) {
          const rot = palavras.slice(-n).join(" ");
          const r = ROTULOS.find((x) => x.re.test(rot));
          if (!r) continue;
          let chave = r.chave;
          const v = valor.replace(/\s+/g, " ").trim().slice(0, 300);
          if (!v || /^[-–—]$/.test(v)) break;
          // "Obra: OB-001" (só o código, como nos relatórios do sistema)
          if (chave === "obraNome" && /^[\w./-]{1,20}$/.test(v) && /\d/.test(v) && !d.obraCodigo) chave = "obraCodigo";
          if (!d[chave]) d[chave] = v;
          break;
        }
      });
    }
  }
  // "Orçamento: 0007 — Reforma" (código e título juntos, como nos relatórios do sistema)
  const ct = d.titulo && /^([\w./-]{1,20})\s+[—–-]\s+(.+)$/.exec(d.titulo);
  if (ct && /\d/.test(ct[1]) && !d.codigoOrcamento) { d.codigoOrcamento = ct[1]; d.titulo = ct[2]; }
  if (!d.orgaoSolicitante) {
    const org = textoAntes.flat().map((c) => c.trim()).find((c) => /^(prefeitura|secretaria|governo|municipio de|fundacao|instituto)\b/i.test(normalizar(c)));
    if (org) d.orgaoSolicitante = org.slice(0, 200);
  }
  const t = normalizar(textoTodo);
  const bdi = /\bbdi\b[^0-9%\n]{0,30}?(\d{1,2}(?:[.,]\d{1,4})?)\s*%/.exec(t);
  if (bdi) d.bdi = lerNumero(bdi[1]) ?? undefined;
  const meses = ["janeiro", "fevereiro", "marco", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
  for (const [nome, fonte] of [["emop", "EMOP"], ["sinapi", "SINAPI"], ["sicro", "SICRO"], ["sco", "SCO"]] as const) {
    const re = new RegExp(`\\b${nome}\\b[^\\n]{0,40}?(?:(\\d{1,2})[/.-](\\d{4})|(${meses.join("|")})\\s*(?:de\\s*|/\\s*)?(\\d{4}))`);
    const m = re.exec(t);
    if (m) {
      const mes = m[1] ? Number(m[1]) : meses.indexOf(m[3]) + 1;
      const ano = m[2] ?? m[4];
      d.referencias.push({ fonte, competencia: mes >= 1 && mes <= 12 ? `${ano}-${String(mes).padStart(2, "0")}` : null });
    } else if (new RegExp(`\\b${nome}\\b`).test(t)) d.referencias.push({ fonte, competencia: null });
  }
  if (/nao desonerad|sem desonera|\bonerad/.test(t)) d.desonerado = false;
  else if (/desonerad|com desonera/.test(t)) d.desonerado = true;
  return d;
}

/** Atalho: tudo o que a tela precisa a partir da grade. */
export function analisarGrade(g: Grade, opcoes: { continuacao?: boolean; textoExtra?: string } = {}) {
  const cabecalho = encontrarCabecalho(g);
  const { mapa, porTitulo } = sugerirMapa(g, cabecalho);
  const antes = g.slice(0, cabecalho.linha ?? 0).map((l) => l.map(textoDe));
  const textoTodo = [opcoes.textoExtra ?? "", ...g.map((l) => l.map(textoDe).join(" "))].join("\n");
  return { cabecalho, mapa, porTitulo, dados: identificarDados(antes, textoTodo) };
}
