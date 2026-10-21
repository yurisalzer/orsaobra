/**
 * Memorial descritivo da revisão fechada (modelo: OBJETO, JUSTIFICATIVA,
 * CONSIDERAÇÕES GERAIS, ESCOPO DOS SERVIÇOS por etapa, RELEVÂNCIA TÉCNICA,
 * SUBCONTRATAÇÕES e RECURSOS).
 *
 * O sistema sugere o texto a partir da planilha (itens, etapas, bases, valores
 * e cronograma) e de textos técnicos por tipo de serviço; o usuário revisa e
 * edita cada seção, e o documento (DOCX ou PDF) é gerado no navegador.
 * Nenhum valor é inventado: quantidades, preços e percentuais vêm da revisão.
 */
import type { Executor } from "@/lib/banco/executor";
import { dec, formatarNumero, type Dec } from "@/lib/calculo/decimal";
import { comandoAuditoria } from "@/lib/auditoria";
import { carregarRevisao, ErroOrcamento, lerCronograma, type EstadoRevisao, type LinhaItem } from "@/lib/orcamento/servico";
import { cabecalhoDaRevisao, type CabecalhoDocumento } from "./cabecalhos";
import { CATEGORIAS, CATEGORIA_GERAL, categoriaDoItem, NR, porExtenso, type CategoriaMemorial } from "./memorial-textos";
import { obraDaRevisao, type ObraDados } from "./montar";

export class ErroMemorial extends Error {}

export interface SecaoMemorial {
  id: string;
  /** 1 = seção principal ("1) OBJETO"); 2 = subseção ("1.1) JUSTIFICATIVA", "1- ETAPA"); 3 = subitem do escopo ("2.1 – ...") */
  nivel: 1 | 2 | 3;
  titulo: string;
  /** parágrafos separados por quebra de linha */
  texto: string;
  /** parágrafo em negrito e maiúsculas (texto do objeto) */
  destaque?: boolean;
}

export interface ConteudoMemorial {
  /** data por extenso no cabeçalho (ex.: "14 de outubro de 2026") */
  data: string;
  /** linha de identificação abaixo do título ("OBRA: 0001 — ...") */
  obra: string;
  secoes: SecaoMemorial[];
}

export interface MemorialParaGerar extends ConteudoMemorial {
  cabecalho: CabecalhoDocumento | null;
  nomeArquivo: string;
}

export const LIMITES_MEMORIAL = { secoes: 300, titulo: 300, texto: 20000, data: 60, obra: 400 };

const fmtMoeda = (v: Dec | string) => `R$ ${formatarNumero(v, 2)}`;
const fmtPct = (v: Dec) => `${formatarNumero(v, 2)}%`;
const competencia = (c: string) => c.split("-").reverse().join("/");
const dataBr = (iso: string) => iso.split("-").reverse().join("/");

export function dataPorExtenso(d: Date): string {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "numeric", month: "long", year: "numeric" }).format(d);
}

function lista(xs: string[]): string {
  if (xs.length <= 1) return xs.join("");
  return `${xs.slice(0, -1).join(", ")} e ${xs[xs.length - 1]}`;
}

/** "a; b; e c" — para itens que já contêm vírgulas */
function listaLonga(xs: string[]): string {
  if (xs.length <= 1) return xs.join("");
  return `${xs.slice(0, -1).join("; ")}; e ${xs[xs.length - 1]}`;
}

function arquivo(s: string) {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/[^\w.-]+/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "").slice(0, 80);
}

/** Primeira letra maiúscula, demais minúsculas (descrições das bases vêm em caixa alta). */
function frase(s: string) {
  const t = s.trim().toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Título curto do subitem: a descrição até a primeira vírgula/ponto (até 90 caracteres). */
function tituloCurto(descricao: string) {
  const corte = descricao.split(/[,.;]\s/)[0].trim();
  return frase(corte.length > 90 ? `${corte.slice(0, 87).trimEnd()}…` : corte);
}

/** Itens da etapa e das subetapas, na ordem da planilha. */
function itensEmOrdem(e: EstadoRevisao, etapaId: string): LinhaItem[] {
  const proprios = e.itens.filter((i) => i.etapaId === etapaId).sort((a, b) => a.ordem - b.ordem);
  const filhas = e.etapas.filter((x) => x.paiId === etapaId).sort((a, b) => a.ordem - b.ordem);
  return [...proprios, ...filhas.flatMap((f) => itensEmOrdem(e, f.id))];
}

function faixaItens(itens: LinhaItem[]): string {
  if (itens.length === 1) return `do item ${itens[0].numero}`;
  if (itens.length === 2) return `dos itens ${itens[0].numero} e ${itens[1].numero}`;
  return `dos itens ${itens[0].numero} a ${itens[itens.length - 1].numero}`;
}

function rotuloItens(itens: LinhaItem[]): string {
  return itens.length === 1 ? `Item ${itens[0].numero}` : `Itens ${lista(itens.map((i) => i.numero))}`;
}

const fonteItem = (i: LinhaItem) => (i.fonte === "PROPRIA" ? "composição própria" : i.fonte === "INFORMADO" ? "preço informado" : `${i.fonte} ${i.codigo}`);

// ---------------------------------------------------------------------------
// Situação: só revisão fechada e com cronograma completo
// ---------------------------------------------------------------------------

export async function situacaoMemorial(ex: Executor, estado: EstadoRevisao): Promise<{ pronto: boolean; pendencias: string[]; meses: number | null }> {
  const pendencias: string[] = [];
  if (estado.revisao.status !== "FECHADA") pendencias.push("A revisão precisa estar concluída e bloqueada (botão “Fechar revisão” no orçamento).");
  if (!estado.itens.length) pendencias.push("O orçamento não tem itens.");
  const cr = await lerCronograma(ex, estado.revisao.id);
  const meses = cr.meses ?? (cr.parcelas.length ? Math.max(...cr.parcelas.map((p) => p.periodo)) : null);
  if (!meses) pendencias.push("O cronograma físico-financeiro não foi preenchido.");
  else {
    for (const et of estado.etapas.filter((x) => x.paiId === null).sort((a, b) => a.ordem - b.ordem)) {
      if (dec(et.total).isZero()) continue;
      const soma = cr.parcelas.filter((p) => p.etapaId === et.id).reduce((a, p) => a.plus(p.percentual), dec(0));
      if (!soma.eq(100)) pendencias.push(`Cronograma: a etapa ${et.numero} “${et.titulo}” soma ${fmtPct(soma)} (deve somar 100%).`);
    }
  }
  return { pronto: pendencias.length === 0, pendencias, meses };
}

// ---------------------------------------------------------------------------
// Texto sugerido
// ---------------------------------------------------------------------------

function regimeDaPlanilha(e: EstadoRevisao): string | null {
  const regimes = new Set(e.itens.map((i) => i.regime).filter((r): r is string => !!r));
  if (regimes.size !== 1) return null;
  const r = [...regimes][0];
  return r === "COM_DESONERACAO" ? "Desonerada" : r === "SEM_DESONERACAO" ? "Não Desonerada" : null;
}

function objeto(e: EstadoRevisao, obra: ObraDados): string {
  if (obra.descricao?.trim()) return obra.descricao.trim().toUpperCase();
  const local = [obra.municipio, obra.uf].filter(Boolean).join("/");
  return `CONTRATAÇÃO DE EMPRESA ESPECIALIZADA PARA EXECUÇÃO DOS SERVIÇOS DE ${e.orcamento.titulo.toUpperCase()} — ${obra.nome.toUpperCase()}${local ? `, NO MUNICÍPIO DE ${local.toUpperCase()}` : ""}, COM FORNECIMENTO DE MÃO DE OBRA, MATERIAIS E EQUIPAMENTOS NECESSÁRIOS, CONFORME PLANILHA ORÇAMENTÁRIA E CRONOGRAMA FÍSICO-FINANCEIRO.`;
}

/** Monta a sugestão de memorial a partir da revisão (sem gravar). */
export async function sugerirMemorial(ex: Executor, revisaoId: string, agora = new Date()): Promise<ConteudoMemorial> {
  const e = await carregarRevisao(ex, revisaoId).catch((err) => { if (err instanceof ErroOrcamento) throw new ErroMemorial(err.message); throw err; });
  const obra = await obraDaRevisao(ex, e);
  const sit = await situacaoMemorial(ex, e);
  const total = dec(e.totais.total);
  const pct = (v: string | Dec) => (total.isZero() ? dec(0) : dec(v).div(total).times(100));
  const local = [obra.endereco, [obra.municipio, obra.uf].filter(Boolean).join("/")].filter(Boolean).join(", ");
  const regime = regimeDaPlanilha(e);
  const principais = e.etapas.filter((x) => x.paiId === null).sort((a, b) => a.ordem - b.ordem);
  const categorias = new Map<string, CategoriaMemorial>();
  for (const i of e.itens) { const c = categoriaDoItem(i.descricao); categorias.set(c.id, c); }
  const usadas = [...CATEGORIAS, CATEGORIA_GERAL].filter((c) => categorias.has(c.id));
  const normas = [...new Set(usadas.flatMap((c) => c.normas))];
  const nrs = [...new Set(["NR-1", "NR-6", "NR-18", ...usadas.flatMap((c) => c.nrs)])].sort((a, b) => Number(a.slice(3)) - Number(b.slice(3)));
  const legislacao = [...new Set(usadas.flatMap((c) => c.legislacao))];
  const bases = e.basesPadrao.map((b) => `${b.fonte} RJ ${competencia(b.competencia)}${b.regimeNome ? ` (${b.regimeNome})` : ""}`);
  const temResiduos = usadas.some((c) => c.legislacao.some((l) => l.includes("CONAMA")));
  const secoes: SecaoMemorial[] = [];
  const add = (nivel: SecaoMemorial["nivel"], titulo: string, paragrafos: string[], destaque = false) =>
    secoes.push({ id: `s${secoes.length + 1}`, nivel, titulo, texto: paragrafos.join("\n"), ...(destaque ? { destaque } : {}) });

  // 1) OBJETO
  add(1, "1) OBJETO", [objeto(e, obra)], true);
  add(2, "1.1) JUSTIFICATIVA", [
    `A presente contratação destina-se ao atendimento da necessidade da Administração descrita no objeto, relativa à obra “${obra.nome}”${local ? `, localizada em ${local}` : ""}${obra.processo ? `, objeto do processo administrativo nº ${obra.processo}` : ""}${obra.orgaoSolicitante ? `, por solicitação do(a) ${obra.orgaoSolicitante}` : ""}. Os quantitativos foram estabelecidos a partir dos levantamentos e das memórias de cálculo da planilha orçamentária, e os serviços serão executados conforme as etapas e os prazos do cronograma físico-financeiro.`,
    "[Complementar com a motivação específica da contratação — situação existente, problema a ser resolvido, critérios adotados para os quantitativos e resultados esperados —, em consonância com o Estudo Técnico Preliminar.]",
  ]);

  // 1.2) CONSIDERAÇÕES GERAIS
  const consideracoes = [
    `O presente memorial estabelece as diretrizes técnicas para a execução dos serviços previstos na Planilha Orçamentária${regime ? ` ${regime}` : ""} — ${e.orcamento.titulo}, no valor global de ${fmtMoeda(e.totais.total)}, referenciada ${bases.length > 1 ? "nas bases" : "na base"} ${lista(bases) || "indicada na planilha"}, com data de referência de ${dataBr(e.revisao.dataReferencia)}, e deve ser interpretado em conjunto com o Estudo Técnico Preliminar, o Termo de Referência/Projeto Básico, o cronograma físico-financeiro, as ordens de serviço e os demais documentos da contratação, nos termos da Lei nº 14.133/2021.`,
  ];
  if (sit.meses) consideracoes.push(`O prazo de execução previsto é de ${sit.meses} (${porExtenso(sit.meses)}) ${sit.meses === 1 ? "mês" : "meses"}, contado a partir da emissão da ordem de serviço, distribuído conforme o cronograma físico-financeiro.`);
  consideracoes.push(
    `Integram as exigências técnicas, no que couber, as normas da Associação Brasileira de Normas Técnicas (ABNT)${normas.length ? `, em especial ${lista(normas)}` : ""}, consideradas as edições vigentes, bem como as Normas Regulamentadoras do Ministério do Trabalho e Emprego, em especial ${lista(nrs.map((n) => NR[n as keyof typeof NR] ?? n))}${legislacao.length ? `, e a legislação pertinente, em especial ${lista(legislacao)}` : ""}.`,
    "A execução observará estritamente os itens, as unidades e as especificações da planilha orçamentária. Nenhuma alteração de serviço, de quantitativo autorizado ou de condição de execução que implique modificação contratual poderá ocorrer sem a prévia formalização, na forma do art. 124 da Lei nº 14.133/2021.",
    "A execução será acompanhada e fiscalizada por representante(s) da Administração especialmente designado(s), nos termos do art. 117 da Lei nº 14.133/2021. A Contratada manterá diário de obra atualizado e disponibilizará à fiscalização os registros, os boletins, as medições e os relatórios correspondentes; a fiscalização poderá determinar a correção de serviços executados em desconformidade, sem prejuízo da responsabilidade técnica e contratual da empresa. Os responsáveis técnicos deverão manter os registros profissionais e as anotações de responsabilidade técnica pertinentes.",
    "A Contratada cumprirá as exigências de saúde e segurança do trabalho, inclusive quanto ao gerenciamento de riscos ocupacionais, ao fornecimento e uso de equipamentos de proteção individual e coletiva, à sinalização e ao isolamento dos locais de execução e à proteção de terceiros e de bens públicos e privados.",
  );
  if (temResiduos) consideracoes.push("Os resíduos gerados serão segregados, acondicionados, transportados e destinados de forma ambientalmente adequada, em conformidade com a Resolução CONAMA nº 307/2002 e a Lei nº 12.305/2010, mediante comprovação da destinação à fiscalização.");
  consideracoes.push("O recebimento dos serviços observará o art. 140 da Lei nº 14.133/2021, sem prejuízo da responsabilidade da Contratada pela solidez e segurança dos serviços executados, na forma do art. 618 do Código Civil.");
  add(2, "1.2) CONSIDERAÇÕES GERAIS", consideracoes);

  // 2) ESCOPO DOS SERVIÇOS — uma subseção por etapa principal; dentro dela, itens seguidos do mesmo tipo agrupados
  add(1, "2) ESCOPO DOS SERVIÇOS", []);
  principais.forEach((et, k) => {
    const itens = itensEmOrdem(e, et.id);
    if (!itens.length) return;
    add(2, `${k + 1}- ${et.titulo.toUpperCase()}`, [
      `Compreende os serviços ${faixaItens(itens)} da planilha orçamentária, no valor de ${fmtMoeda(et.total)} (${fmtPct(pct(et.total))} do valor global), executados conforme as especificações a seguir. Os quantitativos serão medidos pelos serviços efetivamente executados e aceitos, nas unidades da planilha, vedada a medição em duplicidade.`,
    ]);
    const grupos: { cat: CategoriaMemorial; itens: LinhaItem[] }[] = [];
    for (const it of itens) {
      const cat = categoriaDoItem(it.descricao);
      const ult = grupos[grupos.length - 1];
      if (ult && ult.cat.id === cat.id && cat.id !== CATEGORIA_GERAL.id) ult.itens.push(it);
      else grupos.push({ cat, itens: [it] });
    }
    grupos.forEach((g, j) => {
      const titulo = g.itens.length === 1 ? tituloCurto(g.itens[0].descricao) : g.cat.nome;
      const dados = (i: LinhaItem) => `${fonteItem(i)}, ${formatarNumero(i.quantidade, 2)} ${i.unidade || "un."}`;
      const semPonto = (t: string) => t.trim().replace(/[.;]+$/, "");
      add(3, `${k + 1}.${j + 1} – ${titulo}`, [
        g.itens.length === 1
          ? `Item ${g.itens[0].numero} (${dados(g.itens[0])}): ${semPonto(g.itens[0].descricao)}.`
          : `${rotuloItens(g.itens)}: ${g.itens.map((i) => `item ${i.numero} (${dados(i)}) — ${semPonto(i.descricao)}`).join("; ")}.`,
        g.cat.texto,
      ]);
    });
  });

  // 3) RELEVÂNCIA TÉCNICA — parcelas de valor significativo (art. 67, § 1º: ≥ 4% do valor estimado)
  const ordenados = [...e.itens].sort((a, b) => dec(b.precoTotal).cmp(a.precoTotal));
  const relevantes = ordenados.filter((i) => pct(i.precoTotal).gte(4));
  const citados = (relevantes.length ? relevantes : ordenados.slice(0, 3)).slice(0, 8);
  const somaCitados = citados.reduce((a, i) => a.plus(i.precoTotal), dec(0));
  const descrCitado = (i: LinhaItem) => `o item ${i.numero} (${tituloCurto(i.descricao).replace(/…$/, "")}) corresponde a ${fmtMoeda(i.precoTotal)}, aproximadamente ${fmtPct(pct(i.precoTotal))} do valor global`;
  add(1, "3) RELEVÂNCIA TÉCNICA", [
    "Os serviços objeto deste memorial demandam equipes habilitadas, equipamentos adequados, supervisão técnica e registros confiáveis, devendo a Contratada demonstrar capacidade compatível com as características, as quantidades e os prazos da contratação.",
    citados.length
      ? `Na planilha apresentada, ${listaLonga(citados.map(descrCitado))}${citados.length > 1 ? `; em conjunto, ${fmtMoeda(somaCitados)}, aproximadamente ${fmtPct(pct(somaCitados))}` : ""}. ${relevantes.length ? `${citados.length === 1 ? "Esse item tem" : "Esses itens têm"} valor individual igual ou superior a 4% (quatro por cento) do valor total estimado.` : "Nenhum item, isoladamente, atinge 4% (quatro por cento) do valor total estimado; os maiores foram indicados apenas como referência."} Esses percentuais são indicativos de participação econômica e não substituem a motivação técnica específica para as exigências de qualificação.`
      : "A planilha não apresenta itens com valor.",
    "Nos termos do art. 67, §§ 1º e 2º, da Lei nº 14.133/2021, as exigências de atestados de capacidade técnico-profissional e técnico-operacional restringir-se-ão às parcelas de maior relevância ou valor significativo do objeto, assim consideradas as de valor individual igual ou superior a 4% (quatro por cento) do valor total estimado da contratação, admitida a exigência de quantidades mínimas de até 50% (cinquenta por cento) dessas parcelas, vedadas limitações de tempo e de locais específicos. A definição final das parcelas e dos quantitativos exigíveis caberá à Administração, de forma motivada, na fase de contratação.",
  ]);

  // 4) SUBCONTRATAÇÕES
  add(1, "4) SUBCONTRATAÇÕES", [
    "A possibilidade e os limites de subcontratação serão definidos expressamente no edital e no contrato, mediante justificativa técnica e observância do art. 122 da Lei nº 14.133/2021, vedada a subcontratação integral do objeto.",
    "Se admitida, a subcontratação de partes do serviço dependerá de autorização da Administração, nos limites estabelecidos, da comprovação da capacidade técnica da subcontratada quando exigível e da manutenção da responsabilidade integral da Contratada pela execução, segurança, registros técnicos e qualidade dos serviços, sendo vedada a subcontratação de pessoa física ou jurídica que mantenha vínculo de natureza técnica, comercial, econômica, financeira, trabalhista ou civil com dirigente do órgão ou entidade contratante ou com agente público que desempenhe função na licitação ou atue na fiscalização ou na gestão do contrato, nos termos do § 3º do referido artigo.",
  ]);

  // 5) RECURSOS
  const temAltura = nrs.includes("NR-35");
  const temEletrica = nrs.includes("NR-10");
  add(1, "5) RECURSOS", []);
  add(2, "5.1) Mão de Obra", [
    `A Contratada disponibilizará equipe compatível com os serviços autorizados, compreendendo os profissionais técnicos responsáveis e os operários e auxiliares necessários, observadas as atribuições profissionais legalmente estabelecidas. Os trabalhadores receberão treinamento compatível com as atividades, conforme a NR-18${temAltura ? ", com capacitação específica para trabalho em altura (NR-35)" : ""}${temEletrica ? " e, nos serviços em eletricidade, habilitação e autorização na forma da NR-10" : ""}.`,
    "Todos os trabalhadores utilizarão uniforme, crachá de identificação e equipamentos de proteção individual adequados aos riscos, conforme a NR-6, além dos sistemas de proteção coletiva e da sinalização preventiva necessários. São de responsabilidade da Contratada os encargos sociais e trabalhistas, o deslocamento, a alimentação, o treinamento e as condições de saúde e segurança do pessoal, na forma do contrato e da legislação aplicável.",
  ]);
  add(2, "5.2) Equipamentos", [
    "Os equipamentos, as ferramentas e os veículos empregados estarão em condições operacionais adequadas aos serviços, com manutenção em dia e dispositivos de segurança, conforme a NR-12 e a NR-18, e serão apresentados à fiscalização quando solicitado. A fiscalização poderá recusar equipamentos que comprometam a qualidade, a segurança ou o prazo dos serviços, cabendo à Contratada a sua substituição imediata.",
  ]);
  add(2, "5.3) Materiais", [
    "Os materiais empregados serão novos, de qualidade comprovada e atenderão às especificações da planilha, às normas ABNT pertinentes e, quando compulsória, à certificação do INMETRO. A fiscalização poderá solicitar amostras, catálogos, fichas técnicas e ensaios antes da aplicação, e os materiais serão armazenados de forma a preservar as suas características.",
    "A medição e o pagamento dos serviços observarão as unidades e os preços unitários constantes da planilha orçamentária e os quantitativos efetivamente executados e aceitos, sem inclusão de itens não previstos, respeitadas as condições contratuais, o cronograma físico-financeiro e as ordens de serviço.",
  ]);

  return {
    data: dataPorExtenso(agora),
    obra: `OBRA: ${obra.codigo ?? obra.nome} — ${e.orcamento.titulo.toUpperCase()}`,
    secoes,
  };
}

// ---------------------------------------------------------------------------
// Leitura e gravação
// ---------------------------------------------------------------------------

export interface MemorialCarregado {
  conteudo: ConteudoMemorial;
  sugestao: ConteudoMemorial;
  salvo: { atualizadoEm: string; atualizadoPor: string | null } | null;
  situacao: { pronto: boolean; pendencias: string[] };
  cabecalho: CabecalhoDocumento | null;
  nomeArquivo: string;
  titulo: string;
}

export async function carregarMemorial(ex: Executor, revisaoId: string, agora = new Date()): Promise<MemorialCarregado> {
  const e = await carregarRevisao(ex, revisaoId).catch((err) => { if (err instanceof ErroOrcamento) throw new ErroMemorial(err.message); throw err; });
  const [sit, sugestao, cabecalho, [salvo]] = await Promise.all([
    situacaoMemorial(ex, e),
    sugerirMemorial(ex, revisaoId, agora),
    cabecalhoDaRevisao(ex, revisaoId),
    ex.consulta<{ conteudo: ConteudoMemorial; atualizado_em: string; nome: string | null }>(
      `SELECT m.conteudo, to_char(m.atualizado_em AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') AS atualizado_em, u.nome
         FROM memorial_descritivo m LEFT JOIN usuario u ON u.id = m.atualizado_por_id WHERE m.revisao_id = $1`, [revisaoId],
    ),
  ]);
  const oc = e.orcamento;
  return {
    conteudo: salvo?.conteudo ?? sugestao,
    sugestao,
    salvo: salvo ? { atualizadoEm: salvo.atualizado_em, atualizadoPor: salvo.nome } : null,
    situacao: { pronto: sit.pronto, pendencias: sit.pendencias },
    cabecalho,
    nomeArquivo: arquivo(`Memorial_descritivo_${oc.codigo ?? ""}_${oc.titulo}_rev${e.revisao.numero}`),
    titulo: `${oc.codigo ? `${oc.codigo} — ` : ""}${oc.titulo}`,
  };
}

function validarConteudo(c: ConteudoMemorial): ConteudoMemorial {
  const L = LIMITES_MEMORIAL;
  if (!c || !Array.isArray(c.secoes)) throw new ErroMemorial("Conteúdo do memorial inválido.");
  if (c.secoes.length === 0) throw new ErroMemorial("O memorial precisa de ao menos uma seção.");
  if (c.secoes.length > L.secoes) throw new ErroMemorial(`Memorial com seções demais (máximo ${L.secoes}).`);
  const data = (c.data ?? "").trim();
  const obra = (c.obra ?? "").trim();
  if (data.length > L.data || obra.length > L.obra) throw new ErroMemorial("Data ou identificação da obra longa demais.");
  const secoes = c.secoes.map((s, i) => {
    const titulo = (s.titulo ?? "").replace(/\s+/g, " ").trim();
    const texto = (s.texto ?? "").replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").trim();
    if (!titulo) throw new ErroMemorial(`Informe o título da seção ${i + 1}.`);
    if (titulo.length > L.titulo) throw new ErroMemorial(`Título da seção ${i + 1} com mais de ${L.titulo} caracteres.`);
    if (texto.length > L.texto) throw new ErroMemorial(`Texto da seção “${titulo}” com mais de ${L.texto} caracteres.`);
    if (![1, 2, 3].includes(s.nivel)) throw new ErroMemorial("Nível de seção inválido.");
    return { id: String(s.id || `s${i + 1}`).slice(0, 20), nivel: s.nivel, titulo, texto, ...(s.destaque ? { destaque: true } : {}) };
  });
  return { data, obra, secoes };
}

/** Grava o texto editado (só com a revisão pronta para o memorial). */
export async function salvarMemorial(ex: Executor, revisaoId: string, conteudo: ConteudoMemorial, usuarioId: string) {
  const e = await carregarRevisao(ex, revisaoId).catch((err) => { if (err instanceof ErroOrcamento) throw new ErroMemorial(err.message); throw err; });
  const sit = await situacaoMemorial(ex, e);
  if (!sit.pronto) throw new ErroMemorial(sit.pendencias[0]);
  const c = validarConteudo(conteudo);
  await ex.transacao([
    {
      sql: `INSERT INTO memorial_descritivo (revisao_id, conteudo, atualizado_por_id, atualizado_em) VALUES ($1, $2::jsonb, $3, now())
            ON CONFLICT (revisao_id) DO UPDATE SET conteudo = EXCLUDED.conteudo, atualizado_por_id = EXCLUDED.atualizado_por_id, atualizado_em = now()`,
      params: [revisaoId, JSON.stringify(c), usuarioId],
    },
    comandoAuditoria({ usuarioId, acao: "MEMORIAL_SALVO", entidade: "orcamento_revisao", entidadeId: revisaoId, depois: { secoes: c.secoes.length } }),
  ]);
  return c;
}

/** Descarta o texto editado: volta à sugestão do sistema. */
export async function descartarMemorial(ex: Executor, revisaoId: string, usuarioId: string) {
  await ex.transacao([
    { sql: `DELETE FROM memorial_descritivo WHERE revisao_id = $1`, params: [revisaoId] },
    comandoAuditoria({ usuarioId, acao: "MEMORIAL_DESCARTADO", entidade: "orcamento_revisao", entidadeId: revisaoId }),
  ]);
}
