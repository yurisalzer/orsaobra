/**
 * Serviço de orçamentos.
 *
 * Regras centrais:
 *  - Toda alteração confere a `versao` da revisão (controle otimista de
 *    concorrência) e a incrementa, na mesma transação.
 *  - Revisão FECHADA é imutável (também garantido por gatilhos no banco).
 *  - Cada item guarda o snapshot do que foi usado: código, descrição, unidade,
 *    custo unitário, origem/referência do preço, BDI aplicado e valores.
 *  - Só bases PUBLICADAS são usadas em orçamentos.
 *  - Atualizar para nova competência cria NOVA revisão; a anterior não muda.
 */
import type { Comando, Executor } from "../banco/executor";
import { comandoAuditoria } from "../auditoria";
import { arredondar, dec, formatarNumero, lerNumero, type Dec, type ModoArredondamento } from "../calculo/decimal";
import { calcularItem } from "../calculo/item";
import { numerarEtapas } from "../calculo/numeracao";
import { analiticaOficial, cabecalhoItem, linhasDaVersao } from "../referencia/item";
import { precificar, type ContextoPreco } from "../referencia/precificacao";
import { listarPerfis } from "./bdi";

export class ErroOrcamento extends Error {}

const json = (v: unknown) => JSON.stringify(v);

// ---------------------------------------------------------------------------
// Tipos de leitura
// ---------------------------------------------------------------------------

export interface BasePadrao {
  fonte: string;
  baseRevisaoId: string;
  competencia: string; // AAAA-MM
  numeroBase: number;
  regime: string | null;
  regimeNome: string | null;
}

export interface LinhaItem {
  id: string;
  etapaId: string;
  ordem: number;
  numero: string;
  itemReferenciaId: string;
  fonte: string;
  tipo: "INSUMO" | "COMPOSICAO";
  baseRevisaoId: string | null;
  baseRotulo: string | null;
  regime: string | null;
  codigo: string;
  descricao: string;
  unidade: string;
  quantidade: string;
  custoUnitario: string;
  custoTotal: string;
  bdiPerfilId: string | null;
  bdiPercentual: string;
  precoUnitario: string;
  precoTotal: string;
  origemPreco: string | null;
  referenciaPreco: string | null;
  pendencia: string | null;
  memoriaQuantitativo: string | null;
  memoriaCalculo: string | null;
  analitico: unknown;
}

export interface EtapaLinha { id: string; paiId: string | null; ordem: number; titulo: string; numero: string; custo: string; total: string }

export interface EstadoRevisao {
  revisao: {
    id: string; orcamentoId: string; numero: number; descricao: string | null; status: "EM_ELABORACAO" | "FECHADA"; versao: number;
    bdiPerfilId: string | null; bdiPercentual: string | null; arredondamento: ModoArredondamento; dataReferencia: string;
    fechadaEm: string | null; fechadaPor: string | null; revisaoOrigemId: string | null; criadoEm: string;
  };
  orcamento: { id: string; codigo: string | null; titulo: string; obraId: string; obraNome: string; obraCodigo: string | null; processo: string | null; orgaoSolicitante: string | null; endereco: string | null; municipio: string | null; uf: string };
  revisoes: { id: string; numero: number; status: string; descricao: string | null; fechadaEm: string | null; totalGeral: string | null }[];
  basesPadrao: BasePadrao[];
  etapas: EtapaLinha[];
  itens: LinhaItem[];
  totais: { custoDireto: string; bdi: string; total: string; itens: number; pendencias: number };
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

/** Memória do quantitativo: texto livre, até 4.000 caracteres (vazio = sem memória). */
export function lerMemoria(texto: string | null | undefined): string | null {
  const t = (texto ?? "").replace(/\r\n/g, "\n").trim();
  if (t.length > 4000) throw new ErroOrcamento("Memória de cálculo com mais de 4.000 caracteres.");
  return t || null;
}

/** Quantidade digitada ("12,5", "1.234,5678", "12.5") → texto decimal, validada. */
export function lerQuantidade(texto: string): string {
  const q = lerNumero(texto);
  if (!q) throw new ErroOrcamento("Quantidade inválida.");
  if (q.isNegative()) throw new ErroOrcamento("Quantidade não pode ser negativa.");
  if (q.decimalPlaces() > 4) throw new ErroOrcamento("Quantidade com no máximo 4 casas decimais.");
  if (q.gte("1e14")) throw new ErroOrcamento("Quantidade grande demais.");
  return q.toString();
}

/** Confere situação e versão, incrementa a versão. Deve abrir toda transação de edição. */
function travarEdicao(revisaoId: string, versaoEsperada: number): Comando[] {
  return [
    { sql: `SELECT imp_exigir((SELECT status = 'EM_ELABORACAO' FROM orcamento_revisao WHERE id = $1 FOR UPDATE), 'Esta revisão está fechada e não pode ser alterada. Crie uma nova revisão.')`, params: [revisaoId] },
    { sql: `SELECT imp_exigir((SELECT versao = $2 FROM orcamento_revisao WHERE id = $1), 'O orçamento foi alterado por outra pessoa (ou em outra aba) enquanto você editava. Recarregue a página.')`, params: [revisaoId, versaoEsperada] },
    { sql: `UPDATE orcamento_revisao SET versao = versao + 1, atualizado_em = now() WHERE id = $1`, params: [revisaoId] },
  ];
}

const fmt2 = (d: Dec | string) => formatarNumero(d, 2);

export interface ValoresItem {
  custoUnitario: Dec; // referência (4 casas)
  bdiPercentual: Dec;
  custoTotal: Dec;
  precoUnitario: Dec;
  precoTotal: Dec;
  memoria: string;
}

export function valoresDoItem(p: { quantidade: Dec | string; custoReferencia: Dec | string; bdi: Dec | string; modo: ModoArredondamento; unidade: string; referencia: string | null }): ValoresItem {
  const r = calcularItem({ quantidade: dec(p.quantidade), custoUnitario: dec(p.custoReferencia), bdiPercentual: dec(p.bdi) }, p.modo);
  const verbo = p.modo === "TRUNCAR" ? "truncado" : "arredondado";
  const memoria =
    `Custo unitário de referência: R$ ${formatarNumero(p.custoReferencia, 4)}${p.referencia ? ` (${p.referencia})` : ""}; ` +
    `${verbo} a 2 casas: R$ ${fmt2(r.custoUnitario)}. ` +
    `Preço unitário = ${fmt2(r.custoUnitario)} × (1 + ${fmt2(p.bdi)}% de BDI) = R$ ${fmt2(r.precoUnitario)} (${verbo}). ` +
    `Total = ${formatarNumero(p.quantidade, 4)} ${p.unidade || "un."} × ${fmt2(r.precoUnitario)} = R$ ${fmt2(r.precoTotal)}.`;
  return { custoUnitario: dec(p.custoReferencia), bdiPercentual: dec(p.bdi), custoTotal: r.custoTotal, precoUnitario: r.precoUnitario, precoTotal: r.precoTotal, memoria };
}

async function dadosRevisao(ex: Executor, revisaoId: string) {
  const [r] = await ex.consulta<{ id: string; orcamento_id: string; status: string; versao: number; bdi_percentual: string | null; arredondamento: ModoArredondamento; data_referencia: string }>(
    `SELECT id, orcamento_id, status::text, versao, bdi_percentual::text, arredondamento::text AS arredondamento, to_char(data_referencia, 'YYYY-MM-DD') AS data_referencia
       FROM orcamento_revisao WHERE id = $1`,
    [revisaoId],
  );
  if (!r) throw new ErroOrcamento("Revisão não encontrada.");
  return r;
}

export async function basesDaRevisao(ex: Executor, revisaoId: string): Promise<BasePadrao[]> {
  return ex.consulta<BasePadrao>(
    `SELECT f.codigo AS fonte, rbp.base_revisao_id AS "baseRevisaoId", to_char(b.competencia, 'YYYY-MM') AS competencia, br.numero AS "numeroBase",
            g.codigo AS regime, g.nome AS "regimeNome"
       FROM revisao_base_padrao rbp JOIN base_revisao br ON br.id = rbp.base_revisao_id JOIN base_mensal b ON b.id = br.base_id
       JOIN fonte f ON f.id = b.fonte_id JOIN regime g ON g.id = rbp.regime_id
      WHERE rbp.revisao_id = $1 ORDER BY f.codigo`,
    [revisaoId],
  );
}

async function contextoDaRevisao(ex: Executor, revisaoId: string, sobrescrever?: { fonte: string; baseRevisaoId: string; regime: string | null }): Promise<ContextoPreco> {
  const [bases, r] = await Promise.all([basesDaRevisao(ex, revisaoId), dadosRevisao(ex, revisaoId)]);
  const lista = bases.map((b) => ({ fonte: b.fonte, baseRevisaoId: b.baseRevisaoId, regime: b.regime }));
  if (sobrescrever) {
    const i = lista.findIndex((b) => b.fonte === sobrescrever.fonte);
    if (i >= 0) lista[i] = sobrescrever; else lista.push(sobrescrever);
  }
  return { bases: lista, dataReferencia: r.data_referencia };
}

async function bdiAplicavel(ex: Executor, revisaoBdi: string | null, perfilId: string | null): Promise<Dec> {
  if (!perfilId) return dec(revisaoBdi ?? 0);
  const p = (await listarPerfis(ex)).find((x) => x.id === perfilId);
  if (!p) throw new ErroOrcamento("Perfil de BDI não encontrado.");
  return dec(p.bdiAplicado);
}

async function validarBases(ex: Executor, bases: { baseRevisaoId: string; regime: string | null }[]) {
  const ids = bases.map((b) => b.baseRevisaoId);
  const linhas = await ex.consulta<{ id: string; fonte: string; status: string; regimes: string[] }>(
    `SELECT r.id, f.codigo AS fonte, r.status::text,
            ARRAY(SELECT DISTINCT g.codigo FROM preco p JOIN regime g ON g.id = p.regime_id WHERE p.base_revisao_id = r.id) AS regimes
       FROM base_revisao r JOIN base_mensal b ON b.id = r.base_id JOIN fonte f ON f.id = b.fonte_id WHERE r.id = ANY($1::uuid[])`,
    [ids],
  );
  const fontes = new Set<string>();
  for (const b of bases) {
    const l = linhas.find((x) => x.id === b.baseRevisaoId);
    if (!l) throw new ErroOrcamento("Base de referência não encontrada.");
    if (l.status !== "PUBLICADA") throw new ErroOrcamento(`A base ${l.fonte} selecionada não está publicada.`);
    if (!b.regime || !l.regimes.includes(b.regime)) throw new ErroOrcamento(`Regime inválido para a base ${l.fonte}.`);
    if (fontes.has(l.fonte)) throw new ErroOrcamento(`Escolha apenas uma base ${l.fonte}.`);
    fontes.add(l.fonte);
  }
}

function comandosBasesPadrao(revisaoId: string, bases: { baseRevisaoId: string; regime: string | null }[]): Comando[] {
  return [
    { sql: `DELETE FROM revisao_base_padrao WHERE revisao_id = $1`, params: [revisaoId] },
    {
      sql: `INSERT INTO revisao_base_padrao (revisao_id, base_revisao_id, regime_id)
            SELECT $1, x.base::uuid, g.id FROM jsonb_to_recordset($2::jsonb) AS x(base text, regime text)
              JOIN base_revisao br ON br.id = x.base::uuid JOIN base_mensal b ON b.id = br.base_id
              JOIN regime g ON g.fonte_id = b.fonte_id AND g.codigo = x.regime`,
      params: [revisaoId, json(bases.map((b) => ({ base: b.baseRevisaoId, regime: b.regime })))],
    },
  ];
}

// ---------------------------------------------------------------------------
// Obras e orçamentos
// ---------------------------------------------------------------------------

export interface DadosObra {
  nome: string; codigo?: string | null; processo?: string | null; descricao?: string | null;
  endereco?: string | null; municipio?: string | null; orgaoSolicitante?: string | null; uf?: string;
}

const CAMPOS_OBRA = ["codigo", "processo", "descricao", "endereco", "municipio", "orgaoSolicitante"] as const;

/** Textos aparados; campos vazios viram null. */
function normalizarObra(d: DadosObra) {
  const nome = d.nome.trim();
  if (nome.length < 2) throw new ErroOrcamento("Informe o nome da obra.");
  const r = { nome, uf: (d.uf ?? "RJ").toUpperCase() } as Record<(typeof CAMPOS_OBRA)[number], string | null> & { nome: string; uf: string };
  for (const k of CAMPOS_OBRA) r[k] = d[k]?.trim() || null;
  return r;
}

export async function criarObra(ex: Executor, d: DadosObra, usuarioId: string) {
  const o = normalizarObra(d);
  const id = crypto.randomUUID();
  await ex.transacao([
    {
      sql: `INSERT INTO obra (id, nome, codigo, processo, descricao, endereco, municipio, orgao_solicitante, uf) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      params: [id, o.nome, o.codigo, o.processo, o.descricao, o.endereco, o.municipio, o.orgaoSolicitante, o.uf],
    },
    comandoAuditoria({ usuarioId, acao: "OBRA_CRIADA", entidade: "obra", entidadeId: id, depois: o }),
  ]);
  return id;
}

export async function lerObra(ex: Executor, id: string) {
  const [o] = await ex.consulta<{ [K in keyof DadosObra]-?: K extends "nome" | "uf" ? string : string | null } & { id: string; orcamentos: number }>(
    `SELECT id, nome, codigo, processo, descricao, endereco, municipio, orgao_solicitante AS "orgaoSolicitante", uf,
            (SELECT count(*)::int FROM orcamento oc WHERE oc.obra_id = o.id) AS orcamentos
       FROM obra o WHERE id = $1`,
    [id],
  );
  if (!o) throw new ErroOrcamento("Obra não encontrada.");
  return o;
}

/**
 * Altera os dados cadastrais da obra. `antes` são os dados que o usuário abriu
 * para editar: se outra pessoa alterou a obra nesse meio-tempo, nada é gravado.
 */
export async function alterarObra(ex: Executor, id: string, antes: DadosObra, depois: DadosObra, usuarioId: string) {
  const a = normalizarObra(antes);
  const o = normalizarObra(depois);
  await ex.transacao([
    {
      sql: `SELECT imp_exigir(EXISTS (SELECT 1 FROM obra WHERE id = $1 FOR UPDATE), 'Obra não encontrada.')`,
      params: [id],
    },
    {
      sql: `SELECT imp_exigir((SELECT (nome, codigo, processo, descricao, endereco, municipio, orgao_solicitante) IS NOT DISTINCT FROM ($2, $3, $4, $5, $6, $7, $8)
                                 FROM obra WHERE id = $1),
                              'A obra foi alterada por outra pessoa (ou em outra aba) enquanto você editava. Recarregue a página.')`,
      params: [id, a.nome, a.codigo, a.processo, a.descricao, a.endereco, a.municipio, a.orgaoSolicitante],
    },
    {
      sql: `UPDATE obra SET nome = $2, codigo = $3, processo = $4, descricao = $5, endereco = $6, municipio = $7, orgao_solicitante = $8 WHERE id = $1`,
      params: [id, o.nome, o.codigo, o.processo, o.descricao, o.endereco, o.municipio, o.orgaoSolicitante],
    },
    comandoAuditoria({ usuarioId, acao: "OBRA_ALTERADA", entidade: "obra", entidadeId: id, antes: a, depois: o }),
  ]);
}

export async function criarOrcamento(
  ex: Executor,
  d: { obraId: string; codigo?: string | null; titulo: string; bases: { baseRevisaoId: string; regime: string | null }[]; bdiPerfilId?: string | null; arredondamento?: ModoArredondamento; dataReferencia?: string | null },
  usuarioId: string,
) {
  const titulo = d.titulo.trim();
  if (titulo.length < 2) throw new ErroOrcamento("Informe o título do orçamento.");
  await validarBases(ex, d.bases);
  const bdi = d.bdiPerfilId ? await bdiAplicavel(ex, null, d.bdiPerfilId) : null;
  const orcamentoId = crypto.randomUUID();
  const revisaoId = crypto.randomUUID();
  await ex.transacao([
    { sql: `INSERT INTO orcamento (id, obra_id, codigo, titulo) VALUES ($1, $2, $3, $4)`, params: [orcamentoId, d.obraId, d.codigo?.trim() || null, titulo] },
    {
      sql: `INSERT INTO orcamento_revisao (id, orcamento_id, numero, descricao, bdi_perfil_id, bdi_percentual, arredondamento, data_referencia, criado_por_id)
            VALUES ($1, $2, 1, 'Revisão inicial', $3, $4::numeric, $5::"Arredondamento", coalesce($6::date, current_date), $7)`,
      params: [revisaoId, orcamentoId, d.bdiPerfilId ?? null, bdi?.toString() ?? null, d.arredondamento ?? "ARREDONDAR", d.dataReferencia ?? null, usuarioId],
    },
    ...comandosBasesPadrao(revisaoId, d.bases),
    comandoAuditoria({ usuarioId, acao: "ORCAMENTO_CRIADO", entidade: "orcamento", entidadeId: orcamentoId, depois: { titulo, bases: d.bases, bdiPerfilId: d.bdiPerfilId } }),
  ]);
  return { orcamentoId, revisaoId };
}

export async function listarOrcamentos(ex: Executor) {
  return ex.consulta<{ obraId: string; obra: string; obraCodigo: string | null; orgaoSolicitante: string | null; orcamentoId: string; codigo: string | null; titulo: string | null; revisoes: number; ultimaRevisaoId: string | null; ultimaNumero: number | null; ultimaStatus: string | null; total: string | null; atualizado: string | null }>(
    `SELECT o.id AS "obraId", o.nome AS obra, o.codigo AS "obraCodigo", o.orgao_solicitante AS "orgaoSolicitante", oc.id AS "orcamentoId", oc.codigo, oc.titulo,
            (SELECT count(*)::int FROM orcamento_revisao r WHERE r.orcamento_id = oc.id) AS revisoes,
            u.id AS "ultimaRevisaoId", u.numero AS "ultimaNumero", u.status::text AS "ultimaStatus",
            coalesce(u.total_geral, (SELECT sum(i.preco_total) FROM item_orcamento i WHERE i.revisao_id = u.id))::text AS total,
            to_char(u.atualizado_em AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') AS atualizado
       FROM obra o LEFT JOIN orcamento oc ON oc.obra_id = o.id
       LEFT JOIN LATERAL (SELECT * FROM orcamento_revisao r WHERE r.orcamento_id = oc.id ORDER BY r.numero DESC LIMIT 1) u ON true
      ORDER BY o.nome, oc.titulo`,
  );
}

// ---------------------------------------------------------------------------
// Leitura completa de uma revisão
// ---------------------------------------------------------------------------

export async function carregarRevisao(ex: Executor, revisaoId: string): Promise<EstadoRevisao> {
  const [r] = await ex.consulta<EstadoRevisao["revisao"] & { obra_id: string }>(
    `SELECT r.id, r.orcamento_id AS "orcamentoId", r.numero, r.descricao, r.status::text AS status, r.versao, r.bdi_perfil_id AS "bdiPerfilId",
            r.bdi_percentual::text AS "bdiPercentual", r.arredondamento::text AS arredondamento, to_char(r.data_referencia, 'YYYY-MM-DD') AS "dataReferencia",
            to_char(r.fechada_em AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') AS "fechadaEm", u.nome AS "fechadaPor",
            r.revisao_origem_id AS "revisaoOrigemId", to_char(r.criado_em AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') AS "criadoEm"
       FROM orcamento_revisao r LEFT JOIN usuario u ON u.id = r.fechada_por_id WHERE r.id = $1`,
    [revisaoId],
  );
  if (!r) throw new ErroOrcamento("Revisão não encontrada.");
  const [orc] = await ex.consulta<EstadoRevisao["orcamento"]>(
    `SELECT oc.id, oc.codigo, oc.titulo, o.id AS "obraId", o.nome AS "obraNome", o.codigo AS "obraCodigo", o.processo, o.orgao_solicitante AS "orgaoSolicitante", o.endereco, o.municipio, o.uf
       FROM orcamento oc JOIN obra o ON o.id = oc.obra_id WHERE oc.id = $1`,
    [r.orcamentoId],
  );
  const [revisoes, basesPadrao, etapasBrutas, itensBrutos] = await Promise.all([
    ex.consulta<EstadoRevisao["revisoes"][number]>(
      `SELECT id, numero, status::text AS status, descricao, to_char(fechada_em AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY') AS "fechadaEm",
              coalesce(total_geral, (SELECT sum(i.preco_total) FROM item_orcamento i WHERE i.revisao_id = r.id))::text AS "totalGeral"
         FROM orcamento_revisao r WHERE orcamento_id = $1 ORDER BY numero`,
      [r.orcamentoId],
    ),
    basesDaRevisao(ex, revisaoId),
    ex.consulta<{ id: string; paiId: string | null; ordem: number; titulo: string }>(
      `SELECT id, pai_id AS "paiId", ordem, titulo FROM etapa WHERE revisao_id = $1`, [revisaoId],
    ),
    ex.consulta<Omit<LinhaItem, "numero">>(
      `SELECT i.id, i.etapa_id AS "etapaId", i.ordem, i.item_referencia_id AS "itemReferenciaId", f.codigo AS fonte, ir.tipo::text AS tipo,
              i.base_revisao_id AS "baseRevisaoId",
              CASE WHEN i.base_revisao_id IS NULL THEN NULL ELSE f.codigo || ' ' || to_char(b.competencia, 'MM/YYYY') || CASE WHEN br.numero > 0 THEN ' ret.' || br.numero ELSE '' END END AS "baseRotulo",
              g.codigo AS regime, i.codigo, i.descricao, i.unidade, i.quantidade::text AS quantidade, i.custo_unitario::text AS "custoUnitario",
              i.custo_total::text AS "custoTotal", i.bdi_perfil_id AS "bdiPerfilId", i.bdi_percentual::text AS "bdiPercentual",
              i.preco_unitario::text AS "precoUnitario", i.preco_total::text AS "precoTotal", i.origem_preco AS "origemPreco",
              i.referencia_preco AS "referenciaPreco", i.pendencia, i.memoria_quantitativo AS "memoriaQuantitativo",
              i.memoria_calculo AS "memoriaCalculo", i.analitico
         FROM item_orcamento i JOIN item_referencia ir ON ir.id = i.item_referencia_id JOIN fonte f ON f.id = ir.fonte_id
         LEFT JOIN base_revisao br ON br.id = i.base_revisao_id LEFT JOIN base_mensal b ON b.id = br.base_id
         LEFT JOIN regime g ON g.id = i.regime_id
        WHERE i.revisao_id = $1`,
      [revisaoId],
    ),
  ]);

  // numeração hierárquica e ordenação em árvore
  const numeros = numerarEtapas(etapasBrutas);
  const ordemArvore = (n: string) => n.split(".").map((x) => x.padStart(5, "0")).join(".");
  const etapasOrd = [...etapasBrutas].sort((a, b) => ordemArvore(numeros.get(a.id)!).localeCompare(ordemArvore(numeros.get(b.id)!)));
  const itensPorEtapa = new Map<string, Omit<LinhaItem, "numero">[]>();
  for (const it of itensBrutos) itensPorEtapa.set(it.etapaId, [...(itensPorEtapa.get(it.etapaId) ?? []), it]);
  const itens: LinhaItem[] = [];
  const somaEtapa = new Map<string, { custo: Dec; total: Dec }>();
  for (const e of etapasOrd) {
    const lista = (itensPorEtapa.get(e.id) ?? []).sort((a, b) => a.ordem - b.ordem);
    const nEtapa = numeros.get(e.id)!;
    const subetapas = etapasBrutas.filter((x) => x.paiId === e.id).length;
    lista.forEach((it, i) => itens.push({ ...it, numero: `${nEtapa}.${subetapas + i + 1}` }));
    somaEtapa.set(e.id, {
      custo: lista.reduce((a, x) => a.plus(x.custoTotal), dec(0)),
      total: lista.reduce((a, x) => a.plus(x.precoTotal), dec(0)),
    });
  }
  // agrega subetapas nas etapas-mãe (de baixo para cima)
  const acumulado = new Map<string, { custo: Dec; total: Dec }>();
  const acumular = (id: string): { custo: Dec; total: Dec } => {
    const proprio = somaEtapa.get(id) ?? { custo: dec(0), total: dec(0) };
    const filhos = etapasBrutas.filter((x) => x.paiId === id).map((x) => acumular(x.id));
    const t = filhos.reduce((a, f) => ({ custo: a.custo.plus(f.custo), total: a.total.plus(f.total) }), proprio);
    acumulado.set(id, t);
    return t;
  };
  etapasBrutas.filter((e) => !e.paiId).forEach((e) => acumular(e.id));
  const etapas: EtapaLinha[] = etapasOrd.map((e) => ({ ...e, numero: numeros.get(e.id)!, custo: acumulado.get(e.id)!.custo.toFixed(2), total: acumulado.get(e.id)!.total.toFixed(2) }));
  const custoDireto = itens.reduce((a, x) => a.plus(x.custoTotal), dec(0));
  const total = itens.reduce((a, x) => a.plus(x.precoTotal), dec(0));
  return {
    revisao: r, orcamento: orc, revisoes, basesPadrao, etapas, itens,
    totais: { custoDireto: custoDireto.toFixed(2), bdi: total.minus(custoDireto).toFixed(2), total: total.toFixed(2), itens: itens.length, pendencias: itens.filter((i) => i.pendencia).length },
  };
}

// ---------------------------------------------------------------------------
// Configuração da revisão
// ---------------------------------------------------------------------------

export async function configurarRevisao(
  ex: Executor, revisaoId: string, versao: number,
  d: { descricao?: string | null; bases?: { baseRevisaoId: string; regime: string | null }[]; bdiPerfilId?: string | null; arredondamento?: ModoArredondamento; dataReferencia?: string },
  usuarioId: string,
) {
  const r = await dadosRevisao(ex, revisaoId);
  const cmds: Comando[] = travarEdicao(revisaoId, versao);
  if (d.descricao !== undefined) cmds.push({ sql: `UPDATE orcamento_revisao SET descricao = $2 WHERE id = $1`, params: [revisaoId, d.descricao?.trim() || null] });
  if (d.dataReferencia !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.dataReferencia)) throw new ErroOrcamento("Data de referência inválida.");
    cmds.push({ sql: `UPDATE orcamento_revisao SET data_referencia = $2::date WHERE id = $1`, params: [revisaoId, d.dataReferencia] });
  }
  if (d.bases) {
    await validarBases(ex, d.bases);
    cmds.push(...comandosBasesPadrao(revisaoId, d.bases));
  }
  let bdiGlobal = r.bdi_percentual;
  const modo = d.arredondamento ?? r.arredondamento;
  if (d.bdiPerfilId !== undefined) {
    bdiGlobal = d.bdiPerfilId ? (await bdiAplicavel(ex, null, d.bdiPerfilId)).toString() : null;
    cmds.push({ sql: `UPDATE orcamento_revisao SET bdi_perfil_id = $2, bdi_percentual = $3::numeric WHERE id = $1`, params: [revisaoId, d.bdiPerfilId, bdiGlobal] });
  }
  if (d.arredondamento) cmds.push({ sql: `UPDATE orcamento_revisao SET arredondamento = $2::"Arredondamento" WHERE id = $1`, params: [revisaoId, d.arredondamento] });
  // BDI global ou arredondamento mudaram: recalcula os itens afetados
  if (d.bdiPerfilId !== undefined || d.arredondamento) {
    const itens = await ex.consulta<{ id: string; quantidade: string; custo_unitario: string; bdi_perfil_id: string | null; bdi_percentual: string; unidade: string; referencia_preco: string | null }>(
      `SELECT id, quantidade::text, custo_unitario::text, bdi_perfil_id, bdi_percentual::text, unidade, referencia_preco FROM item_orcamento WHERE revisao_id = $1`, [revisaoId],
    );
    const novos = itens.map((i) => {
      const bdi = i.bdi_perfil_id ? i.bdi_percentual : (bdiGlobal ?? "0");
      return { id: i.id, ...serializar(valoresDoItem({ quantidade: i.quantidade, custoReferencia: i.custo_unitario, bdi, modo, unidade: i.unidade, referencia: i.referencia_preco })) };
    });
    if (novos.length) cmds.push(comandoAtualizarValores(novos));
  }
  cmds.push(comandoAuditoria({ usuarioId, acao: "REVISAO_CONFIGURADA", entidade: "orcamento_revisao", entidadeId: revisaoId, depois: d }));
  await ex.transacao(cmds);
  return versao + 1;
}

function serializar(v: ValoresItem) {
  return {
    custoUnitario: v.custoUnitario.toString(), bdiPercentual: v.bdiPercentual.toString(), custoTotal: v.custoTotal.toString(),
    precoUnitario: v.precoUnitario.toString(), precoTotal: v.precoTotal.toString(), memoria: v.memoria,
  };
}

function comandoAtualizarValores(itens: ({ id: string } & ReturnType<typeof serializar>)[]): Comando {
  return {
    sql: `UPDATE item_orcamento i SET custo_unitario = x."custoUnitario"::numeric, bdi_percentual = x."bdiPercentual"::numeric,
                 custo_total = x."custoTotal"::numeric, preco_unitario = x."precoUnitario"::numeric, preco_total = x."precoTotal"::numeric,
                 memoria_calculo = x.memoria
            FROM jsonb_to_recordset($1::jsonb) AS x(id uuid, "custoUnitario" text, "bdiPercentual" text, "custoTotal" text, "precoUnitario" text, "precoTotal" text, memoria text)
           WHERE i.id = x.id`,
    params: [json(itens)],
  };
}

// ---------------------------------------------------------------------------
// Etapas
// ---------------------------------------------------------------------------

export async function criarEtapa(ex: Executor, revisaoId: string, versao: number, d: { paiId?: string | null; titulo: string }, usuarioId: string) {
  const titulo = d.titulo.trim();
  if (titulo.length < 2) throw new ErroOrcamento("Informe o título da etapa.");
  if (d.paiId) {
    const [p] = await ex.consulta<{ ok: boolean }>(`SELECT true AS ok FROM etapa WHERE id = $1 AND revisao_id = $2`, [d.paiId, revisaoId]);
    if (!p) throw new ErroOrcamento("Etapa-mãe não encontrada.");
  }
  const id = crypto.randomUUID();
  await ex.transacao([
    ...travarEdicao(revisaoId, versao),
    {
      sql: `INSERT INTO etapa (id, revisao_id, pai_id, ordem, titulo)
            VALUES ($1, $2, $3, (SELECT coalesce(max(ordem), 0) + 1 FROM etapa WHERE revisao_id = $2 AND pai_id IS NOT DISTINCT FROM $3::uuid), $4)`,
      params: [id, revisaoId, d.paiId ?? null, titulo],
    },
    comandoAuditoria({ usuarioId, acao: "ETAPA_CRIADA", entidade: "etapa", entidadeId: id, depois: d }),
  ]);
  return { id, versao: versao + 1 };
}

export async function renomearEtapa(ex: Executor, revisaoId: string, versao: number, etapaId: string, titulo: string, usuarioId: string) {
  if (titulo.trim().length < 2) throw new ErroOrcamento("Informe o título da etapa.");
  await ex.transacao([
    ...travarEdicao(revisaoId, versao),
    { sql: `UPDATE etapa SET titulo = $3 WHERE id = $1 AND revisao_id = $2`, params: [etapaId, revisaoId, titulo.trim()] },
    comandoAuditoria({ usuarioId, acao: "ETAPA_RENOMEADA", entidade: "etapa", entidadeId: etapaId, depois: { titulo } }),
  ]);
  return versao + 1;
}

export async function excluirEtapa(ex: Executor, revisaoId: string, versao: number, etapaId: string, usuarioId: string) {
  await ex.transacao([
    ...travarEdicao(revisaoId, versao),
    { sql: `SELECT imp_exigir(EXISTS (SELECT 1 FROM etapa WHERE id = $1 AND revisao_id = $2), 'Etapa não encontrada.')`, params: [etapaId, revisaoId] },
    // itens das subetapas também saem (exclusão em cascata da árvore)
    {
      sql: `WITH RECURSIVE arvore AS (SELECT id FROM etapa WHERE id = $1 UNION ALL SELECT e.id FROM etapa e JOIN arvore a ON e.pai_id = a.id)
            DELETE FROM item_orcamento WHERE etapa_id IN (SELECT id FROM arvore)`,
      params: [etapaId],
    },
    { sql: `DELETE FROM etapa WHERE id = $1`, params: [etapaId] },
    comandoAuditoria({ usuarioId, acao: "ETAPA_EXCLUIDA", entidade: "etapa", entidadeId: etapaId }),
  ]);
  return versao + 1;
}

/** Troca a posição com a etapa irmã anterior (-1) ou seguinte (+1). */
export async function moverEtapa(ex: Executor, revisaoId: string, versao: number, etapaId: string, direcao: -1 | 1, usuarioId: string) {
  const irmas = await ex.consulta<{ id: string; ordem: number }>(
    `SELECT id, ordem FROM etapa WHERE revisao_id = $1 AND pai_id IS NOT DISTINCT FROM (SELECT pai_id FROM etapa WHERE id = $2) ORDER BY ordem`,
    [revisaoId, etapaId],
  );
  const i = irmas.findIndex((x) => x.id === etapaId);
  const j = i + direcao;
  if (i < 0 || j < 0 || j >= irmas.length) return versao;
  await ex.transacao([
    ...travarEdicao(revisaoId, versao),
    { sql: `UPDATE etapa SET ordem = $2 WHERE id = $1`, params: [irmas[i].id, irmas[j].ordem] },
    { sql: `UPDATE etapa SET ordem = $2 WHERE id = $1`, params: [irmas[j].id, irmas[i].ordem] },
    comandoAuditoria({ usuarioId, acao: "ETAPA_MOVIDA", entidade: "etapa", entidadeId: etapaId }),
  ]);
  return versao + 1;
}

// ---------------------------------------------------------------------------
// Itens
// ---------------------------------------------------------------------------

async function precoParaItem(ex: Executor, revisaoId: string, itemReferenciaId: string, override?: { baseRevisaoId: string; regime: string | null } | null) {
  const [info] = await ex.consulta<{ fonte: string; tipo: string }>(
    `SELECT f.codigo AS fonte, ir.tipo::text AS tipo FROM item_referencia ir JOIN fonte f ON f.id = ir.fonte_id WHERE ir.id = $1`, [itemReferenciaId],
  );
  if (!info) throw new ErroOrcamento("Item de referência não encontrado.");
  if (override && info.fonte !== "PROPRIA") {
    const [b] = await ex.consulta<{ fonte: string; status: string }>(
      `SELECT f.codigo AS fonte, r.status::text FROM base_revisao r JOIN base_mensal b ON b.id = r.base_id JOIN fonte f ON f.id = b.fonte_id WHERE r.id = $1`, [override.baseRevisaoId],
    );
    if (!b || b.fonte !== info.fonte) throw new ErroOrcamento("A base escolhida não é da mesma fonte do item.");
    if (b.status !== "PUBLICADA" && b.status !== "SUBSTITUIDA") throw new ErroOrcamento("A base escolhida não está publicada.");
  }
  const ctx = await contextoDaRevisao(ex, revisaoId, override && info.fonte !== "PROPRIA" ? { fonte: info.fonte, ...override } : undefined);
  const preco = (await precificar(ex, [itemReferenciaId], ctx)).get(itemReferenciaId)!;
  const base = info.fonte === "PROPRIA" ? null : ctx.bases.find((b) => b.fonte === info.fonte) ?? null;
  return { info, preco, base, ctx };
}

export async function adicionarItem(
  ex: Executor, revisaoId: string, versao: number,
  d: { etapaId: string; itemReferenciaId: string; quantidade: string; memoriaQuantitativo?: string | null; base?: { baseRevisaoId: string; regime: string | null } | null },
  usuarioId: string,
) {
  const q = dec(lerQuantidade(d.quantidade));
  const memoriaQtd = lerMemoria(d.memoriaQuantitativo);
  const [et] = await ex.consulta<{ ok: boolean }>(`SELECT true AS ok FROM etapa WHERE id = $1 AND revisao_id = $2`, [d.etapaId, revisaoId]);
  if (!et) throw new ErroOrcamento("Etapa não encontrada.");
  const r = await dadosRevisao(ex, revisaoId);
  const { preco, base } = await precoParaItem(ex, revisaoId, d.itemReferenciaId, d.base);
  if (!preco.valor) throw new ErroOrcamento(`Este item não pode ser orçado na base/regime selecionados: ${preco.pendencia ?? "sem preço"}`);
  const cab = await cabecalhoItem(ex, d.itemReferenciaId, base?.baseRevisaoId);
  if (!cab) throw new ErroOrcamento("Item não encontrado.");
  const custoRef = arredondar(preco.valor, 4);
  const v = valoresDoItem({ quantidade: q, custoReferencia: custoRef, bdi: r.bdi_percentual ?? "0", modo: r.arredondamento, unidade: cab.unidade ?? "", referencia: preco.referencia });
  const id = crypto.randomUUID();
  await ex.transacao([
    ...travarEdicao(revisaoId, versao),
    {
      sql: `INSERT INTO item_orcamento (id, revisao_id, etapa_id, ordem, item_referencia_id, base_revisao_id, regime_id, codigo, descricao, unidade, quantidade,
                                        custo_unitario, bdi_percentual, preco_unitario, preco_total, custo_total, origem_preco, referencia_preco, memoria_calculo, memoria_quantitativo)
            VALUES ($1, $2, $3, (SELECT coalesce(max(ordem), 0) + 1 FROM item_orcamento WHERE etapa_id = $3), $4, $5,
                    (SELECT g.id FROM regime g JOIN base_mensal b ON b.fonte_id = g.fonte_id JOIN base_revisao br ON br.base_id = b.id WHERE br.id = $5 AND g.codigo = $6),
                    $7, $8, $9, $10::numeric, $11::numeric, $12::numeric, $13::numeric, $14::numeric, $15::numeric, $16, $17, $18, $19)`,
      params: [id, revisaoId, d.etapaId, d.itemReferenciaId, base?.baseRevisaoId ?? null, base?.regime ?? null, cab.codigo, cab.descricao, cab.unidade ?? "",
        q.toString(), v.custoUnitario.toString(), v.bdiPercentual.toString(), v.precoUnitario.toString(), v.precoTotal.toString(), v.custoTotal.toString(),
        preco.origem, preco.referencia, v.memoria, memoriaQtd],
    },
    comandoAuditoria({ usuarioId, acao: "ITEM_ADICIONADO", entidade: "item_orcamento", entidadeId: id, depois: { codigo: cab.codigo, quantidade: q.toString(), custo: v.custoUnitario.toString(), memoriaQuantitativo: memoriaQtd } }),
  ]);
  return { id, versao: versao + 1 };
}

export async function alterarItem(
  ex: Executor, revisaoId: string, versao: number, itemId: string,
  d: { quantidade?: string; memoriaQuantitativo?: string | null; bdiPerfilId?: string | null; base?: { baseRevisaoId: string; regime: string | null } | null; etapaId?: string },
  usuarioId: string,
) {
  const [i] = await ex.consulta<{ id: string; item_referencia_id: string; quantidade: string; custo_unitario: string; bdi_perfil_id: string | null; bdi_percentual: string; unidade: string; referencia_preco: string | null; memoria_quantitativo: string | null }>(
    `SELECT id, item_referencia_id, quantidade::text, custo_unitario::text, bdi_perfil_id, bdi_percentual::text, unidade, referencia_preco, memoria_quantitativo FROM item_orcamento WHERE id = $1 AND revisao_id = $2`,
    [itemId, revisaoId],
  );
  if (!i) throw new ErroOrcamento("Item não encontrado nesta revisão.");
  const r = await dadosRevisao(ex, revisaoId);
  const cmds: Comando[] = travarEdicao(revisaoId, versao);
  let quantidade = i.quantidade;
  if (d.quantidade !== undefined) {
    quantidade = lerQuantidade(d.quantidade);
    cmds.push({ sql: `UPDATE item_orcamento SET quantidade = $2::numeric WHERE id = $1`, params: [itemId, quantidade] });
  }
  let memoriaQtd = i.memoria_quantitativo;
  if (d.memoriaQuantitativo !== undefined) {
    memoriaQtd = lerMemoria(d.memoriaQuantitativo);
    cmds.push({ sql: `UPDATE item_orcamento SET memoria_quantitativo = $2 WHERE id = $1`, params: [itemId, memoriaQtd] });
  }
  let perfil = i.bdi_perfil_id;
  let bdi = i.bdi_perfil_id ? i.bdi_percentual : (r.bdi_percentual ?? "0");
  if (d.bdiPerfilId !== undefined) {
    perfil = d.bdiPerfilId;
    bdi = (await bdiAplicavel(ex, r.bdi_percentual, perfil)).toString();
    cmds.push({ sql: `UPDATE item_orcamento SET bdi_perfil_id = $2 WHERE id = $1`, params: [itemId, perfil] });
  }
  let custo = i.custo_unitario;
  let referencia = i.referencia_preco;
  if (d.base) {
    const { preco, base } = await precoParaItem(ex, revisaoId, i.item_referencia_id, d.base);
    if (!preco.valor) throw new ErroOrcamento(`Sem preço na base/regime escolhidos: ${preco.pendencia ?? ""}`);
    const cab = await cabecalhoItem(ex, i.item_referencia_id, base?.baseRevisaoId);
    custo = arredondar(preco.valor, 4).toString();
    referencia = preco.referencia;
    cmds.push({
      sql: `UPDATE item_orcamento SET base_revisao_id = $2,
                   regime_id = (SELECT g.id FROM regime g JOIN base_mensal b ON b.fonte_id = g.fonte_id JOIN base_revisao br ON br.base_id = b.id WHERE br.id = $2 AND g.codigo = $3),
                   origem_preco = $4, referencia_preco = $5, descricao = $6, unidade = $7, pendencia = NULL WHERE id = $1`,
      params: [itemId, base?.baseRevisaoId ?? null, base?.regime ?? null, preco.origem, preco.referencia, cab?.descricao, cab?.unidade ?? ""],
    });
  }
  if (d.etapaId) {
    cmds.push({ sql: `SELECT imp_exigir(EXISTS (SELECT 1 FROM etapa WHERE id = $1 AND revisao_id = $2), 'Etapa de destino não encontrada.')`, params: [d.etapaId, revisaoId] });
    cmds.push({ sql: `UPDATE item_orcamento SET etapa_id = $2, ordem = (SELECT coalesce(max(ordem), 0) + 1 FROM item_orcamento WHERE etapa_id = $2) WHERE id = $1`, params: [itemId, d.etapaId] });
  }
  const v = valoresDoItem({ quantidade, custoReferencia: custo, bdi, modo: r.arredondamento, unidade: i.unidade, referencia });
  cmds.push(comandoAtualizarValores([{ id: itemId, ...serializar(v) }]));
  cmds.push(comandoAuditoria({ usuarioId, acao: "ITEM_ALTERADO", entidade: "item_orcamento", entidadeId: itemId, antes: { quantidade: i.quantidade, custo: i.custo_unitario, bdi: i.bdi_percentual, memoriaQuantitativo: i.memoria_quantitativo }, depois: { quantidade, custo, bdi, memoriaQuantitativo: memoriaQtd } }));
  await ex.transacao(cmds);
  return versao + 1;
}

/**
 * Troca o serviço/insumo de um item (novo código), mantendo posição, quantidade,
 * memória de cálculo do quantitativo e BDI. O preço vem da base padrão da
 * revisão para a fonte do novo código.
 */
export async function trocarItem(ex: Executor, revisaoId: string, versao: number, itemId: string, novoItemReferenciaId: string, usuarioId: string) {
  const [i] = await ex.consulta<{ item_referencia_id: string; codigo: string; unidade: string; quantidade: string; bdi_perfil_id: string | null; bdi_percentual: string }>(
    `SELECT item_referencia_id, codigo, unidade, quantidade::text, bdi_perfil_id, bdi_percentual::text FROM item_orcamento WHERE id = $1 AND revisao_id = $2`,
    [itemId, revisaoId],
  );
  if (!i) throw new ErroOrcamento("Item não encontrado nesta revisão.");
  if (i.item_referencia_id === novoItemReferenciaId) return versao;
  const r = await dadosRevisao(ex, revisaoId);
  const { preco, base } = await precoParaItem(ex, revisaoId, novoItemReferenciaId, null);
  if (!preco.valor) throw new ErroOrcamento(`O novo código não pode ser orçado nas bases/regimes desta revisão: ${preco.pendencia ?? "sem preço"}`);
  const cab = await cabecalhoItem(ex, novoItemReferenciaId, base?.baseRevisaoId);
  if (!cab) throw new ErroOrcamento("Item não encontrado.");
  const bdi = i.bdi_perfil_id ? i.bdi_percentual : (r.bdi_percentual ?? "0");
  const v = valoresDoItem({ quantidade: i.quantidade, custoReferencia: arredondar(preco.valor, 4), bdi, modo: r.arredondamento, unidade: cab.unidade ?? "", referencia: preco.referencia });
  await ex.transacao([
    ...travarEdicao(revisaoId, versao),
    {
      sql: `UPDATE item_orcamento SET item_referencia_id = $2, base_revisao_id = $3,
                   regime_id = (SELECT g.id FROM regime g JOIN base_mensal b ON b.fonte_id = g.fonte_id JOIN base_revisao br ON br.base_id = b.id WHERE br.id = $3 AND g.codigo = $4),
                   codigo = $5, descricao = $6, unidade = $7, origem_preco = $8, referencia_preco = $9, pendencia = NULL, analitico = NULL
             WHERE id = $1`,
      params: [itemId, novoItemReferenciaId, base?.baseRevisaoId ?? null, base?.regime ?? null, cab.codigo, cab.descricao, cab.unidade ?? "", preco.origem, preco.referencia],
    },
    comandoAtualizarValores([{ id: itemId, ...serializar(v) }]),
    comandoAuditoria({ usuarioId, acao: "ITEM_CODIGO_TROCADO", entidade: "item_orcamento", entidadeId: itemId, antes: { codigo: i.codigo, unidade: i.unidade }, depois: { codigo: cab.codigo, unidade: cab.unidade, custo: v.custoUnitario.toString() } }),
  ]);
  return versao + 1;
}

export async function excluirItem(ex: Executor, revisaoId: string, versao: number, itemId: string, usuarioId: string) {
  await ex.transacao([
    ...travarEdicao(revisaoId, versao),
    { sql: `SELECT imp_exigir(EXISTS (SELECT 1 FROM item_orcamento WHERE id = $1 AND revisao_id = $2), 'Item não encontrado.')`, params: [itemId, revisaoId] },
    { sql: `DELETE FROM item_orcamento WHERE id = $1`, params: [itemId] },
    comandoAuditoria({ usuarioId, acao: "ITEM_EXCLUIDO", entidade: "item_orcamento", entidadeId: itemId }),
  ]);
  return versao + 1;
}

export async function moverItem(ex: Executor, revisaoId: string, versao: number, itemId: string, direcao: -1 | 1, usuarioId: string) {
  const irmaos = await ex.consulta<{ id: string; ordem: number }>(
    `SELECT id, ordem FROM item_orcamento WHERE etapa_id = (SELECT etapa_id FROM item_orcamento WHERE id = $1 AND revisao_id = $2) ORDER BY ordem`,
    [itemId, revisaoId],
  );
  const i = irmaos.findIndex((x) => x.id === itemId);
  const j = i + direcao;
  if (i < 0 || j < 0 || j >= irmaos.length) return versao;
  await ex.transacao([
    ...travarEdicao(revisaoId, versao),
    { sql: `UPDATE item_orcamento SET ordem = $2 WHERE id = $1`, params: [irmaos[i].id, irmaos[j].ordem] },
    { sql: `UPDATE item_orcamento SET ordem = $2 WHERE id = $1`, params: [irmaos[j].id, irmaos[i].ordem] },
    comandoAuditoria({ usuarioId, acao: "ITEM_MOVIDO", entidade: "item_orcamento", entidadeId: itemId }),
  ]);
  return versao + 1;
}

// ---------------------------------------------------------------------------
// Reprecificação (bases padrão) — usada também na atualização de competência
// ---------------------------------------------------------------------------

interface ItemParaPrecificar { id: string; item_referencia_id: string; fonte: string; quantidade: string; custo_unitario: string; bdi_perfil_id: string | null; bdi_percentual: string; unidade: string; referencia_preco: string | null }

async function comandosReprecificar(ex: Executor, revisaoId: string, ctx: ContextoPreco, bdiGlobal: string | null, modo: ModoArredondamento, fontes: string[] | null) {
  const itens = await ex.consulta<ItemParaPrecificar>(
    `SELECT i.id, i.item_referencia_id, f.codigo AS fonte, i.quantidade::text, i.custo_unitario::text, i.bdi_perfil_id, i.bdi_percentual::text, i.unidade, i.referencia_preco
       FROM item_orcamento i JOIN item_referencia ir ON ir.id = i.item_referencia_id JOIN fonte f ON f.id = ir.fonte_id WHERE i.revisao_id = $1`,
    [revisaoId],
  );
  const alvo = itens.filter((i) => !fontes || fontes.includes(i.fonte) || i.fonte === "PROPRIA");
  const precos = await precificar(ex, [...new Set(alvo.map((i) => i.item_referencia_id))], ctx);
  const atualizados: ({ id: string; base: string | null; regime: string | null; origem: string; referencia: string | null } & ReturnType<typeof serializar>)[] = [];
  const pendentes: { id: string; pendencia: string }[] = [];
  for (const i of alvo) {
    const p = precos.get(i.item_referencia_id)!;
    if (!p.valor) {
      pendentes.push({ id: i.id, pendencia: `Preço mantido da referência anterior (${i.referencia_preco ?? "—"}): ${p.pendencia ?? "sem preço na nova base"}` });
      continue;
    }
    const base = i.fonte === "PROPRIA" ? null : ctx.bases.find((b) => b.fonte === i.fonte) ?? null;
    const bdi = i.bdi_perfil_id ? i.bdi_percentual : (bdiGlobal ?? "0");
    const v = valoresDoItem({ quantidade: i.quantidade, custoReferencia: arredondar(p.valor, 4), bdi, modo, unidade: i.unidade, referencia: p.referencia });
    atualizados.push({ id: i.id, base: base?.baseRevisaoId ?? null, regime: base?.regime ?? null, origem: p.origem, referencia: p.referencia, ...serializar(v) });
  }
  const cmds: Comando[] = [];
  if (atualizados.length) {
    cmds.push(comandoAtualizarValores(atualizados));
    cmds.push({
      sql: `UPDATE item_orcamento i SET base_revisao_id = x.base::uuid,
                   regime_id = (SELECT g.id FROM regime g JOIN base_mensal b ON b.fonte_id = g.fonte_id JOIN base_revisao br ON br.base_id = b.id WHERE br.id = x.base::uuid AND g.codigo = x.regime),
                   origem_preco = x.origem, referencia_preco = x.referencia, pendencia = NULL
              FROM jsonb_to_recordset($1::jsonb) AS x(id uuid, base text, regime text, origem text, referencia text) WHERE i.id = x.id`,
      params: [json(atualizados.map((a) => ({ id: a.id, base: a.base, regime: a.regime, origem: a.origem, referencia: a.referencia })))],
    });
  }
  if (pendentes.length) {
    cmds.push({ sql: `UPDATE item_orcamento i SET pendencia = x.pendencia FROM jsonb_to_recordset($1::jsonb) AS x(id uuid, pendencia text) WHERE i.id = x.id`, params: [json(pendentes)] });
  }
  return { cmds, atualizados: atualizados.length, pendentes: pendentes.length };
}

/** Reprecifica todos os itens com as bases padrão atuais da revisão (ou só as fontes indicadas). */
export async function reprecificarRevisao(ex: Executor, revisaoId: string, versao: number, usuarioId: string, fontes: string[] | null = null) {
  const r = await dadosRevisao(ex, revisaoId);
  const ctx = await contextoDaRevisao(ex, revisaoId);
  const rep = await comandosReprecificar(ex, revisaoId, ctx, r.bdi_percentual, r.arredondamento, fontes);
  await ex.transacao([
    ...travarEdicao(revisaoId, versao),
    ...rep.cmds,
    comandoAuditoria({ usuarioId, acao: "REVISAO_REPRECIFICADA", entidade: "orcamento_revisao", entidadeId: revisaoId, depois: { atualizados: rep.atualizados, pendentes: rep.pendentes } }),
  ]);
  return { versao: versao + 1, atualizados: rep.atualizados, pendentes: rep.pendentes };
}

// ---------------------------------------------------------------------------
// Fechamento
// ---------------------------------------------------------------------------

export async function fecharRevisao(ex: Executor, revisaoId: string, versao: number, usuarioId: string) {
  const estado = await carregarRevisao(ex, revisaoId);
  if (estado.revisao.status !== "EM_ELABORACAO") throw new ErroOrcamento("Revisão já fechada.");
  if (estado.itens.length === 0) throw new ErroOrcamento("Não é possível fechar um orçamento sem itens.");
  // snapshot analítico de cada item (composições oficiais publicadas ou próprias)
  const ctx = await contextoDaRevisao(ex, revisaoId);
  const analiticos: { id: string; analitico: unknown }[] = [];
  for (const it of estado.itens) {
    if (it.tipo !== "COMPOSICAO") { analiticos.push({ id: it.id, analitico: { tipo: "INSUMO", referencia: it.referenciaPreco } }); continue; }
    let linhas = null as Awaited<ReturnType<typeof linhasDaVersao>> | null;
    let tipo = "SEM_ANALITICA";
    let ctxItem = ctx;
    if (it.fonte !== "PROPRIA" && it.baseRevisaoId) {
      ctxItem = { ...ctx, bases: [...ctx.bases.filter((b) => b.fonte !== it.fonte), { fonte: it.fonte, baseRevisaoId: it.baseRevisaoId, regime: it.regime }] };
      const a = await analiticaOficial(ex, it.itemReferenciaId, it.baseRevisaoId, it.regime);
      if (a) { linhas = a.linhas; tipo = "OFICIAL"; }
    } else if (it.fonte === "PROPRIA") {
      const [p] = await ex.consulta<{ cv: string | null }>(`SELECT composicao_versao_id AS cv FROM item_proprio WHERE item_id = $1`, [it.itemReferenciaId]);
      if (p?.cv) { linhas = await linhasDaVersao(ex, p.cv, null); tipo = "PROPRIA"; }
    }
    if (!linhas) { analiticos.push({ id: it.id, analitico: { tipo, referencia: it.referenciaPreco } }); continue; }
    const precos = await precificar(ex, linhas.map((l) => l.itemId), ctxItem);
    analiticos.push({
      id: it.id,
      analitico: {
        tipo, referencia: it.referenciaPreco,
        linhas: linhas.map((l) => {
          const p = precos.get(l.itemId);
          const custo = p?.valor ? dec(l.coeficiente).times(p.valor).times(dec(1).plus(dec(l.percentual ?? 0).div(100))) : null;
          return { ordem: l.ordem, fonte: l.fonte, tipo: l.tipoOriginal ?? l.tipo, codigo: l.codigo, descricao: l.descricao, unidade: l.unidade, coeficiente: l.coeficiente, percentual: l.percentual, precoUnitario: p?.valor?.toString() ?? null, referenciaPreco: p?.referencia ?? null, custo: custo?.toString() ?? null };
        }),
      },
    });
  }
  await ex.transacao([
    ...travarEdicao(revisaoId, versao),
    { sql: `UPDATE item_orcamento i SET analitico = x.analitico FROM jsonb_to_recordset($1::jsonb) AS x(id uuid, analitico jsonb) WHERE i.id = x.id`, params: [json(analiticos)] },
    {
      sql: `UPDATE orcamento_revisao SET status = 'FECHADA', fechada_em = now(), fechada_por_id = $2,
                   total_custo_direto = (SELECT coalesce(sum(custo_total), 0) FROM item_orcamento WHERE revisao_id = $1),
                   total_geral = (SELECT coalesce(sum(preco_total), 0) FROM item_orcamento WHERE revisao_id = $1)
             WHERE id = $1`,
      params: [revisaoId, usuarioId],
    },
    comandoAuditoria({ usuarioId, acao: "REVISAO_FECHADA", entidade: "orcamento_revisao", entidadeId: revisaoId, depois: { total: estado.totais.total, custoDireto: estado.totais.custoDireto, itens: estado.itens.length } }),
  ]);
}

// ---------------------------------------------------------------------------
// Nova revisão (com ou sem atualização de competência) e duplicação
// ---------------------------------------------------------------------------

function comandosCopiar(origemId: string, destinoId: string): Comando[] {
  // mapeamento de etapas antigas → novas preservando a árvore
  return [
    { sql: `CREATE TEMP TABLE tmp_mapa_etapa ON COMMIT DROP AS SELECT id AS antigo, gen_random_uuid() AS novo FROM etapa WHERE revisao_id = $1`, params: [origemId] },
    {
      // insere por nível da árvore (mãe antes das filhas)
      sql: `WITH RECURSIVE niveis AS (
              SELECT id, 0 AS nivel FROM etapa WHERE revisao_id = $1 AND pai_id IS NULL
              UNION ALL SELECT e.id, n.nivel + 1 FROM etapa e JOIN niveis n ON e.pai_id = n.id)
            INSERT INTO etapa (id, revisao_id, pai_id, ordem, titulo)
            SELECT m.novo, $2, mp.novo, e.ordem, e.titulo FROM etapa e JOIN niveis n ON n.id = e.id
              JOIN tmp_mapa_etapa m ON m.antigo = e.id LEFT JOIN tmp_mapa_etapa mp ON mp.antigo = e.pai_id
             ORDER BY n.nivel`,
      params: [origemId, destinoId],
    },
    {
      sql: `INSERT INTO item_orcamento (revisao_id, etapa_id, ordem, item_referencia_id, base_revisao_id, regime_id, codigo, descricao, unidade, quantidade,
                                        custo_unitario, bdi_perfil_id, bdi_percentual, preco_unitario, preco_total, custo_total, origem_preco, referencia_preco, pendencia, memoria_calculo, memoria_quantitativo)
            SELECT $2, m.novo, i.ordem, i.item_referencia_id, i.base_revisao_id, i.regime_id, i.codigo, i.descricao, i.unidade, i.quantidade,
                   i.custo_unitario, i.bdi_perfil_id, i.bdi_percentual, i.preco_unitario, i.preco_total, i.custo_total, i.origem_preco, i.referencia_preco, i.pendencia, i.memoria_calculo, i.memoria_quantitativo
              FROM item_orcamento i JOIN tmp_mapa_etapa m ON m.antigo = i.etapa_id WHERE i.revisao_id = $1`,
      params: [origemId, destinoId],
    },
    {
      sql: `INSERT INTO cronograma_parcela (revisao_id, etapa_id, periodo, percentual)
            SELECT $2, m.novo, c.periodo, c.percentual FROM cronograma_parcela c JOIN tmp_mapa_etapa m ON m.antigo = c.etapa_id WHERE c.revisao_id = $1`,
      params: [origemId, destinoId],
    },
  ];
}

export async function novaRevisao(
  ex: Executor, origemId: string,
  d: { descricao: string; novasBases?: { baseRevisaoId: string; regime: string | null }[] | null },
  usuarioId: string,
) {
  const [o] = await ex.consulta<{ orcamento_id: string; abertas: number; proximo: number; bdi_perfil_id: string | null; bdi_percentual: string | null; arredondamento: ModoArredondamento; data_referencia: string }>(
    `SELECT r.orcamento_id, (SELECT count(*)::int FROM orcamento_revisao x WHERE x.orcamento_id = r.orcamento_id AND x.status = 'EM_ELABORACAO') AS abertas,
            (SELECT max(numero) + 1 FROM orcamento_revisao x WHERE x.orcamento_id = r.orcamento_id) AS proximo,
            r.bdi_perfil_id, r.bdi_percentual::text, r.arredondamento::text AS arredondamento, to_char(r.data_referencia, 'YYYY-MM-DD') AS data_referencia
       FROM orcamento_revisao r WHERE r.id = $1`,
    [origemId],
  );
  if (!o) throw new ErroOrcamento("Revisão de origem não encontrada.");
  if (o.abertas > 0) throw new ErroOrcamento("Já existe uma revisão em elaboração neste orçamento. Feche-a antes de criar outra.");
  if (d.novasBases) await validarBases(ex, d.novasBases);
  const destinoId = crypto.randomUUID();
  const basesOrigem = await basesDaRevisao(ex, origemId);
  // bases padrão da nova revisão: as novas (quando informadas) + as da origem para as demais fontes
  const novas = d.novasBases ?? [];
  const fontesNovas = novas.length ? (await ex.consulta<{ id: string; fonte: string }>(
    `SELECT r.id, f.codigo AS fonte FROM base_revisao r JOIN base_mensal b ON b.id = r.base_id JOIN fonte f ON f.id = b.fonte_id WHERE r.id = ANY($1::uuid[])`, [novas.map((n) => n.baseRevisaoId)],
  )) : [];
  const basesFinais = [
    ...novas,
    ...basesOrigem.filter((b) => !fontesNovas.some((f) => f.fonte === b.fonte)).map((b) => ({ baseRevisaoId: b.baseRevisaoId, regime: b.regime })),
  ];
  const cmds: Comando[] = [
    {
      sql: `INSERT INTO orcamento_revisao (id, orcamento_id, numero, descricao, bdi_perfil_id, bdi_percentual, arredondamento, data_referencia, revisao_origem_id, criado_por_id)
            VALUES ($1, $2, $3, $4, $5, $6::numeric, $7::"Arredondamento", $8::date, $9, $10)`,
      params: [destinoId, o.orcamento_id, o.proximo, d.descricao.trim() || null, o.bdi_perfil_id, o.bdi_percentual, o.arredondamento, novas.length ? new Date().toISOString().slice(0, 10) : o.data_referencia, origemId, usuarioId],
    },
    ...comandosCopiar(origemId, destinoId),
  ];
  // bases padrão: as da origem podem já estar SUBSTITUÍDAS (o banco permite); as NOVAS foram validadas como publicadas
  cmds.push(
    ...comandosBasesPadrao(destinoId, basesFinais),
    comandoAuditoria({ usuarioId, acao: "REVISAO_CRIADA", entidade: "orcamento_revisao", entidadeId: destinoId, depois: { origem: origemId, novasBases: novas } }),
  );
  await ex.transacao(cmds);
  let resumo = { atualizados: 0, pendentes: 0 };
  if (novas.length) {
    const r = await reprecificarRevisao(ex, destinoId, 1, usuarioId, fontesNovas.map((f) => f.fonte));
    resumo = { atualizados: r.atualizados, pendentes: r.pendentes };
  }
  return { revisaoId: destinoId, numero: o.proximo, ...resumo };
}

export async function duplicarOrcamento(ex: Executor, revisaoId: string, d: { titulo: string; obraId?: string | null }, usuarioId: string) {
  const [o] = await ex.consulta<{ obra_id: string; codigo: string | null; bdi_perfil_id: string | null; bdi_percentual: string | null; arredondamento: string; data_referencia: string }>(
    `SELECT oc.obra_id, oc.codigo, r.bdi_perfil_id, r.bdi_percentual::text, r.arredondamento::text, to_char(r.data_referencia, 'YYYY-MM-DD') AS data_referencia
       FROM orcamento_revisao r JOIN orcamento oc ON oc.id = r.orcamento_id WHERE r.id = $1`,
    [revisaoId],
  );
  if (!o) throw new ErroOrcamento("Revisão não encontrada.");
  if (d.titulo.trim().length < 2) throw new ErroOrcamento("Informe o título da cópia.");
  const bases = await basesDaRevisao(ex, revisaoId);
  const orcamentoId = crypto.randomUUID();
  const novaId = crypto.randomUUID();
  await ex.transacao([
    { sql: `INSERT INTO orcamento (id, obra_id, codigo, titulo) VALUES ($1, $2, $3, $4)`, params: [orcamentoId, d.obraId ?? o.obra_id, null, d.titulo.trim()] },
    {
      sql: `INSERT INTO orcamento_revisao (id, orcamento_id, numero, descricao, bdi_perfil_id, bdi_percentual, arredondamento, data_referencia, criado_por_id)
            VALUES ($1, $2, 1, $3, $4, $5::numeric, $6::"Arredondamento", $7::date, $8)`,
      params: [novaId, orcamentoId, `Cópia da revisão ${revisaoId.slice(0, 8)}`, o.bdi_perfil_id, o.bdi_percentual, o.arredondamento, o.data_referencia, usuarioId],
    },
    ...comandosCopiar(revisaoId, novaId),
    ...comandosBasesPadrao(novaId, bases.map((b) => ({ baseRevisaoId: b.baseRevisaoId, regime: b.regime }))),
    comandoAuditoria({ usuarioId, acao: "ORCAMENTO_DUPLICADO", entidade: "orcamento", entidadeId: orcamentoId, depois: { origem: revisaoId } }),
  ]);
  return { orcamentoId, revisaoId: novaId };
}

// ---------------------------------------------------------------------------
// Comparação de revisões
// ---------------------------------------------------------------------------

export interface LinhaComparacao {
  chave: string;
  codigo: string;
  fonte: string;
  descricao: string;
  unidade: string;
  etapa: string;
  a: { quantidade: string; precoUnitario: string; precoTotal: string; referencia: string | null } | null;
  b: { quantidade: string; precoUnitario: string; precoTotal: string; referencia: string | null } | null;
  diferenca: string;
  situacao: "INCLUIDO" | "EXCLUIDO" | "ALTERADO" | "IGUAL";
}

export async function compararRevisoes(ex: Executor, revisaoA: string, revisaoB: string) {
  const [ea, eb] = await Promise.all([carregarRevisao(ex, revisaoA), carregarRevisao(ex, revisaoB)]);
  if (ea.orcamento.id !== eb.orcamento.id) throw new ErroOrcamento("As revisões devem ser do mesmo orçamento.");
  const tituloEtapa = (e: EstadoRevisao, id: string) => {
    const et = e.etapas.find((x) => x.id === id);
    return et ? `${et.numero} ${et.titulo}` : "";
  };
  // chave: item de referência + título da etapa + ocorrência (um mesmo serviço pode aparecer mais de uma vez)
  const chaves = (e: EstadoRevisao) => {
    const cont = new Map<string, number>();
    return e.itens.map((it) => {
      const base = `${it.itemReferenciaId}|${e.etapas.find((x) => x.id === it.etapaId)?.titulo ?? ""}`;
      const n = (cont.get(base) ?? 0) + 1;
      cont.set(base, n);
      return { k: `${base}|${n}`, it, etapa: tituloEtapa(e, it.etapaId) };
    });
  };
  const ca = chaves(ea);
  const cb = chaves(eb);
  const linhas: LinhaComparacao[] = [];
  const val = (it: LinhaItem) => ({ quantidade: it.quantidade, precoUnitario: it.precoUnitario, precoTotal: it.precoTotal, referencia: it.referenciaPreco });
  for (const x of ca) {
    const y = cb.find((z) => z.k === x.k);
    const a = val(x.it);
    const b = y ? val(y.it) : null;
    const dif = dec(b?.precoTotal ?? 0).minus(a.precoTotal);
    const igual = b && dec(a.quantidade).eq(b.quantidade) && dec(a.precoUnitario).eq(b.precoUnitario);
    linhas.push({ chave: x.k, codigo: x.it.codigo, fonte: x.it.fonte, descricao: x.it.descricao, unidade: x.it.unidade, etapa: y?.etapa ?? x.etapa, a, b, diferenca: dif.toFixed(2), situacao: !b ? "EXCLUIDO" : igual ? "IGUAL" : "ALTERADO" });
  }
  for (const y of cb) {
    if (ca.some((x) => x.k === y.k)) continue;
    linhas.push({ chave: y.k, codigo: y.it.codigo, fonte: y.it.fonte, descricao: y.it.descricao, unidade: y.it.unidade, etapa: y.etapa, a: null, b: val(y.it), diferenca: dec(y.it.precoTotal).toFixed(2), situacao: "INCLUIDO" });
  }
  return {
    a: { id: revisaoA, numero: ea.revisao.numero, status: ea.revisao.status, total: ea.totais.total, bases: ea.basesPadrao },
    b: { id: revisaoB, numero: eb.revisao.numero, status: eb.revisao.status, total: eb.totais.total, bases: eb.basesPadrao },
    diferencaTotal: dec(eb.totais.total).minus(ea.totais.total).toFixed(2),
    linhas,
  };
}
