/**
 * Medições do contrato.
 *
 * Planejamento: quantidade de medições e período de cada uma.
 *  - Serviço contínuo (contrato anual): períodos mensais "dia a dia" — começa
 *    em 10/10/2026 e termina em 09/11/2026; a seguinte, de 10/11 a 09/12...
 *  - Demais objetos: períodos de até 30 dias corridos, definidos pelo usuário
 *    (ex.: 10 medições de 30 dias); cada período pode ser ajustado depois.
 *
 * Lançamento (conforme o regime de execução do contrato):
 *  - Empreitada por preço unitário: quantidade medida de cada item
 *    (valor = quantidade × preço contratado);
 *  - demais regimes: percentual executado de cada item (valor = % × total do item).
 * O acumulado nunca passa do contratado; ao completar o item, o valor fecha a
 * diferença de arredondamento (a soma das medições = valor contratado do item).
 *
 * Uma medição por vez em elaboração, na ordem; medição fechada é imutável no
 * banco (gatilho) e só a última fechada pode ser reaberta (criador/administrador).
 */
import type { Comando, Executor } from "@/lib/banco/executor";
import { arredondar, dec, formatarNumero, lerNumero, type Dec, type ModoArredondamento } from "@/lib/calculo/decimal";
import { comandoAuditoria } from "@/lib/auditoria";
import { somarDias } from "@/lib/contratos/prazos";
import { diasEntre, gerarPeriodos, MAX_DIAS } from "./periodos";

export { diasEntre, gerarPeriodos, MAX_DIAS, somarMeses, type Periodo } from "./periodos";

export class ErroMedicao extends Error {}

const LIBERAR_FECHADA: Comando = { sql: `SELECT set_config('medicao.liberar_fechada', 'on', true)` };

const dataBr = (d: string) => d.split("-").reverse().join("/");
const reData = /^\d{4}-\d{2}-\d{2}$/;

// ---------------------------------------------------------------------------
// Contrato (dados usados pelas medições)
// ---------------------------------------------------------------------------

interface ContratoMed {
  id: string; situacao: string; continuo: boolean; arredondamento: ModoArredondamento; dataOs: string | null; criadoPorId: string | null;
  regimeNome: string | null; medicao: "QUANTIDADE" | "PERCENTUAL" | null;
}

async function contratoDe(ex: Executor, contratoId: string): Promise<ContratoMed> {
  const [c] = await ex.consulta<ContratoMed>(
    `SELECT c.id, c.situacao, c.servico_continuo AS continuo, c.arredondamento, c.data_os::text AS "dataOs", c.criado_por_id AS "criadoPorId",
            r.nome AS "regimeNome", r.medicao
       FROM contrato c LEFT JOIN regime_execucao r ON r.id = c.regime_id WHERE c.id = $1`, [contratoId],
  );
  if (!c) throw new ErroMedicao("Contrato não encontrado.");
  return c;
}

interface MedicaoLinha { id: string; contratoId: string; numero: number; inicio: string; fim: string; situacao: "PREVISTA" | "EM_ELABORACAO" | "FECHADA"; versao: number }

async function medicoesDe(ex: Executor, contratoId: string): Promise<MedicaoLinha[]> {
  return ex.consulta<MedicaoLinha>(
    `SELECT id, contrato_id AS "contratoId", numero, inicio::text, fim::text, situacao, versao FROM medicao WHERE contrato_id = $1 ORDER BY numero`, [contratoId],
  );
}

async function medicaoDe(ex: Executor, medicaoId: string): Promise<MedicaoLinha> {
  const [m] = await ex.consulta<MedicaoLinha>(
    `SELECT id, contrato_id AS "contratoId", numero, inicio::text, fim::text, situacao, versao FROM medicao WHERE id = $1`, [medicaoId],
  );
  if (!m) throw new ErroMedicao("Medição não encontrada.");
  return m;
}

const aud = (usuarioId: string, acao: string, id: string, depois?: unknown) => comandoAuditoria({ usuarioId, acao, entidade: "medicao", entidadeId: id, depois });

// ---------------------------------------------------------------------------
// Planejamento
// ---------------------------------------------------------------------------

/**
 * Planeja (ou replaneja) as medições. As já iniciadas ou fechadas são
 * mantidas; as previstas são refeitas a partir do dia seguinte ao fim da
 * última iniciada (ou da data de início informada, se nenhuma foi iniciada).
 * `quantidade` = total de medições do contrato.
 */
export async function planejarMedicoes(
  ex: Executor, contratoId: string, d: { inicio: string; quantidade: number; dias?: number | null; servicoContinuo: boolean }, usuarioId: string,
) {
  await contratoDe(ex, contratoId);
  if (!Number.isInteger(d.quantidade) || d.quantidade < 1 || d.quantidade > 240) throw new ErroMedicao("Quantidade de medições deve ser de 1 a 240.");
  const dias = d.servicoContinuo ? 0 : d.dias ?? MAX_DIAS;
  if (!d.servicoContinuo && (!Number.isInteger(dias) || dias < 1 || dias > MAX_DIAS)) throw new ErroMedicao(`O período de cada medição deve ser de 1 a ${MAX_DIAS} dias corridos.`);
  const existentes = await medicoesDe(ex, contratoId);
  const iniciadas = existentes.filter((m) => m.situacao !== "PREVISTA");
  if (d.quantidade < iniciadas.length) throw new ErroMedicao(`Já há ${iniciadas.length} medição(ões) iniciada(s) ou fechada(s): a quantidade não pode ser menor.`);
  const ultima = iniciadas[iniciadas.length - 1];
  const inicio = ultima ? somarDias(ultima.fim, 1) : d.inicio;
  if (!reData.test(inicio)) throw new ErroMedicao("Informe a data de início da primeira medição.");
  const periodos = gerarPeriodos(inicio, d.quantidade - iniciadas.length, d.servicoContinuo, dias);
  await ex.transacao([
    { sql: `UPDATE contrato SET servico_continuo = $2, atualizado_em = now() WHERE id = $1`, params: [contratoId, d.servicoContinuo] },
    { sql: `DELETE FROM medicao WHERE contrato_id = $1 AND situacao = 'PREVISTA'`, params: [contratoId] },
    ...(periodos.length ? [{
      sql: `INSERT INTO medicao (contrato_id, numero, inicio, fim)
            SELECT $1, x.numero, x.inicio::date, x.fim::date FROM jsonb_to_recordset($2::jsonb) AS x(numero int, inicio text, fim text)`,
      params: [contratoId, JSON.stringify(periodos.map((p, k) => ({ numero: iniciadas.length + k + 1, ...p })))],
    }] : []),
    comandoAuditoria({ usuarioId, acao: "MEDICOES_PLANEJADAS", entidade: "contrato", entidadeId: contratoId, depois: { quantidade: d.quantidade, inicio, dias: d.servicoContinuo ? "mensal" : dias } }),
  ]);
}

/**
 * Ajusta o fim de uma medição (não fechada) de contrato não contínuo; as
 * previstas seguintes são deslocadas, mantendo a duração de cada uma.
 */
export async function alterarPeriodo(ex: Executor, medicaoId: string, fim: string, usuarioId: string) {
  const m = await medicaoDe(ex, medicaoId);
  const c = await contratoDe(ex, m.contratoId);
  if (c.continuo) throw new ErroMedicao("Em serviço contínuo os períodos são mensais (dia a dia); para mudar, refaça o planejamento.");
  if (m.situacao === "FECHADA") throw new ErroMedicao("Medição fechada não pode ser alterada.");
  if (!reData.test(fim)) throw new ErroMedicao("Data de fim inválida.");
  const dias = diasEntre(m.inicio, fim);
  if (dias < 1) throw new ErroMedicao("O fim não pode ser anterior ao início da medição.");
  if (dias > MAX_DIAS) throw new ErroMedicao(`Cada medição tem no máximo ${MAX_DIAS} dias corridos (este período teria ${dias}).`);
  const seguintes = (await medicoesDe(ex, m.contratoId)).filter((x) => x.numero > m.numero);
  if (seguintes.some((x) => x.situacao !== "PREVISTA")) throw new ErroMedicao("Há medição seguinte já iniciada: o período não pode mudar.");
  let proximo = somarDias(fim, 1);
  const novos = seguintes.map((x) => {
    const dur = diasEntre(x.inicio, x.fim);
    const p = { id: x.id, inicio: proximo, fim: somarDias(proximo, dur - 1) };
    proximo = somarDias(p.fim, 1);
    return p;
  });
  await ex.transacao([
    { sql: `UPDATE medicao SET fim = $2, versao = versao + 1, atualizado_em = now() WHERE id = $1`, params: [medicaoId, fim] },
    ...(novos.length ? [{
      sql: `UPDATE medicao m SET inicio = x.inicio::date, fim = x.fim::date, atualizado_em = now() FROM jsonb_to_recordset($1::jsonb) AS x(id uuid, inicio text, fim text) WHERE m.id = x.id`,
      params: [JSON.stringify(novos)],
    }] : []),
    aud(usuarioId, "MEDICAO_PERIODO_ALTERADO", medicaoId, { fim, dias }),
  ]);
}

/** Acrescenta uma medição prevista ao fim (mensal no contínuo; senão com a duração da última, até 30 dias). */
export async function acrescentarMedicao(ex: Executor, contratoId: string, usuarioId: string) {
  const c = await contratoDe(ex, contratoId);
  const ms = await medicoesDe(ex, contratoId);
  const ultima = ms[ms.length - 1];
  if (!ultima) throw new ErroMedicao("Planeje as medições antes de acrescentar.");
  const inicio = somarDias(ultima.fim, 1);
  const [p] = gerarPeriodos(inicio, 1, c.continuo, Math.min(MAX_DIAS, diasEntre(ultima.inicio, ultima.fim)));
  await ex.transacao([
    { sql: `INSERT INTO medicao (contrato_id, numero, inicio, fim) VALUES ($1, $2, $3, $4)`, params: [contratoId, ultima.numero + 1, p.inicio, p.fim] },
    comandoAuditoria({ usuarioId, acao: "MEDICAO_ACRESCENTADA", entidade: "contrato", entidadeId: contratoId, depois: { numero: ultima.numero + 1, ...p } }),
  ]);
}

/** Exclui a última medição, se ainda só prevista. */
export async function excluirUltimaPrevista(ex: Executor, contratoId: string, usuarioId: string) {
  const ms = await medicoesDe(ex, contratoId);
  const ultima = ms[ms.length - 1];
  if (!ultima || ultima.situacao !== "PREVISTA") throw new ErroMedicao("Só a última medição, ainda prevista, pode ser excluída.");
  await ex.transacao([
    { sql: `DELETE FROM medicao WHERE id = $1 AND situacao = 'PREVISTA'`, params: [ultima.id] },
    comandoAuditoria({ usuarioId, acao: "MEDICAO_EXCLUIDA", entidade: "contrato", entidadeId: contratoId, antes: { numero: ultima.numero } }),
  ]);
}

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

export interface ResumoMedicao extends MedicaoLinha { dias: number; valor: string; acumulado: string; fechadaEm: string | null; fechadaPor: string | null }

export interface PainelMedicoes {
  contrato: { id: string; numero: string; objeto: string; situacao: string; continuo: boolean; dataOs: string | null; regimeNome: string | null; medicao: "QUANTIDADE" | "PERCENTUAL" | null; total: string; prazoExecucaoDias: number | null; prazoVigenciaDias: number | null; criadoPorId: string | null };
  medicoes: ResumoMedicao[];
  totais: { medido: string; percentual: string; saldo: string };
}

export async function painelMedicoes(ex: Executor, contratoId: string): Promise<PainelMedicoes> {
  const c = await contratoDe(ex, contratoId);
  const [info] = await ex.consulta<{ numero: string; objeto: string; total: string; prazoExecucaoDias: number | null; prazoVigenciaDias: number | null }>(
    `SELECT numero, objeto, prazo_execucao_dias AS "prazoExecucaoDias", prazo_vigencia_dias AS "prazoVigenciaDias", (SELECT coalesce(sum(valor_total), 0)::text FROM contrato_item WHERE contrato_id = c.id) AS total FROM contrato c WHERE id = $1`, [contratoId],
  );
  const ms = await ex.consulta<Omit<ResumoMedicao, "dias" | "acumulado">>(
    `SELECT m.id, m.contrato_id AS "contratoId", m.numero, m.inicio::text, m.fim::text, m.situacao, m.versao,
            (SELECT coalesce(sum(i.valor), 0)::text FROM medicao_item i WHERE i.medicao_id = m.id) AS valor,
            to_char(m.fechada_em AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') AS "fechadaEm", u.nome AS "fechadaPor"
       FROM medicao m LEFT JOIN usuario u ON u.id = m.fechada_por_id WHERE m.contrato_id = $1 ORDER BY m.numero`, [contratoId],
  );
  let acc = dec(0);
  const medicoes = ms.map((m) => {
    if (m.situacao === "FECHADA") acc = acc.plus(m.valor);
    return { ...m, dias: diasEntre(m.inicio, m.fim), acumulado: acc.toFixed(2) };
  });
  const total = dec(info.total);
  return {
    contrato: { id: c.id, numero: info.numero, objeto: info.objeto, situacao: c.situacao, continuo: c.continuo, dataOs: c.dataOs, regimeNome: c.regimeNome, medicao: c.medicao, total: total.toFixed(2),
      prazoExecucaoDias: info.prazoExecucaoDias, prazoVigenciaDias: info.prazoVigenciaDias, criadoPorId: c.criadoPorId },
    medicoes,
    totais: { medido: acc.toFixed(2), percentual: total.isZero() ? "0" : acc.div(total).times(100).toDecimalPlaces(4).toString(), saldo: total.minus(acc).toFixed(2) },
  };
}

export interface LinhaMedicao {
  itemId: string; grupoId: string; numero: string | null; codigo: string | null; descricao: string; unidade: string | null;
  quantidade: string; precoUnitario: string; valorTotal: string;
  /** medições fechadas anteriores a esta */
  anteriorQtd: string; anteriorPct: string; anteriorValor: string;
  /** esta medição (null = não lançado) */
  atualQtd: string | null; atualPct: string | null; atualValor: string;
}

export interface EstadoMedicao {
  medicao: MedicaoLinha & { dias: number; fechadaEm: string | null; fechadaPor: string | null; observacao: string | null };
  contrato: PainelMedicoes["contrato"] & { arredondamento: ModoArredondamento };
  /** em ordem de exibição (pais antes dos filhos), com numeração e nível */
  grupos: { id: string; paiId: string | null; ordem: number; titulo: string; numero: string; nivel: number }[];
  linhas: LinhaMedicao[];
  totais: { contratado: string; anterior: string; atual: string; acumulado: string; saldo: string; percentualAcumulado: string };
  podeIniciar: string | null;
}

export async function carregarMedicao(ex: Executor, medicaoId: string): Promise<EstadoMedicao> {
  const m = await medicaoDe(ex, medicaoId);
  const painel = await painelMedicoes(ex, m.contratoId);
  const c = await contratoDe(ex, m.contratoId);
  const [extra] = await ex.consulta<{ observacao: string | null; fechadaEm: string | null; fechadaPor: string | null }>(
    `SELECT m.observacao, to_char(m.fechada_em AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') AS "fechadaEm", u.nome AS "fechadaPor"
       FROM medicao m LEFT JOIN usuario u ON u.id = m.fechada_por_id WHERE m.id = $1`, [medicaoId],
  );
  const [gs, linhas] = await Promise.all([
    ex.consulta<{ id: string; paiId: string | null; ordem: number; titulo: string }>(`SELECT id, pai_id AS "paiId", ordem, titulo FROM contrato_grupo WHERE contrato_id = $1`, [m.contratoId]),
    ex.consulta<LinhaMedicao>(
      `SELECT ci.id AS "itemId", ci.grupo_id AS "grupoId", ci.numero, ci.codigo, ci.descricao, ci.unidade,
              ci.quantidade::text, ci.preco_unitario::text AS "precoUnitario", ci.valor_total::text AS "valorTotal",
              coalesce(sum(mi.quantidade) FILTER (WHERE m.numero < $2 AND m.situacao = 'FECHADA'), 0)::text AS "anteriorQtd",
              coalesce(sum(mi.percentual) FILTER (WHERE m.numero < $2 AND m.situacao = 'FECHADA'), 0)::text AS "anteriorPct",
              coalesce(sum(mi.valor) FILTER (WHERE m.numero < $2 AND m.situacao = 'FECHADA'), 0)::text AS "anteriorValor",
              max(mi.quantidade::text) FILTER (WHERE m.id = $3) AS "atualQtd",
              max(mi.percentual::text) FILTER (WHERE m.id = $3) AS "atualPct",
              coalesce(sum(mi.valor) FILTER (WHERE m.id = $3), 0)::text AS "atualValor"
         FROM contrato_item ci
         LEFT JOIN medicao_item mi ON mi.contrato_item_id = ci.id
         LEFT JOIN medicao m ON m.id = mi.medicao_id
        WHERE ci.contrato_id = $1
        GROUP BY ci.id ORDER BY ci.ordem`, [m.contratoId, m.numero, m.id],
    ),
  ]);
  const grupos: EstadoMedicao["grupos"] = [];
  const visitar = (pai: string | null, prefixo: string, nivel: number) => {
    gs.filter((g) => g.paiId === pai).sort((a, b) => a.ordem - b.ordem).forEach((g, k) => {
      const numero = prefixo ? `${prefixo}.${k + 1}` : String(k + 1);
      grupos.push({ ...g, numero, nivel });
      visitar(g.id, numero, nivel + 1);
    });
  };
  visitar(null, "", 0);
  const soma = (f: (l: LinhaMedicao) => string) => linhas.reduce((a, l) => a.plus(f(l)), dec(0));
  const contratado = soma((l) => l.valorTotal);
  const anterior = soma((l) => l.anteriorValor);
  const atual = soma((l) => l.atualValor);
  const acumulado = anterior.plus(atual);
  const ms = await medicoesDe(ex, m.contratoId);
  let podeIniciar: string | null = null;
  if (m.situacao === "PREVISTA") {
    if (c.situacao !== "VIGENTE") podeIniciar = "A planilha do contrato precisa estar confirmada (vigente).";
    else if (!c.medicao) podeIniciar = "Defina o regime de execução do contrato (Dados do contrato › Editar dados).";
    else if (ms.some((x) => x.numero < m.numero && x.situacao !== "FECHADA")) podeIniciar = "Feche as medições anteriores antes de iniciar esta.";
  }
  return {
    medicao: { ...m, dias: diasEntre(m.inicio, m.fim), ...extra },
    contrato: { ...painel.contrato, arredondamento: c.arredondamento },
    grupos, linhas,
    totais: {
      contratado: contratado.toFixed(2), anterior: anterior.toFixed(2), atual: atual.toFixed(2), acumulado: acumulado.toFixed(2),
      saldo: contratado.minus(acumulado).toFixed(2), percentualAcumulado: contratado.isZero() ? "0" : acumulado.div(contratado).times(100).toDecimalPlaces(4).toString(),
    },
    podeIniciar,
  };
}

// ---------------------------------------------------------------------------
// Lançamento
// ---------------------------------------------------------------------------

export async function iniciarMedicao(ex: Executor, medicaoId: string, usuarioId: string) {
  const e = await carregarMedicao(ex, medicaoId);
  if (e.medicao.situacao !== "PREVISTA") throw new ErroMedicao("Esta medição já foi iniciada.");
  if (e.podeIniciar) throw new ErroMedicao(e.podeIniciar);
  await ex.transacao([
    { sql: `UPDATE medicao SET situacao = 'EM_ELABORACAO', versao = versao + 1, atualizado_em = now() WHERE id = $1 AND situacao = 'PREVISTA'`, params: [medicaoId] },
    aud(usuarioId, "MEDICAO_INICIADA", medicaoId, { numero: e.medicao.numero }),
  ]);
}

/**
 * Grava os lançamentos da medição em elaboração. Cada linha traz a
 * quantidade (preço unitário) ou o percentual (demais regimes); vazio ou zero
 * retira o lançamento do item.
 */
export async function salvarLancamentos(ex: Executor, medicaoId: string, versao: number, lancamentos: { itemId: string; valor: string }[], usuarioId: string) {
  const e = await carregarMedicao(ex, medicaoId);
  if (e.medicao.situacao !== "EM_ELABORACAO") throw new ErroMedicao(e.medicao.situacao === "FECHADA" ? "Medição fechada não pode ser alterada." : "Inicie a medição antes de lançar.");
  if (e.medicao.versao !== versao) throw new ErroMedicao("A medição foi alterada por outra pessoa. Recarregue a página.");
  const porQtd = e.contrato.medicao === "QUANTIDADE";
  const linhas = new Map(e.linhas.map((l) => [l.itemId, l]));
  const gravar: { itemId: string; quantidade: string | null; percentual: string | null; valor: string }[] = [];
  const retirar: string[] = [];
  for (const lc of lancamentos) {
    const l = linhas.get(lc.itemId);
    if (!l) throw new ErroMedicao("Item não pertence ao contrato.");
    const rotulo = `item ${l.numero ?? ""}`.trim();
    if (!lc.valor.trim()) { retirar.push(l.itemId); continue; }
    const v = lerNumero(lc.valor);
    if (!v || v.isNegative()) throw new ErroMedicao(`${porQtd ? "Quantidade" : "Percentual"} inválido no ${rotulo}.`);
    if (v.decimalPlaces() > 4) throw new ErroMedicao(`${porQtd ? "Quantidade" : "Percentual"} com no máximo 4 casas decimais (${rotulo}).`);
    if (v.isZero()) { retirar.push(l.itemId); continue; }
    const total = dec(l.valorTotal);
    const antValor = dec(l.anteriorValor);
    let valor: Dec;
    if (porQtd) {
      const acumulada = dec(l.anteriorQtd).plus(v);
      if (acumulada.gt(l.quantidade)) {
        throw new ErroMedicao(`O ${rotulo} passaria do contratado: ${formatarNumero(acumulada, 4)} de ${formatarNumero(l.quantidade, 4)} ${l.unidade ?? ""} (saldo ${formatarNumero(dec(l.quantidade).minus(l.anteriorQtd), 4)}).`.replace(/\s+\)/, ")"));
      }
      // completou o item: fecha a diferença de arredondamento
      valor = acumulada.eq(l.quantidade) ? total.minus(antValor) : arredondar(v.times(l.precoUnitario), 2, e.contrato.arredondamento);
    } else {
      const acumulado = dec(l.anteriorPct).plus(v);
      if (acumulado.gt(100)) throw new ErroMedicao(`O ${rotulo} passaria de 100%: ${formatarNumero(acumulado, 4)}% (saldo ${formatarNumero(dec(100).minus(l.anteriorPct), 4)}%).`);
      valor = acumulado.eq(100) ? total.minus(antValor) : arredondar(total.times(v).div(100), 2, e.contrato.arredondamento);
    }
    if (valor.isNegative()) valor = dec(0);
    gravar.push({ itemId: l.itemId, quantidade: porQtd ? v.toString() : null, percentual: porQtd ? null : v.toString(), valor: valor.toFixed(2) });
  }
  await ex.transacao([
    { sql: `UPDATE medicao SET versao = versao + 1, atualizado_em = now() WHERE id = $1 AND versao = $2`, params: [medicaoId, versao] },
    { sql: `SELECT imp_exigir((SELECT versao FROM medicao WHERE id = $1) = $2, 'A medição foi alterada por outra pessoa. Recarregue a página.')`, params: [medicaoId, versao + 1] },
    ...(retirar.length ? [{ sql: `DELETE FROM medicao_item WHERE medicao_id = $1 AND contrato_item_id = ANY($2::uuid[])`, params: [medicaoId, retirar] }] : []),
    ...(gravar.length ? [{
      sql: `INSERT INTO medicao_item (medicao_id, contrato_item_id, quantidade, percentual, valor)
            SELECT $1, x."itemId", x.quantidade::numeric, x.percentual::numeric, x.valor::numeric
              FROM jsonb_to_recordset($2::jsonb) AS x("itemId" uuid, quantidade text, percentual text, valor text)
            ON CONFLICT (medicao_id, contrato_item_id) DO UPDATE SET quantidade = EXCLUDED.quantidade, percentual = EXCLUDED.percentual, valor = EXCLUDED.valor`,
      params: [medicaoId, JSON.stringify(gravar)],
    }] : []),
    aud(usuarioId, "MEDICAO_LANCADA", medicaoId, { gravados: gravar.length, retirados: retirar.length }),
  ]);
  return versao + 1;
}

export async function fecharMedicao(ex: Executor, medicaoId: string, versao: number, observacao: string | null, usuarioId: string) {
  const e = await carregarMedicao(ex, medicaoId);
  if (e.medicao.situacao !== "EM_ELABORACAO") throw new ErroMedicao("Só a medição em elaboração pode ser fechada.");
  if (e.medicao.versao !== versao) throw new ErroMedicao("A medição foi alterada por outra pessoa. Recarregue a página.");
  const obs = (observacao ?? "").trim().slice(0, 2000) || null;
  await ex.transacao([
    { sql: `UPDATE medicao SET situacao = 'FECHADA', observacao = $3, fechada_em = now(), fechada_por_id = $4, versao = versao + 1, atualizado_em = now() WHERE id = $1 AND versao = $2`, params: [medicaoId, versao, obs, usuarioId] },
    aud(usuarioId, "MEDICAO_FECHADA", medicaoId, { numero: e.medicao.numero, valor: e.totais.atual, acumulado: e.totais.acumulado }),
  ]);
}

/** Reabre a última medição fechada (criador do contrato ou administrador). */
export async function reabrirMedicao(ex: Executor, medicaoId: string, u: { id: string; administrador: boolean }) {
  const m = await medicaoDe(ex, medicaoId);
  const c = await contratoDe(ex, m.contratoId);
  if (!u.administrador && c.criadoPorId !== u.id) throw new ErroMedicao("Só quem cadastrou o contrato (ou o administrador) pode reabrir medição.");
  if (m.situacao !== "FECHADA") throw new ErroMedicao("A medição não está fechada.");
  const ms = await medicoesDe(ex, m.contratoId);
  if (ms.some((x) => x.numero > m.numero && x.situacao !== "PREVISTA")) throw new ErroMedicao("Só a última medição fechada pode ser reaberta (há medição seguinte iniciada).");
  await ex.transacao([
    LIBERAR_FECHADA,
    { sql: `UPDATE medicao SET situacao = 'EM_ELABORACAO', fechada_em = NULL, fechada_por_id = NULL, versao = versao + 1, atualizado_em = now() WHERE id = $1`, params: [medicaoId] },
    aud(u.id, "MEDICAO_REABERTA", medicaoId, { numero: m.numero }),
  ]);
}

export { dataBr };
