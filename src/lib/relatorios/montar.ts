/**
 * Montagem dos 10 relatórios do orçamento (dados → `Documento`).
 *
 * Regras:
 *  - Revisão FECHADA: valores gravados no fechamento (itens, totais, analítico,
 *    dados da obra e perfis de BDI). Nada é recalculado.
 *  - Revisão EM ELABORAÇÃO: valores atuais, com aviso de prévia.
 *  - Toda folha traz obra, orçamento, revisão, bases (fonte, competência,
 *    retificação, regime), data de referência e dados de emissão.
 */
import type { Executor } from "../banco/executor";
import { calcularBdi } from "../calculo/bdi";
import { curvaAbc } from "../calculo/abc";
import { arredondar, dec, formatarNumero, type Dec } from "../calculo/decimal";
import { avaliarMemoria } from "../calculo/expressao";
import { listarPerfis, type ParcelaPerfil } from "../orcamento/bdi";
import {
  carregarRevisao, compararRevisoes, contextoDaRevisao, ErroOrcamento, lerCronograma, montarAnaliticos, perfisDaRevisao,
  type AnaliticoItem, type EstadoRevisao, type LinhaItem,
} from "../orcamento/servico";
import { VERSAO_SISTEMA } from "../versao";
import type { Celula, Coluna, Documento, Linha, Secao, TipoRelatorio } from "./documento";
import { RELATORIOS } from "./documento";
import type { AnaliticaSicro } from "../importacao/adaptadores/sicro-xlsx";
import { cabecalhoDaRevisao, type CabecalhoDocumento } from "./cabecalhos";
import { explodirInsumos } from "./insumos";

export class ErroRelatorio extends Error {}

export interface OpcoesRelatorio {
  /** comparativo: revisão a comparar com a revisão do relatório */
  outraRevisaoId?: string | null;
  emitidoPor: string;
  agora?: Date;
}

interface ObraDados { nome: string; codigo: string | null; processo: string | null; descricao: string | null; endereco: string | null; municipio: string | null; uf: string | null; orgaoSolicitante: string | null }

interface Contexto {
  ex: Executor;
  estado: EstadoRevisao;
  obra: ObraDados;
  fechada: boolean;
  identificacao: { rotulo: string; valor: string }[][];
  avisos: string[];
  rodape: string;
  nomeBase: string;
  cabecalho: CabecalhoDocumento | null;
}

const dataHora = (d: Date) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(d).replace(",", "");
const dataBr = (iso: string) => iso.split("-").reverse().join("/");
const competencia = (c: string) => c.split("-").reverse().join("/");
const moeda2 = (v: Dec | string) => arredondar(v, 2).toFixed(2);
const fmtPct = (v: Dec | string) => `${formatarNumero(v, 2)}%`;
const fmtMoeda = (v: Dec | string) => `R$ ${formatarNumero(v, 2)}`;
const span = (valor: string | null, n: number): Celula => ({ valor, span: n });

function arquivo(s: string) {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/[^\w.-]+/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "").slice(0, 80);
}

async function contexto(ex: Executor, revisaoId: string, o: OpcoesRelatorio, tipo: TipoRelatorio): Promise<Contexto> {
  const estado = await carregarRevisao(ex, revisaoId).catch((e) => { if (e instanceof ErroOrcamento) throw new ErroRelatorio(e.message); throw e; });
  const r = estado.revisao;
  const fechada = r.status === "FECHADA";
  const [snap] = await ex.consulta<{ obra: Record<string, string | null> | null }>(`SELECT obra_snapshot AS obra FROM orcamento_revisao WHERE id = $1`, [revisaoId]);
  const oc = estado.orcamento;
  const obra: ObraDados = snap?.obra
    ? { nome: snap.obra.nome ?? oc.obraNome, codigo: snap.obra.codigo ?? null, processo: snap.obra.processo ?? null, descricao: snap.obra.descricao ?? null, endereco: snap.obra.endereco ?? null, municipio: snap.obra.municipio ?? null, uf: snap.obra.uf ?? null, orgaoSolicitante: snap.obra.orgao_solicitante ?? null }
    : { nome: oc.obraNome, codigo: oc.obraCodigo, processo: oc.processo, descricao: null, endereco: oc.endereco, municipio: oc.municipio, uf: oc.uf, orgaoSolicitante: oc.orgaoSolicitante };
  if (!snap?.obra) {
    const [d] = await ex.consulta<{ descricao: string | null }>(`SELECT descricao FROM obra WHERE id = $1`, [oc.obraId]);
    obra.descricao = d?.descricao ?? null;
  }
  const local = [obra.endereco, [obra.municipio, obra.uf].filter(Boolean).join("/")].filter(Boolean).join(" — ");
  // BDIs usados na planilha: global (nos itens sem BDI próprio) e os diferenciados
  const [snapBdi] = await ex.consulta<{ bdi: { id: string; nome: string }[] | null }>(`SELECT bdi_snapshot AS bdi FROM orcamento_revisao WHERE id = $1`, [revisaoId]);
  const idsPerfis = [...new Set([r.bdiPerfilId, ...estado.itens.map((i) => i.bdiPerfilId)].filter((x): x is string => !!x))];
  const nomesPerfis = new Map((snapBdi?.bdi ?? (idsPerfis.length ? await ex.consulta<{ id: string; nome: string }>(`SELECT id, nome FROM bdi_perfil WHERE id = ANY($1::uuid[])`, [idsPerfis]) : [])).map((p) => [p.id, p.nome]));
  const bdis: string[] = [];
  if (!estado.itens.length || estado.itens.some((i) => !i.bdiPerfilId)) {
    bdis.push(r.bdiPercentual ? `${fmtPct(r.bdiPercentual)}${r.bdiPerfilId && nomesPerfis.get(r.bdiPerfilId) ? ` (${nomesPerfis.get(r.bdiPerfilId)})` : ""}${idsPerfis.some((id) => id !== r.bdiPerfilId) ? " global" : ""}` : "sem BDI");
  }
  for (const id of idsPerfis) {
    const pcts = [...new Set(estado.itens.filter((i) => i.bdiPerfilId === id).map((i) => fmtPct(i.bdiPercentual)))];
    if (pcts.length) bdis.push(`${pcts.join(" / ")} (${nomesPerfis.get(id) ?? "perfil"})`);
  }
  const par = (rotulo: string, valor: string | null | undefined) => (valor ? [{ rotulo, valor }] : []);
  const identificacao = [
    [...par("Obra", obra.codigo ?? obra.nome), ...par("Processo", obra.processo), ...par("Órgão solicitante", obra.orgaoSolicitante)],
    par("Orçamento", `${oc.codigo ? `${oc.codigo} — ` : ""}${oc.titulo}`),
    par("Local", local),
    par("Descrição", obra.descricao),
    [
      ...par("Bases de referência", estado.basesPadrao.map((b) => `${b.fonte} RJ ${competencia(b.competencia)}${b.numeroBase > 0 ? ` (retificação ${b.numeroBase})` : ""} — ${b.regimeNome ?? "preço único"}`).join("; ") || "—"),
      ...par(bdis.length > 1 ? "BDIs" : "BDI", `${bdis.join("; ")} · preços ${r.arredondamento === "TRUNCAR" ? "truncados" : "arredondados"} a 2 casas`),
    ],
    [
      ...par("Data de referência", dataBr(r.dataReferencia)),
      ...par("Revisão", `nº ${r.numero}${r.descricao ? ` (${r.descricao})` : ""} — ${fechada ? `fechada em ${r.fechadaEm}${r.fechadaPor ? ` por ${r.fechadaPor}` : ""}` : "EM ELABORAÇÃO"}`),
    ],
  ].filter((linha) => linha.length);
  const avisos: string[] = [];
  if (!fechada) avisos.push("PRÉVIA — revisão em elaboração: os valores podem mudar até o fechamento da revisão.");
  if (estado.totais.pendencias > 0) avisos.push(`${estado.totais.pendencias} item(ns) com pendência de preço (ver orçamento).`);
  const nome = RELATORIOS.find((x) => x.tipo === tipo)!.nome;
  return {
    ex, estado, obra, fechada, identificacao, avisos, cabecalho: await cabecalhoDaRevisao(ex, revisaoId),
    rodape: `Emitido em ${dataHora(o.agora ?? new Date())} por ${o.emitidoPor} · Orçamento de Obras ${VERSAO_SISTEMA} · revisão ${r.numero}, versão de edição ${r.versao}`,
    nomeBase: arquivo(`${nome}_${oc.codigo ?? ""}_${oc.titulo}_rev${r.numero}`),
  };
}

function documento(c: Contexto, tipo: TipoRelatorio, orientacao: Documento["orientacao"], secoes: Secao[], avisosExtras: string[] = []): Documento {
  return {
    tipo, cabecalho: c.cabecalho, titulo: RELATORIOS.find((x) => x.tipo === tipo)!.nome, orientacao, identificacao: c.identificacao,
    avisos: [...c.avisos, ...avisosExtras], secoes, rodape: c.rodape, nomeArquivo: c.nomeBase,
  };
}

/** Etapas em ordem de árvore, com o nível (0 = principal). */
function etapasEmOrdem(e: EstadoRevisao) {
  const saida: { etapa: EstadoRevisao["etapas"][number]; nivel: number }[] = [];
  const visitar = (paiId: string | null, nivel: number) => {
    for (const et of e.etapas.filter((x) => x.paiId === paiId).sort((a, b) => a.ordem - b.ordem)) {
      saida.push({ etapa: et, nivel });
      visitar(et.id, nivel + 1);
    }
  };
  visitar(null, 0);
  return saida;
}
const itensDaEtapa = (e: EstadoRevisao, etapaId: string) => e.itens.filter((i) => i.etapaId === etapaId).sort((a, b) => a.ordem - b.ordem);
const estiloEtapa = (nivel: number) => (nivel === 0 ? "grupo1" : nivel === 1 ? "grupo2" : "grupo3") as Linha["estilo"];
/** Rótulo da fonte nos relatórios. */
const rotuloFonte = (f: string) => (f === "PROPRIA" ? "Próprio" : f === "INFORMADO" ? "Informado" : f);
const referenciaDoItem = (it: LinhaItem) => it.referenciaPreco ?? (it.fonte === "PROPRIA" ? "Próprio" : "—");

function linhasTotais(e: EstadoRevisao, nCols: number): Linha[] {
  return [
    { celulas: [span("Custo direto total", nCols - 1), e.totais.custoDireto], estilo: "subtotal" },
    { celulas: [span("BDI", nCols - 1), e.totais.bdi], estilo: "subtotal" },
    { celulas: [span("TOTAL GERAL", nCols - 1), e.totais.total], estilo: "total" },
  ];
}

// ---------------------------------------------------------------------------
// 1. Sintético  /  2. Analítico
// ---------------------------------------------------------------------------

const COLS_ORCAMENTO: Coluna[] = [
  { titulo: "Item", tipo: "texto", largura: 5 },
  { titulo: "Fonte", tipo: "texto", largura: 6 },
  { titulo: "Código", tipo: "codigo", largura: 10 },
  { titulo: "Descrição", tipo: "texto", largura: 40 },
  { titulo: "Unid.", tipo: "texto", largura: 5 },
  { titulo: "Quant.", tipo: "quantidade", largura: 9 },
  { titulo: "Custo unit. (R$)", tipo: "moeda", largura: 9 },
  { titulo: "BDI", tipo: "percentual", largura: 6 },
  { titulo: "Preço unit. (R$)", tipo: "moeda", largura: 9 },
  { titulo: "Preço total (R$)", tipo: "moeda", largura: 11 },
];

async function orcamento(c: Contexto, analitico: boolean): Promise<Documento> {
  const e = c.estado;
  const modo = e.revisao.arredondamento;
  const analiticos = analitico && !c.fechada ? new Map((await montarAnaliticos(c.ex, e.revisao.id, e.itens)).map((a) => [a.id, a.analitico])) : null;
  // analítico: coluna extra "Custo parcial" (componentes) depois do custo unitário
  const colunas: Coluna[] = analitico
    ? [...COLS_ORCAMENTO.slice(0, 5), { ...COLS_ORCAMENTO[5], titulo: "Quant. / coef." }, { ...COLS_ORCAMENTO[6], titulo: "Custo unit. (R$)" }, { titulo: "Custo parcial (R$)", tipo: "moeda", largura: 9 }, ...COLS_ORCAMENTO.slice(7)]
    : COLS_ORCAMENTO;
  const n = colunas.length;
  const linhas: Linha[] = [];
  const notas: string[] = [];
  const padrao = new Map(e.basesPadrao.map((b) => [b.fonte, b]));
  for (const { etapa, nivel } of etapasEmOrdem(e)) {
    linhas.push({ celulas: [etapa.numero, span(etapa.titulo, n - 2), etapa.total], estilo: estiloEtapa(nivel) });
    for (const it of itensDaEtapa(e, etapa.id)) {
      const p = padrao.get(it.fonte);
      if (it.fonte !== "PROPRIA" && p && (p.baseRevisaoId !== it.baseRevisaoId || p.regime !== it.regime)) notas.push(`Item ${it.numero} (${it.codigo}): base/regime diferente do padrão — ${referenciaDoItem(it)}.`);
      if (it.pendencia) notas.push(`Item ${it.numero} (${it.codigo}): ${it.pendencia}`);
      const cu = arredondar(it.custoUnitario, 2, modo).toFixed(2);
      const base = [it.numero, rotuloFonte(it.fonte), it.codigo, it.descricao, it.unidade, it.quantidade, cu];
      linhas.push({ celulas: analitico ? [...base, "", it.bdiPercentual, it.precoUnitario, it.precoTotal] : [...base, it.bdiPercentual, it.precoUnitario, it.precoTotal], estilo: analitico ? "destaque" : undefined });
      if (!analitico || it.tipo !== "COMPOSICAO") continue;
      const an = (analiticos?.get(it.id) ?? it.analitico) as AnaliticoItem | null;
      if (an?.tipo === "SICRO" && an.sicro) {
        for (const l of linhasSicro(an.sicro)) {
          if ("grupo" in l) linhas.push({ celulas: ["", span(l.grupo, n - 1)], estilo: "detalhe" });
          else if ("total" in l) linhas.push({ celulas: ["", span(l.total, 6), l.valor ? { valor: l.valor, tipo: "preco" } : "", "", "", ""], estilo: "detalhe" });
          else linhas.push({ celulas: ["", "SICRO", l.codigo, l.descricao, l.unidade, { valor: l.quantidade, tipo: "coeficiente" }, l.preco ? { valor: l.preco, tipo: "preco" } : "", l.custo ? { valor: l.custo, tipo: "preco" } : l.tipo === "Transporte" ? "não incluído" : "", "", "", ""], estilo: "detalhe" });
        }
        continue;
      }
      if (!an?.linhas?.length) {
        linhas.push({ celulas: ["", span("Composição analítica não publicada pela fonte nesta base — custo adotado = preço de referência publicado.", n - 1)], estilo: "detalhe" });
        continue;
      }
      let soma = dec(0);
      for (const l of an.linhas) {
        if (l.custo) soma = soma.plus(l.custo);
        linhas.push({
          celulas: ["", rotuloFonte(l.fonte), l.codigo, `${l.descricao}${l.percentual && !dec(l.percentual).isZero() ? ` (+${formatarNumero(l.percentual, 2)}%)` : ""}`, l.unidade ?? "",
            { valor: l.coeficiente, tipo: "coeficiente" }, l.precoUnitario ? { valor: l.precoUnitario, tipo: "preco" } : l.situacao === "% sobre a mão de obra" ? "% s/ MO" : "sem preço", l.custo ? moeda2(l.custo) : "", "", "", ""],
          estilo: "detalhe",
        });
      }
      linhas.push({ celulas: ["", span(`Soma dos componentes: R$ ${formatarNumero(soma, 2)} · custo unitário adotado: R$ ${formatarNumero(cu, 2)} (${referenciaDoItem(it)})`, n - 1)], estilo: "detalhe" });
    }
  }
  linhas.push(...linhasTotais(e, n));
  const secoes: Secao[] = [{ tabela: { colunas, linhas } }];
  if (analitico) secoes.push({ paragrafos: ["Linhas de componentes: coeficiente, preço unitário do componente na base do item e custo parcial = coeficiente × preço × (1 + percentual adicional). O custo unitário adotado é o preço de referência publicado pela fonte; a soma dos componentes pode diferir por arredondamentos da própria fonte."] });
  if (notas.length) secoes.push({ titulo: "Observações", paragrafos: notas });
  return documento(c, analitico ? "analitico" : "sintetico", "paisagem", secoes);
}

const NATUREZA: Record<string, string> = { INSUMO: "Insumo", COMPOSICAO: "Composição" };

/**
 * Composição SICRO (formato publicado pelo DNIT) em linhas para os relatórios:
 * grupos (A–F), linhas de componentes e totais, com os valores publicados.
 */
type LinhaSicro =
  | { grupo: string }
  | { codigo: string; descricao: string; tipo: string; unidade: string; quantidade: string | null; preco: string | null; custo: string | null }
  | { total: string; valor: string | null };

function linhasSicro(a: AnaliticaSicro): LinhaSicro[] {
  const t = a.totais;
  const fmtQ = (v: string | null) => (v ? formatarNumero(v, Math.min(Math.max(dec(v).decimalPlaces(), 2), 6)) : "—");
  const out: LinhaSicro[] = [];
  out.push({ grupo: `A - Equipamentos (custo horário) · produção da equipe: ${fmtQ(a.producao.quantidade)} ${a.producao.unidade ?? ""}/h` });
  for (const e of a.equipamentos) out.push({ codigo: e.codigo, descricao: `${e.descricao ?? ""} (utilização operativa ${fmtQ(e.operativa)}, improdutiva ${fmtQ(e.improdutiva)}; custo improdutivo R$ ${e.custoImprodutivo ? formatarNumero(e.custoImprodutivo, 4) : "—"})`, tipo: "Equipamento", unidade: "h", quantidade: e.quantidade, preco: e.custoProdutivo, custo: e.custoHorario });
  out.push({ total: "Custo horário total de equipamentos", valor: t.equipamentos ?? "0" });
  out.push({ grupo: "B - Mão de obra (custo horário)" });
  for (const m of a.maoDeObra) out.push({ codigo: m.codigo, descricao: m.descricao ?? "", tipo: "Mão de obra", unidade: m.unidade ?? "", quantidade: m.quantidade, preco: m.custoHorario, custo: m.custo });
  out.push({ total: "Custo horário total de mão de obra", valor: t.maoDeObra ?? "0" });
  out.push({ total: "Custo horário total de execução", valor: t.execucaoHorario ?? "0" });
  out.push({ total: `Custo unitário de execução (÷ produção da equipe ${fmtQ(a.producao.quantidade)})`, valor: t.execucaoUnitario ?? "0" });
  out.push({ total: `Custo do FIC (FIC ${a.fic ? formatarNumero(a.fic, Math.max(dec(a.fic).decimalPlaces(), 2)) : "—"})`, valor: t.fic ?? "0" });
  out.push({ grupo: "C - Material" });
  for (const m of a.materiais) out.push({ codigo: m.codigo, descricao: m.descricao ?? "", tipo: "Material", unidade: m.unidade ?? "", quantidade: m.quantidade, preco: m.precoUnitario, custo: m.custo });
  out.push({ total: "Custo unitário total de material", valor: t.material ?? "0" });
  if (a.auxiliares.length) {
    out.push({ grupo: "D - Atividades auxiliares" });
    for (const m of a.auxiliares) out.push({ codigo: m.codigo, descricao: m.descricao ?? "", tipo: "Ativ. auxiliar", unidade: m.unidade ?? "", quantidade: m.quantidade, preco: m.custoUnitario, custo: m.custo });
    out.push({ total: "Custo total de atividades auxiliares", valor: t.auxiliares ?? "0" });
  }
  out.push({ total: "Subtotal", valor: t.subtotal });
  if (a.tempoFixo.length) {
    out.push({ grupo: "E - Tempo fixo" });
    for (const m of a.tempoFixo) out.push({ codigo: m.item, descricao: `${m.descricao ?? ""}${m.codigo ? ` (comp. ${m.codigo})` : ""}`, tipo: "Tempo fixo", unidade: m.unidade ?? "", quantidade: m.quantidade, preco: m.custoUnitario, custo: m.custo });
    out.push({ total: "Custo unitário total de tempo fixo", valor: t.tempoFixo ?? "0" });
  }
  if (a.transporte.length) {
    out.push({ grupo: "F - Momento de transporte (custo não incluído: depende da DMT da obra)" });
    for (const m of a.transporte) out.push({ codigo: m.item, descricao: `${m.descricao ?? ""} (DMT: LN ${m.ln ?? "—"}, RP ${m.rp ?? "—"}, P ${m.p ?? "—"})`, tipo: "Transporte", unidade: m.unidade ?? "", quantidade: m.quantidade, preco: null, custo: m.custo });
  }
  out.push({ total: "Custo unitário direto total (publicado)", valor: t.total });
  return out;
}

// ---------------------------------------------------------------------------
// 3. CPU
// ---------------------------------------------------------------------------

async function cpu(c: Contexto): Promise<Documento> {
  const e = c.estado;
  const comps = e.itens.filter((i) => i.tipo === "COMPOSICAO");
  const analiticos = !c.fechada ? new Map((await montarAnaliticos(c.ex, e.revisao.id, comps)).map((a) => [a.id, a.analitico])) : null;
  const vistos = new Set<string>();
  const secoes: Secao[] = [];
  const ordem = etapasEmOrdem(e).flatMap(({ etapa }) => itensDaEtapa(e, etapa.id)).filter((i) => i.tipo === "COMPOSICAO");
  for (const it of ordem) {
    // uma CPU por serviço/base/regime/custo (o mesmo serviço em vários itens aparece uma vez)
    const k = `${it.itemReferenciaId}|${it.baseRevisaoId}|${it.regime}|${it.custoUnitario}|${it.bdiPercentual}`;
    if (vistos.has(k)) continue;
    vistos.add(k);
    const an = (analiticos?.get(it.id) ?? it.analitico) as AnaliticoItem | null;
    const usados = ordem.filter((x) => `${x.itemReferenciaId}|${x.baseRevisaoId}|${x.regime}|${x.custoUnitario}|${x.bdiPercentual}` === k).map((x) => x.numero);
    const campos = [
      { rotulo: "Serviço", valor: `${rotuloFonte(it.fonte)} ${it.codigo} — ${it.descricao}` },
      { rotulo: "Unidade", valor: it.unidade || "—" },
      { rotulo: "Referência", valor: referenciaDoItem(it) },
      { rotulo: "Composição", valor: an?.tipo === "OFICIAL" ? "Analítica oficial publicada" : an?.tipo === "PROPRIA" ? "Composição própria" : an?.tipo === "SICRO" ? "Composição de custo unitário publicada pelo DNIT (SICRO, sem desoneração)" : "Analítica não publicada pela fonte" },
      { rotulo: "Itens do orçamento", valor: usados.join(", ") },
    ];
    const linhas: Linha[] = [];
    if (an?.tipo === "SICRO" && an.sicro) {
      for (const l of linhasSicro(an.sicro)) {
        if ("grupo" in l) linhas.push({ celulas: [span(l.grupo, 9)], estilo: "grupo3" });
        else if ("total" in l) linhas.push({ celulas: [span(l.total, 8), l.valor], estilo: "subtotal" });
        else linhas.push({ celulas: ["SICRO", l.codigo, l.descricao, l.tipo, l.unidade, l.quantidade, null, l.preco ? { valor: l.preco, tipo: "preco" } : l.tipo === "Transporte" ? "—" : "sem preço", l.custo ? { valor: l.custo, tipo: "preco" } : l.tipo === "Transporte" ? "não incluído" : ""] });
      }
    }
    let soma = dec(0);
    for (const l of an?.linhas ?? []) {
      if (l.custo) soma = soma.plus(l.custo);
      linhas.push({ celulas: [rotuloFonte(l.fonte), l.codigo, l.descricao, NATUREZA[l.tipo] ?? l.tipo, l.unidade ?? "", l.coeficiente, l.percentual && !dec(l.percentual).isZero() ? l.percentual : null, l.precoUnitario ?? (l.situacao === "% sobre a mão de obra" ? `${formatarNumero(l.coeficiente, 2)}% s/ MO` : "sem preço"), l.custo ? moeda2(l.custo) : ""] });
    }
    const custo = dec(it.custoUnitario);
    const preco = dec(it.precoUnitario);
    if (an?.linhas?.length) {
      const semPct = an.linhas.some((l) => l.situacao === "% sobre a mão de obra");
      linhas.push({ celulas: [span(semPct ? "Soma dos componentes (sem o percentual sobre a mão de obra)" : "Soma dos componentes", 8), moeda2(soma)], estilo: "subtotal" });
    }
    linhas.push(
      { celulas: [span(`Custo unitário adotado (${referenciaDoItem(it)})`, 8), moeda2(custo)], estilo: "subtotal" },
      { celulas: [span(`BDI (${fmtPct(it.bdiPercentual)})`, 8), moeda2(preco.minus(arredondar(custo, 2, e.revisao.arredondamento)))], estilo: "subtotal" },
      { celulas: [span("PREÇO UNITÁRIO COM BDI", 8), it.precoUnitario], estilo: "total" },
    );
    secoes.push({
      titulo: `CPU — ${it.codigo}`, campos,
      paragrafos: an?.linhas?.length ? undefined : an?.tipo === "SICRO"
        ? ["Quantidades: equipamentos e mão de obra por hora da equipe (o custo horário total ÷ produção da equipe dá o custo unitário de execução); materiais, atividades auxiliares e tempo fixo por unidade do serviço. Valores como publicados pelo DNIT; o custo unitário adotado é o custo publicado."]
        : ["A fonte não publicou composição analítica deste serviço nesta base: o custo adotado é o preço de referência publicado (não é recalculado)."],
      tabela: {
        colunas: [
          { titulo: "Fonte", tipo: "texto", largura: 6 }, { titulo: "Código", tipo: "codigo", largura: 9 }, { titulo: "Descrição", tipo: "texto", largura: 42 },
          { titulo: "Tipo", tipo: "texto", largura: 9 }, { titulo: "Unid.", tipo: "texto", largura: 5 }, { titulo: "Coeficiente", tipo: "coeficiente", largura: 9 },
          { titulo: "% adic.", tipo: "percentual", largura: 6 }, { titulo: "Preço unit. (R$)", tipo: "preco", largura: 9 }, { titulo: "Custo (R$)", tipo: "moeda", largura: 9 },
        ],
        linhas,
      },
    });
  }
  if (!secoes.length) secoes.push({ paragrafos: ["O orçamento não tem serviços com composição (somente insumos)."] });
  return documento(c, "cpu", "paisagem", secoes);
}

// ---------------------------------------------------------------------------
// 4. ABC de serviços  /  5. ABC de insumos
// ---------------------------------------------------------------------------

const COLS_ABC = (rotuloValor: string, preco: Coluna["tipo"] = "moeda"): Coluna[] => [
  { titulo: "Ordem", tipo: "inteiro", largura: 4 }, { titulo: "Fonte", tipo: "texto", largura: 6 }, { titulo: "Código", tipo: "codigo", largura: 9 },
  { titulo: "Descrição", tipo: "texto", largura: 38 }, { titulo: "Unid.", tipo: "texto", largura: 5 }, { titulo: "Quantidade", tipo: "quantidade", largura: 9 },
  { titulo: "Preço unit. (R$)", tipo: preco, largura: 9 }, { titulo: rotuloValor, tipo: "moeda", largura: 10 }, { titulo: "%", tipo: "percentual", largura: 6 },
  { titulo: "% acum.", tipo: "percentual", largura: 6 }, { titulo: "Classe", tipo: "texto", largura: 4 },
];

function resumoClasses(curva: { classe: string; valor: Dec; percentual: Dec }[]): Secao {
  const linhas: Linha[] = (["A", "B", "C"] as const).map((cl) => {
    const x = curva.filter((i) => i.classe === cl);
    return { celulas: [cl, String(x.length), moeda2(x.reduce((a, i) => a.plus(i.valor), dec(0))), x.reduce((a, i) => a.plus(i.percentual), dec(0)).toFixed(2)] };
  });
  return {
    titulo: "Resumo por classe (A até 80%, B até 95%, C o restante)",
    tabela: { colunas: [{ titulo: "Classe", tipo: "texto", largura: 6 }, { titulo: "Itens", tipo: "inteiro", largura: 6 }, { titulo: "Valor (R$)", tipo: "moeda", largura: 12 }, { titulo: "%", tipo: "percentual", largura: 8 }], linhas },
  };
}

function abcServicos(c: Contexto): Documento {
  const grupos = new Map<string, { it: LinhaItem; quantidade: Dec; total: Dec; precos: Set<string>; itens: string[] }>();
  for (const it of c.estado.itens) {
    const k = `${it.fonte}|${it.codigo}|${it.unidade}`;
    const g = grupos.get(k) ?? { it, quantidade: dec(0), total: dec(0), precos: new Set<string>(), itens: [] };
    g.quantidade = g.quantidade.plus(it.quantidade);
    g.total = g.total.plus(it.precoTotal);
    g.precos.add(dec(it.precoUnitario).toFixed(2));
    g.itens.push(it.numero);
    grupos.set(k, g);
  }
  const curva = curvaAbc([...grupos.values()].map((g) => ({ chave: g, valor: g.total })));
  const linhas: Linha[] = curva.map((l, i) => ({
    celulas: [String(i + 1), rotuloFonte(l.chave.it.fonte), l.chave.it.codigo,
      l.chave.itens.length > 1 ? `${l.chave.it.descricao} (itens ${l.chave.itens.join(", ")})` : l.chave.it.descricao,
      l.chave.it.unidade, l.chave.quantidade.toString(), l.chave.precos.size === 1 ? [...l.chave.precos][0] : "vários",
      moeda2(l.valor), l.percentual.toDecimalPlaces(6).toString(), l.acumulado.toDecimalPlaces(6).toString(), l.classe],
    estilo: l.classe === "A" ? "destaque" : undefined,
  }));
  linhas.push({ celulas: [span("TOTAL", 7), c.estado.totais.total, "100.00", "", ""], estilo: "total" });
  return documento(c, "abc-servicos", "paisagem", [
    { tabela: { colunas: COLS_ABC("Preço total (R$)"), linhas } },
    resumoClasses(curva),
    { paragrafos: ["Valores com BDI. Um mesmo serviço (fonte, código e unidade) lançado em mais de um item é somado numa única linha."] },
  ]);
}

async function abcInsumos(c: Contexto): Promise<Documento> {
  const ctx = await contextoDaRevisao(c.ex, c.estado.revisao.id);
  const { insumos } = await explodirInsumos(c.ex, c.estado.itens, ctx);
  const comCusto = insumos.filter((i) => i.custo);
  const semPreco = insumos.filter((i) => !i.custo);
  const curva = curvaAbc(comCusto.map((i) => ({ chave: i, valor: i.custo! })));
  const linhas: Linha[] = curva.map((l, i) => ({
    celulas: [String(i + 1), rotuloFonte(l.chave.fonte), l.chave.codigo,
      `${l.chave.descricao}${l.chave.semAnalitica ? (l.chave.fonte === "SICRO" ? " [composição SICRO — não desmembrada]" : " [serviço sem analítica publicada]") : ""}`, l.chave.unidade ?? "",
      arredondar(l.chave.quantidade, 4).toString(), l.chave.precoUnitario!.toString(), moeda2(l.valor), l.percentual.toDecimalPlaces(6).toString(), l.acumulado.toDecimalPlaces(6).toString(), l.classe],
    estilo: l.classe === "A" ? "destaque" : undefined,
  }));
  const total = comCusto.reduce((a, i) => a.plus(i.custo!), dec(0));
  linhas.push({ celulas: [span("TOTAL (custo, sem BDI)", 7), moeda2(total), "100.00", "", ""], estilo: "total" });
  const secoes: Secao[] = [
    { tabela: { colunas: COLS_ABC("Custo total (R$)", "preco"), linhas } },
    resumoClasses(curva),
    {
      paragrafos: [
        "Quantidade do insumo = quantidade do serviço × coeficiente da composição (× (1 + percentual adicional), quando houver), somada em todos os serviços e em todas as composições auxiliares.",
        "Somente composições analíticas oficiais publicadas (na base e regime de cada item) ou próprias são usadas. Serviços sem analítica publicada entram inteiros, com o seu preço.",
        ...(c.estado.itens.some((i) => i.fonte === "SICRO" && i.tipo === "COMPOSICAO") ? ["Composições do SICRO entram inteiras: o DNIT publica a composição por equipe/hora (com produção, FIC e tempo fixo), que não é convertida em coeficientes por unidade."] : []),
        `Custo direto do orçamento: R$ ${formatarNumero(c.estado.totais.custoDireto, 2)}; soma dos insumos: R$ ${formatarNumero(total, 2)}. A diferença decorre dos arredondamentos dos preços unitários e das próprias composições oficiais.`,
      ],
    },
  ];
  if (semPreco.length) {
    secoes.push({
      titulo: "Insumos sem preço na base do item",
      tabela: {
        colunas: [{ titulo: "Fonte", tipo: "texto", largura: 6 }, { titulo: "Código", tipo: "codigo", largura: 9 }, { titulo: "Descrição", tipo: "texto", largura: 50 }, { titulo: "Unid.", tipo: "texto", largura: 5 }, { titulo: "Quantidade", tipo: "quantidade", largura: 10 }],
        linhas: semPreco.map((i) => ({ celulas: [i.fonte, i.codigo, `${i.descricao}${i.semAnalitica ? " [serviço sem analítica publicada]" : ""}`, i.unidade ?? "", arredondar(i.quantidade, 4).toString()] })),
      },
    });
  }
  return documento(c, "abc-insumos", "paisagem", secoes);
}

// ---------------------------------------------------------------------------
// 6. BDI
// ---------------------------------------------------------------------------

interface PerfilSnap { id: string; nome: string; descricao: string | null; percentualInformado: string | null; parcelas: ParcelaPerfil[]; bdiCalculado: string; bdiAplicado: string }

async function bdi(c: Contexto): Promise<Documento> {
  const e = c.estado;
  const [snap] = await c.ex.consulta<{ bdi: PerfilSnap[] | null }>(`SELECT bdi_snapshot AS bdi FROM orcamento_revisao WHERE id = $1`, [e.revisao.id]);
  const perfis: PerfilSnap[] = snap?.bdi ?? (c.fechada ? (await listarPerfis(c.ex)).filter((p) => p.id === e.revisao.bdiPerfilId || e.itens.some((i) => i.bdiPerfilId === p.id)) : await perfisDaRevisao(c.ex, e.revisao.id));
  const secoes: Secao[] = [];
  const usoGlobal = e.itens.filter((i) => !i.bdiPerfilId);
  secoes.push({
    titulo: "BDI aplicado no orçamento",
    campos: [
      { rotulo: "BDI global", valor: e.revisao.bdiPercentual ? `${fmtPct(e.revisao.bdiPercentual)}${e.revisao.bdiPerfilId ? ` — perfil "${perfis.find((p) => p.id === e.revisao.bdiPerfilId)?.nome ?? "?"}"` : ""}` : "sem BDI (somente custo direto)" },
      { rotulo: "Itens com BDI global", valor: usoGlobal.length ? usoGlobal.map((i) => i.numero).join(", ") : "nenhum" },
      ...perfis.filter((p) => e.itens.some((i) => i.bdiPerfilId === p.id)).map((p) => ({ rotulo: `Itens com BDI "${p.nome}"`, valor: e.itens.filter((i) => i.bdiPerfilId === p.id).map((i) => i.numero).join(", ") })),
      { rotulo: "Valor do BDI no orçamento", valor: fmtMoeda(e.totais.bdi) },
    ],
  });
  for (const p of perfis) {
    const linhas: Linha[] = p.parcelas.map((x) => ({ celulas: [x.tipo, x.nome, x.percentual] }));
    const paragrafos: string[] = [];
    if (p.parcelas.length) {
      const d = calcularBdi(p.parcelas);
      (["AC", "S", "R", "G", "DF", "L", "I"] as const).forEach((t) => linhas.push({ celulas: [t, `Soma ${t}`, d.somas[t].toString()], estilo: "subtotal" }));
      paragrafos.push("Fórmula (Acórdão TCU 2.622/2013): BDI = [(1 + AC + S + R + G) × (1 + DF) × (1 + L)] / (1 − I) − 1");
      paragrafos.push(`BDI calculado pelas parcelas: ${formatarNumero(d.bdi, 4)}%`);
    }
    if (p.percentualInformado !== null) paragrafos.push(`BDI informado no perfil (ex.: fixado em edital): ${formatarNumero(p.percentualInformado, 4)}% — prevalece sobre o calculado.`);
    paragrafos.push(`BDI aplicado aos itens (2 casas): ${fmtPct(p.bdiAplicado)}`);
    const div = e.divergenciasBdi.find((x) => x.perfilId === p.id);
    if (div) paragrafos.push(`ATENÇÃO: o perfil foi alterado depois de aplicado; os preços desta prévia ainda usam ${div.aplicado.map((x) => fmtPct(x)).join(" / ")}. Atualize o BDI no orçamento antes de fechar a revisão.`);
    secoes.push({
      titulo: `Perfil "${p.nome}"`, paragrafos: p.descricao ? [p.descricao, ...paragrafos] : paragrafos,
      tabela: p.parcelas.length ? { colunas: [{ titulo: "Tipo", tipo: "texto", largura: 6 }, { titulo: "Parcela", tipo: "texto", largura: 40 }, { titulo: "%", tipo: "percentual", largura: 10 }], linhas } : undefined,
    });
  }
  if (!perfis.length && e.revisao.bdiPercentual) secoes.push({ paragrafos: [`BDI global de ${fmtPct(e.revisao.bdiPercentual)} informado sem perfil de parcelas.`] });
  return documento(c, "bdi", "retrato", secoes, c.fechada && !snap?.bdi ? ["Revisão fechada antes do registro dos perfis de BDI no fechamento: parcelas exibidas conforme o cadastro atual."] : []);
}

// ---------------------------------------------------------------------------
// 7. Cronograma
// ---------------------------------------------------------------------------

async function cronograma(c: Contexto): Promise<Documento> {
  const e = c.estado;
  const cr = await lerCronograma(c.ex, e.revisao.id);
  const principais = e.etapas.filter((x) => x.paiId === null).sort((a, b) => a.ordem - b.ordem);
  const meses = cr.meses ?? Math.max(0, ...cr.parcelas.map((p) => p.periodo));
  if (!meses) return documento(c, "cronograma", "paisagem", [{ paragrafos: ["Cronograma ainda não preenchido para esta revisão (botão “Cronograma” no orçamento)."] }]);
  const pct = (etapaId: string, m: number) => dec(cr.parcelas.find((p) => p.etapaId === etapaId && p.periodo === m)?.percentual ?? 0);
  // valor do mês arredondado; quando a etapa soma 100%, o último mês com parcela fecha a diferença de arredondamento
  const valorMes = (et: (typeof principais)[number], m: number): Dec => {
    const parc = Array.from({ length: meses }, (_, i) => i + 1).filter((x) => !pct(et.id, x).isZero());
    const soma = parc.reduce((a, x) => a.plus(pct(et.id, x)), dec(0));
    if (soma.eq(100) && parc.length > 1 && m === parc[parc.length - 1]) {
      return dec(et.total).minus(parc.slice(0, -1).reduce((a, x) => a.plus(arredondar(dec(et.total).times(pct(et.id, x)).div(100), 2)), dec(0)));
    }
    return arredondar(dec(et.total).times(pct(et.id, m)).div(100), 2);
  };
  const avisos: string[] = [];
  const secoes: Secao[] = [];
  const POR_TABELA = 6;
  for (let ini = 1; ini <= meses; ini += POR_TABELA) {
    const ms = Array.from({ length: Math.min(POR_TABELA, meses - ini + 1) }, (_, i) => ini + i);
    const ultima = ms[ms.length - 1] === meses;
    const colunas: Coluna[] = [
      { titulo: "Item", tipo: "texto", largura: 4 }, { titulo: "Etapa", tipo: "texto", largura: 22 }, { titulo: "Valor (R$)", tipo: "moeda", largura: 10 },
      ...ms.map((m) => ({ titulo: `Mês ${m}`, tipo: "moeda" as const, largura: 9 })),
      ...(ultima ? [{ titulo: "Total (R$)", tipo: "moeda" as const, largura: 10 }] : []),
    ];
    const linhas: Linha[] = [];
    for (const et of principais) {
      const soma = Array.from({ length: meses }, (_, i) => pct(et.id, i + 1)).reduce((a, b) => a.plus(b), dec(0));
      linhas.push({ celulas: [et.numero, et.titulo, et.total, ...ms.map((m) => moeda2(valorMes(et, m))), ...(ultima ? [moeda2(Array.from({ length: meses }, (_, i) => valorMes(et, i + 1)).reduce((a, b) => a.plus(b), dec(0)))] : [])] });
      linhas.push({ celulas: ["", "% da etapa", "", ...ms.map((m) => ({ valor: pct(et.id, m).toString(), tipo: "percentual" as const })), ...(ultima ? [{ valor: soma.toString(), tipo: "percentual" as const }] : [])], estilo: "detalhe" });
      if (ini === 1 && !soma.eq(100)) avisos.push(`Etapa ${et.numero} "${et.titulo}": cronograma soma ${fmtPct(soma)} (deveria somar 100%).`);
    }
    let acum = dec(0);
    const totMes = Array.from({ length: meses }, (_, i) => principais.reduce((a, et) => a.plus(valorMes(et, i + 1)), dec(0)));
    const acumMes = totMes.map((v) => (acum = acum.plus(v)));
    const total = dec(e.totais.total);
    linhas.push({ celulas: [span("Total do mês", 3), ...ms.map((m) => moeda2(totMes[m - 1])), ...(ultima ? [moeda2(acum)] : [])], estilo: "subtotal" });
    linhas.push({ celulas: [span("Acumulado", 3), ...ms.map((m) => moeda2(acumMes[m - 1])), ...(ultima ? [""] : [])], estilo: "subtotal" });
    linhas.push({ celulas: [span("% acumulado do orçamento", 3), ...ms.map((m) => ({ valor: total.isZero() ? "0" : acumMes[m - 1].div(total).times(100).toFixed(2), tipo: "percentual" as const })), ...(ultima ? [""] : [])], estilo: "total" });
    secoes.push({ titulo: meses > POR_TABELA ? `Meses ${ms[0]} a ${ms[ms.length - 1]}` : undefined, tabela: { colunas, linhas } });
  }
  secoes.push({ paragrafos: ["Valor do mês = total da etapa (com BDI) × percentual previsto para o mês, arredondado a 2 casas; na etapa que soma 100%, o último mês absorve a diferença de arredondamento. Subetapas e itens acompanham a etapa principal."] });
  return documento(c, "cronograma", "paisagem", secoes, avisos);
}

// ---------------------------------------------------------------------------
// 8. Comparativo
// ---------------------------------------------------------------------------

async function comparativo(c: Contexto, outra: string | null | undefined): Promise<Documento> {
  const e = c.estado;
  if (!outra) throw new ErroRelatorio("Escolha a revisão a comparar.");
  if (outra === e.revisao.id) throw new ErroRelatorio("Escolha uma revisão diferente.");
  const outraEstado = e.revisoes.find((x) => x.id === outra);
  if (!outraEstado) throw new ErroRelatorio("A revisão a comparar deve ser do mesmo orçamento.");
  // A = revisão de número menor, B = maior
  const [a, b] = outraEstado.numero < e.revisao.numero ? [outra, e.revisao.id] : [e.revisao.id, outra];
  const cmp = await compararRevisoes(c.ex, a, b);
  const rot = (x: typeof cmp.a) => `Rev. ${x.numero}`;
  const situacao = { INCLUIDO: "Incluído", EXCLUIDO: "Excluído", ALTERADO: "Alterado", IGUAL: "Igual" } as const;
  const linhas: Linha[] = cmp.linhas.map((l) => ({
    celulas: [situacao[l.situacao], l.etapa, rotuloFonte(l.fonte), l.codigo, l.descricao, l.unidade,
      l.a?.quantidade ?? null, l.a?.precoUnitario ?? null, l.a?.precoTotal ?? null, l.b?.quantidade ?? null, l.b?.precoUnitario ?? null, l.b?.precoTotal ?? null, l.diferenca],
    estilo: l.situacao === "IGUAL" ? undefined : "destaque",
  }));
  linhas.push({ celulas: [span("TOTAL", 8), cmp.a.total, span("", 2), cmp.b.total, cmp.diferencaTotal], estilo: "total" });
  const bases = (x: typeof cmp.a) => x.bases.map((bb) => `${bb.fonte} ${competencia(bb.competencia)}${bb.numeroBase ? ` ret.${bb.numeroBase}` : ""} (${bb.regimeNome})`).join("; ");
  const variacao = dec(cmp.a.total).isZero() ? null : dec(cmp.diferencaTotal).div(cmp.a.total).times(100);
  return documento(c, "comparativo", "paisagem", [
    {
      campos: [
        { rotulo: `${rot(cmp.a)} (${cmp.a.status === "FECHADA" ? "fechada" : "em elaboração"})`, valor: `${fmtMoeda(cmp.a.total)} — ${bases(cmp.a)}` },
        { rotulo: `${rot(cmp.b)} (${cmp.b.status === "FECHADA" ? "fechada" : "em elaboração"})`, valor: `${fmtMoeda(cmp.b.total)} — ${bases(cmp.b)}` },
        { rotulo: "Diferença", valor: `${fmtMoeda(cmp.diferencaTotal)}${variacao ? ` (${variacao.isNegative() ? "" : "+"}${fmtPct(variacao)})` : ""}` },
        { rotulo: "Itens", valor: (["INCLUIDO", "EXCLUIDO", "ALTERADO", "IGUAL"] as const).map((s) => `${situacao[s].toLowerCase()}s: ${cmp.linhas.filter((l) => l.situacao === s).length}`).join(" · ") },
      ],
    },
    {
      tabela: {
        colunas: [
          { titulo: "Situação", tipo: "texto", largura: 6 }, { titulo: "Etapa", tipo: "texto", largura: 12 }, { titulo: "Fonte", tipo: "texto", largura: 5 },
          { titulo: "Código", tipo: "codigo", largura: 8 }, { titulo: "Descrição", tipo: "texto", largura: 24 }, { titulo: "Unid.", tipo: "texto", largura: 4 },
          { titulo: `Quant. ${rot(cmp.a)}`, tipo: "quantidade", largura: 7 }, { titulo: `P. unit. ${rot(cmp.a)}`, tipo: "moeda", largura: 7 }, { titulo: `Total ${rot(cmp.a)}`, tipo: "moeda", largura: 8 },
          { titulo: `Quant. ${rot(cmp.b)}`, tipo: "quantidade", largura: 7 }, { titulo: `P. unit. ${rot(cmp.b)}`, tipo: "moeda", largura: 7 }, { titulo: `Total ${rot(cmp.b)}`, tipo: "moeda", largura: 8 },
          { titulo: "Diferença (R$)", tipo: "moeda", largura: 8 },
        ],
        linhas,
      },
    },
  ]);
}

// ---------------------------------------------------------------------------
// 9. Histórico de preços
// ---------------------------------------------------------------------------

async function historico(c: Contexto): Promise<Documento> {
  const e = c.estado;
  const oficiais = e.itens.filter((i) => i.fonte !== "PROPRIA" && i.itemReferenciaId);
  const ids = [...new Set(oficiais.map((i) => i.itemReferenciaId))];
  const pontos = ids.length ? await c.ex.consulta<{ item_id: string; competencia: string; numero: number; status: string; regime: string | null; valor: string }>(
    `SELECT p.item_id, to_char(b.competencia, 'YYYY-MM') AS competencia, r.numero, r.status::text AS status, g.codigo AS regime, p.valor::text AS valor
       FROM preco p JOIN base_revisao r ON r.id = p.base_revisao_id JOIN base_mensal b ON b.id = r.base_id LEFT JOIN regime g ON g.id = p.regime_id
      WHERE p.item_id = ANY($1::uuid[]) AND r.status IN ('PUBLICADA', 'SUBSTITUIDA')`,
    [ids],
  ) : [];
  // linhas: um item de referência por regime usado
  const chaves = new Map<string, LinhaItem>();
  for (const it of oficiais) chaves.set(`${it.itemReferenciaId}|${it.regime ?? ""}`, chaves.get(`${it.itemReferenciaId}|${it.regime ?? ""}`) ?? it);
  const comps = [...new Set(pontos.map((p) => p.competencia))].sort().slice(-12);
  const valor = (it: LinhaItem, comp: string) => {
    const cand = pontos.filter((p) => p.item_id === it.itemReferenciaId && p.competencia === comp && (p.regime === it.regime || p.regime === null));
    // preço do regime tem prioridade sobre preço único; base publicada (vigente) sobre substituída
    cand.sort((x, y) => Number(y.regime !== null) - Number(x.regime !== null) || Number(y.status === "PUBLICADA") - Number(x.status === "PUBLICADA") || y.numero - x.numero);
    return cand[0]?.valor ?? null;
  };
  const linhas: Linha[] = [...chaves.values()].sort((a, b) => a.fonte.localeCompare(b.fonte) || a.codigo.localeCompare(b.codigo)).map((it) => {
    const vals = comps.map((cp) => valor(it, cp));
    const presentes = vals.filter((v): v is string => v !== null);
    const variacao = presentes.length >= 2 && !dec(presentes[0]).isZero() ? dec(presentes[presentes.length - 1]).div(presentes[0]).minus(1).times(100).toFixed(2) : null;
    const regimeNome = e.basesPadrao.find((b) => b.fonte === it.fonte && b.regime === it.regime)?.regimeNome ?? it.regime ?? "preço único";
    return { celulas: [it.fonte, it.codigo, it.descricao, it.unidade, regimeNome, ...vals, variacao] };
  });
  const colunas: Coluna[] = [
    { titulo: "Fonte", tipo: "texto", largura: 5 }, { titulo: "Código", tipo: "codigo", largura: 8 }, { titulo: "Descrição", tipo: "texto", largura: 30 },
    { titulo: "Unid.", tipo: "texto", largura: 4 }, { titulo: "Regime", tipo: "texto", largura: 10 },
    ...comps.map((cp) => ({ titulo: competencia(cp), tipo: "preco" as const, largura: 7 })),
    { titulo: "Variação", tipo: "percentual", largura: 6 },
  ];
  const secoes: Secao[] = [{ tabela: { colunas, linhas } }, {
    paragrafos: [
      `Preços de referência publicados (sem BDI), RJ, no regime de cada item; últimas ${comps.length} competência(s) disponíveis no sistema. Em competência com retificação, vale a base vigente (publicada).`,
      "Variação: da primeira à última competência com preço. Itens próprios (cotações e composições próprias) não entram neste relatório.",
    ],
  }];
  return documento(c, "historico", "paisagem", secoes, comps.length < 2 ? ["Há apenas uma competência publicada no sistema: o histórico mostra um único preço por item."] : []);
}

// ---------------------------------------------------------------------------
// 10. Memória de cálculo
// ---------------------------------------------------------------------------

function memoria(c: Contexto): Documento {
  const e = c.estado;
  const linhas: Linha[] = [];
  for (const { etapa, nivel } of etapasEmOrdem(e)) {
    linhas.push({ celulas: [etapa.numero, span(etapa.titulo, 5)], estilo: estiloEtapa(nivel) });
    for (const it of itensDaEtapa(e, etapa.id)) {
      let mq = it.memoriaQuantitativo ?? "—";
      if (it.memoriaQuantitativo) {
        try {
          const r = avaliarMemoria(it.memoriaQuantitativo);
          if (r) mq += ` — resultado: ${formatarNumero(r.valor.toDecimalPlaces(4), Math.min(Math.max(r.valor.toDecimalPlaces(4).decimalPlaces(), 2), 4))}${r.valor.toDecimalPlaces(4).eq(it.quantidade) ? "" : " (difere da quantidade lançada)"}`;
        } catch { /* texto sem conta */ }
      }
      linhas.push({ celulas: [it.numero, `${rotuloFonte(it.fonte)} ${it.codigo}`, `${it.descricao} (${it.unidade || "s/ unid."})`, it.quantidade, mq, it.memoriaCalculo ?? ""] });
    }
  }
  return documento(c, "memoria", "paisagem", [{
    tabela: {
      colunas: [
        { titulo: "Item", tipo: "texto", largura: 4 }, { titulo: "Código", tipo: "codigo", largura: 9 }, { titulo: "Descrição", tipo: "texto", largura: 24 },
        { titulo: "Quant.", tipo: "quantidade", largura: 7 }, { titulo: "Memória do quantitativo", tipo: "texto", largura: 26 }, { titulo: "Cálculo do preço", tipo: "texto", largura: 30 },
      ],
      linhas,
    },
  }]);
}

// ---------------------------------------------------------------------------

export async function montarRelatorio(ex: Executor, revisaoId: string, tipo: TipoRelatorio, o: OpcoesRelatorio): Promise<Documento> {
  const c = await contexto(ex, revisaoId, o, tipo);
  switch (tipo) {
    case "sintetico": return orcamento(c, false);
    case "analitico": return orcamento(c, true);
    case "cpu": return cpu(c);
    case "abc-servicos": return abcServicos(c);
    case "abc-insumos": return abcInsumos(c);
    case "bdi": return bdi(c);
    case "cronograma": return cronograma(c);
    case "comparativo": return comparativo(c, o.outraRevisaoId);
    case "historico": return historico(c);
    case "memoria": return memoria(c);
  }
}
