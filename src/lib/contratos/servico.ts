/**
 * Contratos (módulo de medições) — fase 1: cadastro do contrato e planilha
 * contratual.
 *
 * A planilha vem de uma revisão FECHADA do orçamento (todas as características
 * do item são copiadas; o preço unitário contratado começa igual ao orçado e
 * pode ser editado, item a item ou por desconto linear) ou da planilha da
 * proposta vencedora importada (.xls/.xlsx/.pdf), cujos preços são gravados
 * exatamente como no arquivo e não são editáveis.
 *
 * Confirmada, a planilha fica VIGENTE e travada no banco (gatilho): medições,
 * aditivos e reajustes partirão dela.
 */
import type { Comando, Executor } from "@/lib/banco/executor";
import { arredondar, dec, formatarNumero, lerNumero, type Dec, type ModoArredondamento } from "@/lib/calculo/decimal";
import { comandoAuditoria } from "@/lib/auditoria";
import { normalizarTelefone } from "@/lib/auth/cadastro";
import { carregarRevisao, ErroOrcamento } from "@/lib/orcamento/servico";

export class ErroContrato extends Error {}

const LIBERAR_VIGENTE: Comando = { sql: `SELECT set_config('contrato.liberar_vigente', 'on', true)` };
const competencia = (c: string) => c.split("-").reverse().join("/");
const LIMITE_ITENS = 5000;

export interface DadosContrato {
  numero: string;
  objeto: string;
  empresa?: string | null;
  cnpj?: string | null;
  dataAssinatura?: string | null;
  dataOs?: string | null;
  processo?: string | null;
  prazoExecucaoDias?: number | null;
  prazoVigenciaDias?: number | null;
  endereco?: string | null;
  responsavelTecnico?: string | null;
  artRrt?: string | null;
  emailContato?: string | null;
  telefoneContato?: string | null;
}

function limpar(d: DadosContrato) {
  const t = (s?: string | null) => (s ?? "").replace(/\s+/g, " ").trim() || null;
  const numero = t(d.numero);
  const objeto = (d.objeto ?? "").trim();
  if (!numero) throw new ErroContrato("Informe o número do contrato.");
  if (numero.length > 60) throw new ErroContrato("Número do contrato com mais de 60 caracteres.");
  if (objeto.length < 3) throw new ErroContrato("Informe o objeto do contrato (nome da obra).");
  if (objeto.length > 2000) throw new ErroContrato("Objeto do contrato com mais de 2.000 caracteres.");
  const cnpj = t(d.cnpj);
  if (cnpj && cnpj.replace(/\D/g, "").length !== 14) throw new ErroContrato("CNPJ deve ter 14 dígitos.");
  const data = (s?: string | null, nome = "Data") => {
    const v = t(s);
    if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new ErroContrato(`${nome} inválida.`);
    return v;
  };
  const prazo = (v: number | null | undefined, nome: string) => {
    const x = v ?? null;
    if (x !== null && (!Number.isInteger(x) || x < 1 || x > 36500)) throw new ErroContrato(`${nome} em dias inválido.`);
    return x;
  };
  const email = t(d.emailContato)?.toLowerCase() ?? null;
  if (email && (email.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) throw new ErroContrato("E-mail de contato inválido.");
  const telefone = t(d.telefoneContato) ? normalizarTelefone(t(d.telefoneContato)!) : null;
  if (telefone === null && t(d.telefoneContato)) throw new ErroContrato("Telefone de contato inválido (informe DDD e número).");
  return {
    numero, objeto, empresa: t(d.empresa)?.slice(0, 300) ?? null, cnpj: cnpj ? formatarCnpj(cnpj) : null,
    dataAssinatura: data(d.dataAssinatura, "Data de assinatura"), dataOs: data(d.dataOs, "Data da ordem de serviço"),
    prazoExecucaoDias: prazo(d.prazoExecucaoDias, "Prazo de execução"), prazoVigenciaDias: prazo(d.prazoVigenciaDias, "Prazo contratual"),
    processo: t(d.processo)?.slice(0, 100) ?? null, endereco: t(d.endereco)?.slice(0, 300) ?? null, responsavelTecnico: t(d.responsavelTecnico)?.slice(0, 200) ?? null, artRrt: t(d.artRrt)?.slice(0, 60) ?? null,
    emailContato: email, telefoneContato: telefone || null,
  };
}

export function formatarCnpj(c: string) {
  const d = c.replace(/\D/g, "");
  return d.length === 14 ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}` : c;
}

async function numeroLivre(ex: Executor, numero: string, exceto: string | null = null) {
  const [r] = await ex.consulta<{ id: string }>(`SELECT id FROM contrato WHERE lower(numero) = lower($1) AND ($2::uuid IS NULL OR id <> $2)`, [numero, exceto]);
  if (r) throw new ErroContrato(`Já existe o contrato nº ${numero}.`);
}

/** Dados complementares do contrato (empresa, datas, prazos, endereço e responsável técnico). */
function comandoDados(id: string, d: ReturnType<typeof limpar>): Comando {
  return {
    sql: `UPDATE contrato SET empresa = $2, cnpj = $3, data_assinatura = $4, data_os = $5, prazo_execucao_dias = $6, prazo_vigencia_dias = $7,
                 endereco = $8, responsavel_tecnico = $9, art_rrt = $10, email_contato = $11, telefone_contato = $12, processo = $13 WHERE id = $1`,
    params: [id, d.empresa, d.cnpj, d.dataAssinatura, d.dataOs, d.prazoExecucaoDias, d.prazoVigenciaDias, d.endereco, d.responsavelTecnico, d.artRrt, d.emailContato, d.telefoneContato, d.processo],
  };
}

const totalItem = (q: Dec | string, p: Dec | string, modo: ModoArredondamento) => arredondar(dec(q).times(p), 2, modo);

// ---------------------------------------------------------------------------
// Criação a partir do orçamento
// ---------------------------------------------------------------------------

/** Cria o contrato com a planilha da revisão fechada do orçamento (todas as características dos itens). */
export async function criarContratoDoOrcamento(ex: Executor, revisaoId: string, d: DadosContrato, usuarioId: string): Promise<string> {
  const dados = limpar(d);
  const e = await carregarRevisao(ex, revisaoId).catch((err) => { if (err instanceof ErroOrcamento) throw new ErroContrato(err.message); throw err; });
  if (e.revisao.status !== "FECHADA") throw new ErroContrato("Use uma revisão fechada do orçamento (a planilha contratual não pode mudar depois).");
  if (!e.itens.length) throw new ErroContrato("A revisão não tem itens.");
  if (e.itens.length > LIMITE_ITENS) throw new ErroContrato(`Planilha com itens demais (máximo ${LIMITE_ITENS}).`);
  await numeroLivre(ex, dados.numero);
  const id = crypto.randomUUID();
  // grupos = etapas (mesma árvore e ordem)
  const grupoDe = new Map(e.etapas.map((et) => [et.id, crypto.randomUUID()]));
  const grupos = e.etapas.map((et) => ({ id: grupoDe.get(et.id)!, paiId: et.paiId ? grupoDe.get(et.paiId)! : null, ordem: et.ordem, titulo: et.titulo }));
  // itens na ordem da planilha (etapa a etapa, como no orçamento)
  const ordemEtapa = new Map<string, number>();
  const visitar = (pai: string | null) => { for (const et of e.etapas.filter((x) => x.paiId === pai).sort((a, b) => a.ordem - b.ordem)) { ordemEtapa.set(et.id, ordemEtapa.size); visitar(et.id); } };
  visitar(null);
  const itens = [...e.itens].sort((a, b) => ordemEtapa.get(a.etapaId)! - ordemEtapa.get(b.etapaId)! || a.ordem - b.ordem).map((i, k) => ({
    id: crypto.randomUUID(), grupoId: grupoDe.get(i.etapaId)!, ordem: k + 1, numero: i.numero, codigo: i.codigo, fonte: i.fonte, descricao: i.descricao, unidade: i.unidade || null,
    quantidade: i.quantidade, precoUnitario: i.precoUnitario, valorTotal: i.precoTotal, itemOrcamentoId: i.id, itemReferenciaId: i.itemReferenciaId,
    precoOrcado: i.precoUnitario, custoUnitario: i.custoUnitario, bdiPercentual: i.bdiPercentual, baseRotulo: i.baseRotulo, regime: i.regime,
    referenciaPreco: i.referenciaPreco, memoriaQuantitativo: i.memoriaQuantitativo, memoriaCalculo: i.memoriaCalculo,
  }));
  const referencia = e.basesPadrao.map((b) => `${b.fonte} RJ ${competencia(b.competencia)}${b.regimeNome ? ` — ${b.regimeNome}` : ""}`).join("; ") || null;
  await ex.transacao([
    {
      sql: `INSERT INTO contrato (id, obra_id, numero, objeto, origem, revisao_id, referencia, bdi_percentual, arredondamento, criado_por_id)
            VALUES ($1, $2, $3, $4, 'ORCAMENTO', $5, $6, $7, $8, $9)`,
      params: [id, e.orcamento.obraId, dados.numero, dados.objeto, revisaoId, referencia, e.revisao.bdiPercentual, e.revisao.arredondamento, usuarioId],
    },
    comandoDados(id, dados),
    ...comandosPlanilha(id, grupos, itens),
    comandoAuditoria({ usuarioId, acao: "CONTRATO_CRIADO", entidade: "contrato", entidadeId: id, depois: { numero: dados.numero, origem: "ORCAMENTO", revisaoId, itens: itens.length, total: e.totais.total } }),
  ]);
  return id;
}

interface GrupoNovo { id: string; paiId: string | null; ordem: number; titulo: string }
interface ItemNovo {
  id: string; grupoId: string; ordem: number; numero: string | null; codigo: string | null; fonte: string | null; descricao: string; unidade: string | null;
  quantidade: string; precoUnitario: string; valorTotal: string; valorTotalArquivo?: string | null;
  itemOrcamentoId?: string | null; itemReferenciaId?: string | null; precoOrcado?: string | null; custoUnitario?: string | null; bdiPercentual?: string | null;
  baseRotulo?: string | null; regime?: string | null; referenciaPreco?: string | null; memoriaQuantitativo?: string | null; memoriaCalculo?: string | null;
}

function comandosPlanilha(contratoId: string, grupos: GrupoNovo[], itens: ItemNovo[]): Comando[] {
  // grupos pais antes dos filhos
  const ordenados: GrupoNovo[] = [];
  const add = (pai: string | null) => { for (const g of grupos.filter((x) => x.paiId === pai)) { ordenados.push(g); add(g.id); } };
  add(null);
  const cmds: Comando[] = [{
    sql: `INSERT INTO contrato_grupo (id, contrato_id, pai_id, ordem, titulo)
          SELECT x.id, $1, x."paiId", x.ordem, x.titulo FROM jsonb_to_recordset($2::jsonb) AS x(id uuid, "paiId" uuid, ordem int, titulo text, n int) ORDER BY x.n`,
    params: [contratoId, JSON.stringify(ordenados.map((g, n) => ({ ...g, n })))],
  }];
  for (let i = 0; i < itens.length; i += 500) {
    cmds.push({
      sql: `INSERT INTO contrato_item (id, contrato_id, grupo_id, ordem, numero, codigo, fonte, descricao, unidade, quantidade, preco_unitario, valor_total, valor_total_arquivo,
                                       item_orcamento_id, item_referencia_id, preco_orcado, custo_unitario, bdi_percentual, base_rotulo, regime, referencia_preco, memoria_quantitativo, memoria_calculo)
            SELECT x.id, $1, x."grupoId", x.ordem, x.numero, x.codigo, x.fonte, x.descricao, x.unidade, x.quantidade::numeric, x."precoUnitario"::numeric, x."valorTotal"::numeric, x."valorTotalArquivo"::numeric,
                   x."itemOrcamentoId", x."itemReferenciaId", x."precoOrcado"::numeric, x."custoUnitario"::numeric, x."bdiPercentual"::numeric, x."baseRotulo", x.regime, x."referenciaPreco", x."memoriaQuantitativo", x."memoriaCalculo"
              FROM jsonb_to_recordset($2::jsonb) AS x(id uuid, "grupoId" uuid, ordem int, numero text, codigo text, fonte text, descricao text, unidade text, quantidade text, "precoUnitario" text, "valorTotal" text,
                   "valorTotalArquivo" text, "itemOrcamentoId" uuid, "itemReferenciaId" uuid, "precoOrcado" text, "custoUnitario" text, "bdiPercentual" text, "baseRotulo" text, regime text, "referenciaPreco" text,
                   "memoriaQuantitativo" text, "memoriaCalculo" text)`,
      params: [contratoId, JSON.stringify(itens.slice(i, i + 500))],
    });
  }
  return cmds;
}

// ---------------------------------------------------------------------------
// Criação a partir da planilha importada (proposta vencedora)
// ---------------------------------------------------------------------------

export interface PlanilhaImportada {
  arquivo: string;
  grupos: { chave: string; titulo: string; paiChave: string | null }[];
  itens: { grupoChave: string; numero: string | null; codigo: string | null; fonte: string | null; descricao: string; unidade: string | null; quantidade: string; precoUnitario: string; total: string | null }[];
}

/** Número do arquivo (ponto decimal, como lido) com no máximo `casas` casas — nunca arredonda: o preço tem de ser idêntico ao da proposta. */
function numeroExato(v: string, casas: number, rotulo: string, linha: number): string {
  const n = lerNumero(v);
  if (!n || n.isNegative()) throw new ErroContrato(`${rotulo} inválido no item ${linha}.`);
  if (n.decimalPlaces() > casas) throw new ErroContrato(`${rotulo} do item ${linha} tem mais de ${casas} casas decimais (${v}); o sistema guarda até ${casas}.`);
  return n.toString();
}

export async function criarContratoDaPlanilha(
  ex: Executor, d: DadosContrato & { obraId: string; arredondamento?: ModoArredondamento }, p: PlanilhaImportada, usuarioId: string,
): Promise<string> {
  const dados = limpar(d);
  if (!p.itens.length) throw new ErroContrato("A planilha não tem itens.");
  if (p.itens.length > LIMITE_ITENS) throw new ErroContrato(`Planilha com itens demais (máximo ${LIMITE_ITENS}).`);
  const [obra] = await ex.consulta<{ id: string }>(`SELECT id FROM obra WHERE id = $1`, [d.obraId]);
  if (!obra) throw new ErroContrato("Obra não encontrada.");
  await numeroLivre(ex, dados.numero);
  const modo: ModoArredondamento = d.arredondamento === "TRUNCAR" ? "TRUNCAR" : "ARREDONDAR";
  const id = crypto.randomUUID();
  const ids = new Map(p.grupos.map((g) => [g.chave, crypto.randomUUID()]));
  const grupos: GrupoNovo[] = p.grupos.map((g, k) => {
    if (g.paiChave && !ids.has(g.paiChave)) throw new ErroContrato("Estrutura de grupos inválida.");
    return { id: ids.get(g.chave)!, paiId: g.paiChave ? ids.get(g.paiChave)! : null, ordem: k + 1, titulo: g.titulo.trim().slice(0, 400) || "Grupo" };
  });
  const itens: ItemNovo[] = p.itens.map((it, k) => {
    const grupoId = ids.get(it.grupoChave);
    if (!grupoId) throw new ErroContrato(`Grupo inválido no item ${k + 1}.`);
    const descricao = it.descricao.trim();
    if (!descricao) throw new ErroContrato(`Item ${k + 1} sem descrição.`);
    const quantidade = numeroExato(it.quantidade, 4, "Quantidade", k + 1);
    const preco = numeroExato(it.precoUnitario, 4, "Preço unitário", k + 1);
    const total = it.total ? numeroExato(it.total, 2, "Valor total", k + 1) : null;
    return {
      id: crypto.randomUUID(), grupoId, ordem: k + 1, numero: it.numero?.trim().slice(0, 30) || null, codigo: it.codigo?.trim().slice(0, 60) || null, fonte: it.fonte?.trim().slice(0, 30) || null,
      descricao: descricao.slice(0, 4000), unidade: it.unidade?.trim().slice(0, 20) || null, quantidade, precoUnitario: preco,
      // valor do item: o da proposta, quando o arquivo traz a coluna; senão quantidade × preço
      valorTotal: total ?? totalItem(quantidade, preco, modo).toString(), valorTotalArquivo: total,
    };
  });
  const total = itens.reduce((a, i) => a.plus(i.valorTotal), dec(0));
  await ex.transacao([
    {
      sql: `INSERT INTO contrato (id, obra_id, numero, objeto, origem, arquivo_origem, arredondamento, criado_por_id)
            VALUES ($1, $2, $3, $4, 'PLANILHA', $5, $6, $7)`,
      params: [id, d.obraId, dados.numero, dados.objeto, p.arquivo.slice(0, 200), modo, usuarioId],
    },
    comandoDados(id, dados),
    ...comandosPlanilha(id, grupos, itens),
    comandoAuditoria({ usuarioId, acao: "CONTRATO_CRIADO", entidade: "contrato", entidadeId: id, depois: { numero: dados.numero, origem: "PLANILHA", arquivo: p.arquivo, itens: itens.length, total: total.toFixed(2) } }),
  ]);
  return id;
}

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

export interface ContratoResumo {
  id: string; numero: string; objeto: string; empresa: string | null; obraId: string; obraNome: string; obraCodigo: string | null;
  origem: "ORCAMENTO" | "PLANILHA"; situacao: "EM_CADASTRO" | "VIGENTE"; itens: number; total: string; criadoPorId: string | null; criadoPor: string | null; atualizado: string;
}

export async function listarContratos(ex: Executor, busca = ""): Promise<ContratoResumo[]> {
  const termo = busca.trim();
  return ex.consulta<ContratoResumo>(
    `SELECT c.id, c.numero, c.objeto, c.empresa, o.id AS "obraId", o.nome AS "obraNome", o.codigo AS "obraCodigo", c.origem, c.situacao,
            (SELECT count(*)::int FROM contrato_item i WHERE i.contrato_id = c.id) AS itens,
            coalesce((SELECT sum(i.valor_total) FROM contrato_item i WHERE i.contrato_id = c.id), 0)::text AS total,
            c.criado_por_id AS "criadoPorId", u.nome AS "criadoPor",
            to_char(c.atualizado_em AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') AS atualizado
       FROM contrato c JOIN obra o ON o.id = c.obra_id LEFT JOIN usuario u ON u.id = c.criado_por_id
      WHERE ($1 = '' OR lower(f_unaccent(concat_ws(' ', c.numero, c.objeto, c.empresa, c.processo, o.nome, o.codigo, o.processo))) LIKE '%' || lower(f_unaccent($1)) || '%')
      ORDER BY c.criado_em DESC`,
    [termo],
  );
}

export interface GrupoContrato { id: string; paiId: string | null; ordem: number; titulo: string; numero: string; nivel: number; total: string }
export interface ItemContrato {
  id: string; grupoId: string; ordem: number; numero: string | null; codigo: string | null; fonte: string | null; descricao: string; unidade: string | null;
  quantidade: string; precoUnitario: string; valorTotal: string; valorTotalArquivo: string | null; precoOrcado: string | null; custoUnitario: string | null;
  bdiPercentual: string | null; baseRotulo: string | null; regime: string | null; referenciaPreco: string | null; memoriaQuantitativo: string | null;
  memoriaCalculo: string | null; itemReferenciaId: string | null;
}
export interface EstadoContrato {
  contrato: {
    id: string; numero: string; objeto: string; empresa: string | null; cnpj: string | null; dataAssinatura: string | null; dataOs: string | null;
    prazoExecucaoDias: number | null; prazoVigenciaDias: number | null; endereco: string | null; responsavelTecnico: string | null; artRrt: string | null;
    emailContato: string | null; telefoneContato: string | null;
    origem: "ORCAMENTO" | "PLANILHA"; revisaoId: string | null; orcamento: string | null; arquivoOrigem: string | null; referencia: string | null; bdiPercentual: string | null;
    arredondamento: ModoArredondamento; situacao: "EM_CADASTRO" | "VIGENTE"; versao: number; criadoPorId: string | null; criadoPor: string | null; criadoEm: string;
    confirmadoEm: string | null; confirmadoPor: string | null; obraId: string; obraNome: string; obraCodigo: string | null; processo: string | null;
  };
  grupos: GrupoContrato[];
  itens: ItemContrato[];
  totais: { contratado: string; orcado: string | null; desconto: string | null; itens: number; divergentesArquivo: number };
}

export async function carregarContrato(ex: Executor, contratoId: string): Promise<EstadoContrato> {
  const [c] = await ex.consulta<EstadoContrato["contrato"]>(
    `SELECT c.id, c.numero, c.objeto, c.empresa, c.cnpj, c.data_assinatura::text AS "dataAssinatura", c.data_os::text AS "dataOs", c.prazo_execucao_dias AS "prazoExecucaoDias", c.prazo_vigencia_dias AS "prazoVigenciaDias", c.endereco,
            c.responsavel_tecnico AS "responsavelTecnico", c.art_rrt AS "artRrt", c.email_contato AS "emailContato", c.telefone_contato AS "telefoneContato",
            c.origem, c.revisao_id AS "revisaoId",
            (SELECT concat_ws(' — ', oc.codigo, oc.titulo) || ' (revisão ' || r.numero || ')' FROM orcamento_revisao r JOIN orcamento oc ON oc.id = r.orcamento_id WHERE r.id = c.revisao_id) AS orcamento,
            c.arquivo_origem AS "arquivoOrigem", c.referencia, c.bdi_percentual::text AS "bdiPercentual", c.arredondamento, c.situacao, c.versao,
            c.criado_por_id AS "criadoPorId", u.nome AS "criadoPor", to_char(c.criado_em AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') AS "criadoEm",
            to_char(c.confirmado_em AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') AS "confirmadoEm", uc.nome AS "confirmadoPor",
            o.id AS "obraId", o.nome AS "obraNome", o.codigo AS "obraCodigo", c.processo
       FROM contrato c JOIN obra o ON o.id = c.obra_id LEFT JOIN usuario u ON u.id = c.criado_por_id LEFT JOIN usuario uc ON uc.id = c.confirmado_por_id
      WHERE c.id = $1`, [contratoId],
  );
  if (!c) throw new ErroContrato("Contrato não encontrado.");
  const [gs, itens] = await Promise.all([
    ex.consulta<{ id: string; paiId: string | null; ordem: number; titulo: string }>(`SELECT id, pai_id AS "paiId", ordem, titulo FROM contrato_grupo WHERE contrato_id = $1`, [contratoId]),
    ex.consulta<ItemContrato>(
      `SELECT id, grupo_id AS "grupoId", ordem, numero, codigo, fonte, descricao, unidade, quantidade::text, preco_unitario::text AS "precoUnitario", valor_total::text AS "valorTotal",
              valor_total_arquivo::text AS "valorTotalArquivo", preco_orcado::text AS "precoOrcado", custo_unitario::text AS "custoUnitario", bdi_percentual::text AS "bdiPercentual",
              base_rotulo AS "baseRotulo", regime, referencia_preco AS "referenciaPreco", memoria_quantitativo AS "memoriaQuantitativo", memoria_calculo AS "memoriaCalculo",
              item_referencia_id AS "itemReferenciaId"
         FROM contrato_item WHERE contrato_id = $1 ORDER BY ordem`, [contratoId],
    ),
  ]);
  // numeração e totais dos grupos (com os subgrupos)
  const grupos: GrupoContrato[] = [];
  const somaDe = (gid: string): Dec => itens.filter((i) => i.grupoId === gid).reduce((a, i) => a.plus(i.valorTotal), dec(0))
    .plus(gs.filter((g) => g.paiId === gid).reduce((a, g) => a.plus(somaDe(g.id)), dec(0)));
  const visitar = (pai: string | null, prefixo: string, nivel: number) => {
    gs.filter((g) => g.paiId === pai).sort((a, b) => a.ordem - b.ordem).forEach((g, k) => {
      const numero = prefixo ? `${prefixo}.${k + 1}` : String(k + 1);
      grupos.push({ ...g, numero, nivel, total: somaDe(g.id).toFixed(2) });
      visitar(g.id, numero, nivel + 1);
    });
  };
  visitar(null, "", 0);
  const contratado = itens.reduce((a, i) => a.plus(i.valorTotal), dec(0));
  const comOrcado = itens.every((i) => i.precoOrcado !== null);
  const orcado = comOrcado ? itens.reduce((a, i) => a.plus(totalItem(i.quantidade, i.precoOrcado!, c.arredondamento)), dec(0)) : null;
  return {
    contrato: c,
    grupos,
    itens,
    totais: {
      contratado: contratado.toFixed(2),
      orcado: orcado?.toFixed(2) ?? null,
      desconto: orcado && !orcado.isZero() ? dec(1).minus(contratado.div(orcado)).times(100).toDecimalPlaces(4).toString() : null,
      itens: itens.length,
      divergentesArquivo: itens.filter((i) => i.valorTotalArquivo !== null && !dec(i.valorTotalArquivo).minus(totalItem(i.quantidade, i.precoUnitario, c.arredondamento)).abs().lte("0.01")).length,
    },
  };
}

// ---------------------------------------------------------------------------
// Edição (só em cadastro)
// ---------------------------------------------------------------------------

export function podeGerenciarContrato(c: { criadoPorId: string | null }, u: { id: string; administrador: boolean }) {
  return u.administrador || c.criadoPorId === u.id;
}

async function exigirEmCadastro(ex: Executor, contratoId: string, versao: number) {
  const [c] = await ex.consulta<{ situacao: string; versao: number; origem: string; arredondamento: ModoArredondamento }>(
    `SELECT situacao, versao, origem, arredondamento FROM contrato WHERE id = $1`, [contratoId],
  );
  if (!c) throw new ErroContrato("Contrato não encontrado.");
  if (c.situacao !== "EM_CADASTRO") throw new ErroContrato("A planilha do contrato está vigente e não pode ser alterada.");
  if (c.versao !== versao) throw new ErroContrato("O contrato foi alterado por outra pessoa. Recarregue a página.");
  return c;
}

const versaoMais = (contratoId: string, versao: number): Comando => ({
  sql: `UPDATE contrato SET versao = versao + 1, atualizado_em = now() WHERE id = $1 AND versao = $2`, params: [contratoId, versao],
});

export async function alterarDadosContrato(ex: Executor, contratoId: string, versao: number, d: DadosContrato, usuarioId: string) {
  const dados = limpar(d);
  const [c] = await ex.consulta<{ versao: number }>(`SELECT versao FROM contrato WHERE id = $1`, [contratoId]);
  if (!c) throw new ErroContrato("Contrato não encontrado.");
  if (c.versao !== versao) throw new ErroContrato("O contrato foi alterado por outra pessoa. Recarregue a página.");
  await numeroLivre(ex, dados.numero, contratoId);
  await ex.transacao([
    { sql: `UPDATE contrato SET numero = $2, objeto = $3, versao = versao + 1, atualizado_em = now() WHERE id = $1 AND versao = $4`, params: [contratoId, dados.numero, dados.objeto, versao] },
    comandoDados(contratoId, dados),
    comandoAuditoria({ usuarioId, acao: "CONTRATO_ALTERADO", entidade: "contrato", entidadeId: contratoId, depois: dados }),
  ]);
  return versao + 1;
}

/** Preço unitário contratado (contrato gerado do orçamento). */
export async function alterarPrecoContratado(ex: Executor, contratoId: string, versao: number, itemId: string, preco: string, usuarioId: string) {
  const c = await exigirEmCadastro(ex, contratoId, versao);
  if (c.origem !== "ORCAMENTO") throw new ErroContrato("Os preços de planilha importada são os da proposta e não são editados.");
  const p = lerNumero(preco);
  if (!p || p.isNegative()) throw new ErroContrato("Preço unitário inválido.");
  if (p.decimalPlaces() > 4) throw new ErroContrato("Preço unitário com no máximo 4 casas decimais.");
  const [it] = await ex.consulta<{ quantidade: string; preco: string }>(`SELECT quantidade::text, preco_unitario::text AS preco FROM contrato_item WHERE id = $1 AND contrato_id = $2`, [itemId, contratoId]);
  if (!it) throw new ErroContrato("Item não encontrado.");
  await ex.transacao([
    versaoMais(contratoId, versao),
    { sql: `UPDATE contrato_item SET preco_unitario = $2, valor_total = $3 WHERE id = $1`, params: [itemId, p.toString(), totalItem(it.quantidade, p, c.arredondamento).toString()] },
    comandoAuditoria({ usuarioId, acao: "CONTRATO_PRECO_ALTERADO", entidade: "contrato_item", entidadeId: itemId, antes: { preco: it.preco }, depois: { preco: p.toString() } }),
  ]);
  return versao + 1;
}

/**
 * Desconto linear da proposta sobre o preço orçado de todos os itens:
 * preço contratado = preço orçado × (1 − desconto), com 2 casas (arredondando ou truncando).
 */
export async function aplicarDescontoLinear(ex: Executor, contratoId: string, versao: number, percentual: string, modo: ModoArredondamento, usuarioId: string) {
  const c = await exigirEmCadastro(ex, contratoId, versao);
  if (c.origem !== "ORCAMENTO") throw new ErroContrato("O desconto linear vale para contratos gerados do orçamento.");
  const d = lerNumero(percentual);
  if (!d || d.isNegative() || d.gte(100)) throw new ErroContrato("Desconto deve ser de 0% a menos de 100%.");
  if (d.decimalPlaces() > 4) throw new ErroContrato("Desconto com no máximo 4 casas decimais.");
  const itens = await ex.consulta<{ id: string; quantidade: string; orcado: string }>(
    `SELECT id, quantidade::text, preco_orcado::text AS orcado FROM contrato_item WHERE contrato_id = $1 AND preco_orcado IS NOT NULL`, [contratoId],
  );
  const fator = dec(1).minus(d.div(100));
  const novos = itens.map((i) => {
    const p = arredondar(dec(i.orcado).times(fator), 2, modo);
    return { id: i.id, preco: p.toString(), total: totalItem(i.quantidade, p, c.arredondamento).toString() };
  });
  await ex.transacao([
    versaoMais(contratoId, versao),
    {
      sql: `UPDATE contrato_item ci SET preco_unitario = x.preco::numeric, valor_total = x.total::numeric
              FROM jsonb_to_recordset($1::jsonb) AS x(id uuid, preco text, total text) WHERE ci.id = x.id AND ci.contrato_id = $2`,
      params: [JSON.stringify(novos), contratoId],
    },
    comandoAuditoria({ usuarioId, acao: "CONTRATO_DESCONTO_LINEAR", entidade: "contrato", entidadeId: contratoId, depois: { percentual: d.toString(), modo, itens: novos.length } }),
  ]);
  return versao + 1;
}

/** Confirma a planilha: o contrato fica VIGENTE e a planilha, travada. */
export async function confirmarContrato(ex: Executor, contratoId: string, versao: number, u: { id: string; administrador: boolean }) {
  await exigirEmCadastro(ex, contratoId, versao);
  const e = await carregarContrato(ex, contratoId);
  if (!podeGerenciarContrato(e.contrato, u)) throw new ErroContrato("Só quem cadastrou o contrato (ou o administrador) pode confirmá-lo.");
  if (!e.itens.length) throw new ErroContrato("A planilha não tem itens.");
  if (e.itens.some((i) => dec(i.precoUnitario).isZero())) throw new ErroContrato(`Há item com preço contratado zero (item ${e.itens.find((i) => dec(i.precoUnitario).isZero())!.numero ?? "?"}).`);
  await ex.transacao([
    { sql: `UPDATE contrato SET situacao = 'VIGENTE', confirmado_em = now(), confirmado_por_id = $2, versao = versao + 1, atualizado_em = now() WHERE id = $1 AND versao = $3`, params: [contratoId, u.id, versao] },
    comandoAuditoria({ usuarioId: u.id, acao: "CONTRATO_CONFIRMADO", entidade: "contrato", entidadeId: contratoId, depois: { total: e.totais.contratado, itens: e.itens.length } }),
  ]);
}

/** Volta a planilha para cadastro (enquanto não houver medições — fase seguinte). */
export async function reabrirContrato(ex: Executor, contratoId: string, u: { id: string; administrador: boolean }) {
  const e = await carregarContrato(ex, contratoId);
  if (!podeGerenciarContrato(e.contrato, u)) throw new ErroContrato("Só quem cadastrou o contrato (ou o administrador) pode reabrir a planilha.");
  if (e.contrato.situacao !== "VIGENTE") throw new ErroContrato("A planilha já está em cadastro.");
  await ex.transacao([
    { sql: `UPDATE contrato SET situacao = 'EM_CADASTRO', confirmado_em = NULL, confirmado_por_id = NULL, versao = versao + 1, atualizado_em = now() WHERE id = $1`, params: [contratoId] },
    comandoAuditoria({ usuarioId: u.id, acao: "CONTRATO_REABERTO", entidade: "contrato", entidadeId: contratoId }),
  ]);
}

export async function excluirContrato(ex: Executor, contratoId: string, u: { id: string; administrador: boolean }) {
  const e = await carregarContrato(ex, contratoId);
  if (!podeGerenciarContrato(e.contrato, u)) throw new ErroContrato("Só quem cadastrou o contrato (ou o administrador) pode excluí-lo.");
  if (e.contrato.situacao !== "EM_CADASTRO") throw new ErroContrato("Contrato vigente não pode ser excluído; reabra a planilha antes.");
  await ex.transacao([
    LIBERAR_VIGENTE,
    { sql: `DELETE FROM contrato WHERE id = $1`, params: [contratoId] },
    comandoAuditoria({ usuarioId: u.id, acao: "CONTRATO_EXCLUIDO", entidade: "contrato", entidadeId: contratoId, antes: { numero: e.contrato.numero, itens: e.itens.length, total: e.totais.contratado } }),
  ]);
}

/** Revisões fechadas disponíveis para gerar contrato. */
export async function revisoesParaContrato(ex: Executor) {
  return ex.consulta<{ revisaoId: string; orcamentoId: string; processo: string | null; rotulo: string; obraNome: string; objeto: string | null; total: string }>(
    `SELECT r.id AS "revisaoId", oc.id AS "orcamentoId", o.processo, concat_ws(' — ', oc.codigo, oc.titulo) || ' · revisão ' || r.numero AS rotulo, o.nome AS "obraNome", o.descricao AS objeto,
            coalesce(r.total_geral, 0)::text AS total
       FROM orcamento_revisao r JOIN orcamento oc ON oc.id = r.orcamento_id JOIN obra o ON o.id = oc.obra_id
      WHERE r.status = 'FECHADA' ORDER BY r.fechada_em DESC NULLS LAST`,
  );
}

export const fmtMoeda = (v: string | Dec) => `R$ ${formatarNumero(v, 2)}`;
