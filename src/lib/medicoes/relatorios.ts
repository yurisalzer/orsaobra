/**
 * Documentos da medição (modelo da Prefeitura de Macaé):
 *
 * Boletim de medição — planilha contratual com, por item:
 *   Quantitativos: Antes (saldo antes desta medição), Medido (nesta), Saldo (depois);
 *   Valores: Medido (nesta) e Saldo; % Medido (acumulado executado do item).
 *   Nos regimes medidos por percentual, os "quantitativos" são percentuais do item.
 *
 * Cronograma de desembolso — etapas principais × períodos de medição:
 *   realizado = medições fechadas até a medição escolhida;
 *   previsto  = períodos seguintes, conforme o cronograma salvo pelo usuário
 *               (sugestão: cronograma do orçamento de origem ou distribuição
 *               uniforme), ajustado para cada etapa fechar exatamente 100%.
 */
import type { Executor } from "@/lib/banco/executor";
import { arredondar, dec, lerNumero, type Dec } from "@/lib/calculo/decimal";
import { comandoAuditoria } from "@/lib/auditoria";
import { termino } from "@/lib/contratos/prazos";
import { cabecalhoDaObra, type CabecalhoDocumento } from "@/lib/relatorios/cabecalhos";
import { carregarMedicao, diasEntre, ErroMedicao } from "./servico";

const pct = (parte: Dec, total: Dec) => (total.isZero() ? dec(0) : parte.div(total).times(100));
const p2 = (v: Dec) => arredondar(v, 2, "ARREDONDAR").toFixed(2);

interface DadosContrato {
  id: string; numero: string; objeto: string; empresa: string | null; cnpj: string | null; processo: string | null;
  dataOs: string | null; prazoExecucaoDias: number | null; responsavelTecnico: string | null; artRrt: string | null;
  obraId: string; obraCodigo: string | null; obraNome: string; revisaoId: string | null; continuo: boolean;
}

async function dadosContrato(ex: Executor, contratoId: string): Promise<DadosContrato> {
  const [c] = await ex.consulta<DadosContrato>(
    `SELECT c.id, c.numero, c.objeto, c.empresa, c.cnpj, c.processo, c.data_os::text AS "dataOs", c.prazo_execucao_dias AS "prazoExecucaoDias",
            c.responsavel_tecnico AS "responsavelTecnico", c.art_rrt AS "artRrt", c.obra_id AS "obraId", o.codigo AS "obraCodigo", o.nome AS "obraNome",
            c.revisao_id AS "revisaoId", c.servico_continuo AS continuo
       FROM contrato c JOIN obra o ON o.id = c.obra_id WHERE c.id = $1`, [contratoId],
  );
  if (!c) throw new ErroMedicao("Contrato não encontrado.");
  return c;
}

// ---------------------------------------------------------------------------
// Boletim de medição
// ---------------------------------------------------------------------------

export type LinhaBoletim =
  | { tipo: "grupo"; nivel: number; numero: string; titulo: string; contratado: string; medido: string; saldo: string; percentual: string }
  | {
      tipo: "item"; numero: string | null; codigo: string | null; descricao: string; unidade: string | null;
      quantidade: string; precoUnitario: string; valorTotal: string;
      antes: string; medido: string; saldo: string; valorMedido: string; valorSaldo: string; percentual: string;
    };

export interface Boletim {
  cabecalho: CabecalhoDocumento | null;
  medicao: { numero: number; inicio: string; fim: string; dias: number; situacao: string; fechadaEm: string | null; fechadaPor: string | null; observacao: string | null };
  contrato: Omit<DadosContrato, "revisaoId" | "continuo"> & { termino: string | null; regimeNome: string | null; porQuantidade: boolean };
  linhas: LinhaBoletim[];
  totais: { contratado: string; anterior: string; medicao: string; acumulado: string; percentualAcumulado: string; saldo: string };
}

export async function dadosBoletim(ex: Executor, medicaoId: string): Promise<Boletim> {
  const e = await carregarMedicao(ex, medicaoId);
  const c = await dadosContrato(ex, e.contrato.id);
  const porQtd = e.contrato.medicao !== "PERCENTUAL";
  // somas por grupo, incluindo os subgrupos
  const filhos = new Map<string, string[]>();
  for (const g of e.grupos) if (g.paiId) filhos.set(g.paiId, [...(filhos.get(g.paiId) ?? []), g.id]);
  const somaGrupo = new Map<string, { contratado: Dec; anterior: Dec; atual: Dec }>();
  const somar = (gid: string): { contratado: Dec; anterior: Dec; atual: Dec } => {
    const s = { contratado: dec(0), anterior: dec(0), atual: dec(0) };
    for (const l of e.linhas.filter((x) => x.grupoId === gid)) {
      s.contratado = s.contratado.plus(l.valorTotal); s.anterior = s.anterior.plus(l.anteriorValor); s.atual = s.atual.plus(l.atualValor);
    }
    for (const f of filhos.get(gid) ?? []) {
      const x = somar(f);
      s.contratado = s.contratado.plus(x.contratado); s.anterior = s.anterior.plus(x.anterior); s.atual = s.atual.plus(x.atual);
    }
    somaGrupo.set(gid, s);
    return s;
  };
  const linhas: LinhaBoletim[] = [];
  for (const g of e.grupos) {
    const s = somaGrupo.get(g.id) ?? somar(g.id);
    const acumulado = s.anterior.plus(s.atual);
    linhas.push({ tipo: "grupo", nivel: g.nivel, numero: g.numero, titulo: g.titulo, contratado: s.contratado.toFixed(2), medido: s.atual.toFixed(2), saldo: s.contratado.minus(acumulado).toFixed(2), percentual: p2(pct(acumulado, s.contratado)) });
    for (const l of e.linhas.filter((x) => x.grupoId === g.id)) {
      const limite = porQtd ? dec(l.quantidade) : dec(100);
      const antes = limite.minus(porQtd ? l.anteriorQtd : l.anteriorPct);
      const medido = dec((porQtd ? l.atualQtd : l.atualPct) ?? 0);
      const acumulado = dec(l.anteriorValor).plus(l.atualValor);
      linhas.push({
        tipo: "item", numero: l.numero, codigo: l.codigo, descricao: l.descricao, unidade: porQtd ? l.unidade : "%",
        quantidade: porQtd ? l.quantidade : "100", precoUnitario: l.precoUnitario, valorTotal: l.valorTotal,
        antes: antes.toString(), medido: medido.toString(), saldo: antes.minus(medido).toString(),
        valorMedido: dec(l.atualValor).toFixed(2), valorSaldo: dec(l.valorTotal).minus(acumulado).toFixed(2), percentual: p2(pct(acumulado, dec(l.valorTotal))),
      });
    }
  }
  return {
    cabecalho: await cabecalhoDaObra(ex, c.obraId),
    medicao: { numero: e.medicao.numero, inicio: e.medicao.inicio, fim: e.medicao.fim, dias: e.medicao.dias, situacao: e.medicao.situacao, fechadaEm: e.medicao.fechadaEm, fechadaPor: e.medicao.fechadaPor, observacao: e.medicao.observacao },
    contrato: {
      id: c.id, numero: c.numero, objeto: c.objeto, empresa: c.empresa, cnpj: c.cnpj, processo: c.processo, dataOs: c.dataOs, prazoExecucaoDias: c.prazoExecucaoDias,
      responsavelTecnico: c.responsavelTecnico, artRrt: c.artRrt, obraId: c.obraId, obraCodigo: c.obraCodigo, obraNome: c.obraNome,
      termino: termino(c.dataOs, c.prazoExecucaoDias), regimeNome: e.contrato.regimeNome, porQuantidade: porQtd,
    },
    linhas,
    totais: {
      contratado: e.totais.contratado, anterior: e.totais.anterior, medicao: e.totais.atual, acumulado: e.totais.acumulado,
      percentualAcumulado: p2(dec(e.totais.percentualAcumulado)), saldo: e.totais.saldo,
    },
  };
}

// ---------------------------------------------------------------------------
// Cronograma de desembolso
// ---------------------------------------------------------------------------

export interface PeriodoDesembolso { numero: number; inicio: string; fim: string; dias: number; situacao: string }
export interface GrupoDesembolso { id: string; numero: string; titulo: string; total: string }

export interface EstadoDesembolso {
  contrato: { id: string; numero: string; objeto: string; obraCodigo: string | null; obraNome: string; continuo: boolean };
  grupos: GrupoDesembolso[];
  periodos: PeriodoDesembolso[];
  /** última medição fechada (0 = nenhuma) */
  ultimaFechada: number;
  /** valor realizado (R$) de cada grupo em cada medição fechada: [grupoId][numero] */
  realizado: Record<string, Record<number, string>>;
  /** percentual previsto para os períodos seguintes à última fechada (o salvo, se fecha 100%; senão a sugestão) */
  previsto: Record<string, Record<number, string>>;
  /** de onde veio o previsto de cada grupo */
  origem: Record<string, "salvo" | "orcamento" | "uniforme" | "concluido">;
}

async function baseDesembolso(ex: Executor, contratoId: string) {
  const c = await dadosContrato(ex, contratoId);
  const [raizes, periodos, realizados, salvos] = await Promise.all([
    ex.consulta<{ id: string; ordem: number; titulo: string; total: string }>(
      `WITH RECURSIVE arvore AS (
         SELECT id AS raiz, id FROM contrato_grupo WHERE contrato_id = $1 AND pai_id IS NULL
         UNION ALL SELECT a.raiz, g.id FROM contrato_grupo g JOIN arvore a ON g.pai_id = a.id)
       SELECT r.id, r.ordem, r.titulo, coalesce((SELECT sum(ci.valor_total) FROM contrato_item ci JOIN arvore a ON a.id = ci.grupo_id WHERE a.raiz = r.id), 0)::text AS total
         FROM contrato_grupo r WHERE r.contrato_id = $1 AND r.pai_id IS NULL ORDER BY r.ordem`, [contratoId],
    ),
    ex.consulta<Omit<PeriodoDesembolso, "dias">>(`SELECT numero, inicio::text, fim::text, situacao FROM medicao WHERE contrato_id = $1 ORDER BY numero`, [contratoId]),
    ex.consulta<{ raiz: string; numero: number; valor: string }>(
      `WITH RECURSIVE arvore AS (
         SELECT id AS raiz, id FROM contrato_grupo WHERE contrato_id = $1 AND pai_id IS NULL
         UNION ALL SELECT a.raiz, g.id FROM contrato_grupo g JOIN arvore a ON g.pai_id = a.id)
       SELECT a.raiz, m.numero, sum(mi.valor)::text AS valor
         FROM medicao m JOIN medicao_item mi ON mi.medicao_id = m.id JOIN contrato_item ci ON ci.id = mi.contrato_item_id JOIN arvore a ON a.id = ci.grupo_id
        WHERE m.contrato_id = $1 AND m.situacao = 'FECHADA' GROUP BY a.raiz, m.numero`, [contratoId],
    ),
    ex.consulta<{ grupoId: string; periodo: number; percentual: string }>(
      `SELECT grupo_id AS "grupoId", periodo, percentual::text FROM cronograma_desembolso WHERE contrato_id = $1`, [contratoId],
    ),
  ]);
  const grupos: GrupoDesembolso[] = raizes.map((g, k) => ({ id: g.id, numero: String(k + 1), titulo: g.titulo, total: dec(g.total).toFixed(2) }));
  const realizado: Record<string, Record<number, string>> = Object.fromEntries(grupos.map((g) => [g.id, {}]));
  for (const r of realizados) realizado[r.raiz][r.numero] = dec(r.valor).toFixed(2);
  const salvo: Record<string, Record<number, string>> = Object.fromEntries(grupos.map((g) => [g.id, {}]));
  for (const s of salvos) if (salvo[s.grupoId]) salvo[s.grupoId][s.periodo] = s.percentual;
  // cronograma do orçamento de origem (etapas principais = grupos raiz, mesma ordem e título)
  const orcamento: Record<string, Record<number, string>> = {};
  if (c.revisaoId) {
    const parcelas = await ex.consulta<{ ordem: number; titulo: string; periodo: number; percentual: string }>(
      `SELECT e.ordem, e.titulo, p.periodo, p.percentual::text FROM cronograma_parcela p JOIN etapa e ON e.id = p.etapa_id
        WHERE p.revisao_id = $1 AND e.pai_id IS NULL`, [c.revisaoId],
    );
    for (const g of raizes) {
      const doGrupo = parcelas.filter((p) => p.ordem === g.ordem && p.titulo === g.titulo);
      if (doGrupo.length) orcamento[g.id] = Object.fromEntries(doGrupo.map((p) => [p.periodo, p.percentual]));
    }
  }
  return {
    c, grupos, realizado, salvo, orcamento,
    periodos: periodos.map((p) => ({ ...p, dias: diasEntre(p.inicio, p.fim) })),
  };
}

/**
 * Valores (R$) previstos de um grupo nos períodos depois de `n`: o saldo
 * (total − realizado até n) repartido na proporção dos pesos; o último período
 * com peso fecha o arredondamento. Sem pesos, reparte igualmente.
 */
function repartir(total: Dec, realizadoAteN: Dec, periodos: number[], pesos: (p: number) => Dec): Map<number, Dec> {
  const saida = new Map<number, Dec>();
  const saldo = total.minus(realizadoAteN);
  if (!periodos.length || saldo.lte(0)) return saida;
  let ws = periodos.map((p) => ({ p, w: pesos(p).gt(0) ? pesos(p) : dec(0) }));
  if (ws.every((x) => x.w.isZero())) ws = periodos.map((p) => ({ p, w: dec(1) }));
  const soma = ws.reduce((a, x) => a.plus(x.w), dec(0));
  const comPeso = ws.filter((x) => x.w.gt(0));
  let usado = dec(0);
  comPeso.forEach((x, k) => {
    const v = k === comPeso.length - 1 ? saldo.minus(usado) : arredondar(saldo.times(x.w).div(soma), 2, "ARREDONDAR");
    saida.set(x.p, v);
    usado = usado.plus(v);
  });
  return saida;
}

type Base = Awaited<ReturnType<typeof baseDesembolso>>;

/** Pesos dos períodos posteriores a `n`: realizado (se já fechado) › salvo › orçamento › nada (uniforme). */
function pesosDoGrupo(b: Base, gid: string, n: number, ultimaFechada: number): { pesos: (p: number) => Dec; origem: EstadoDesembolso["origem"][string] } {
  const salvo = b.salvo[gid];
  const futuros = b.periodos.filter((p) => p.numero > ultimaFechada).map((p) => p.numero);
  const temSalvo = futuros.some((p) => dec(salvo[p] ?? 0).gt(0));
  const orc = b.orcamento[gid];
  const temOrc = !!orc && futuros.some((p) => dec(orc[p] ?? 0).gt(0));
  const total = dec(b.grupos.find((g) => g.id === gid)!.total);
  return {
    origem: temSalvo ? "salvo" : temOrc ? "orcamento" : "uniforme",
    pesos: (p) => {
      if (p <= ultimaFechada && p > n) return pct(dec(b.realizado[gid][p] ?? 0), total);
      if (temSalvo) return dec(salvo[p] ?? 0);
      if (temOrc) return dec(orc![p] ?? 0);
      return dec(0);
    },
  };
}

export async function estadoDesembolso(ex: Executor, contratoId: string): Promise<EstadoDesembolso> {
  const b = await baseDesembolso(ex, contratoId);
  const fechadas = b.periodos.filter((p) => p.situacao === "FECHADA").map((p) => p.numero);
  const ultimaFechada = fechadas.length ? Math.max(...fechadas) : 0;
  const futuros = b.periodos.filter((p) => p.numero > ultimaFechada).map((p) => p.numero);
  const previsto: EstadoDesembolso["previsto"] = {};
  const origem: EstadoDesembolso["origem"] = {};
  for (const g of b.grupos) {
    const total = dec(g.total);
    const realizado = Object.values(b.realizado[g.id]).reduce((a, v) => a.plus(v), dec(0));
    previsto[g.id] = {};
    if (total.minus(realizado).lte(0)) { origem[g.id] = "concluido"; continue; }
    const { pesos, origem: o } = pesosDoGrupo(b, g.id, ultimaFechada, ultimaFechada);
    origem[g.id] = o;
    // o salvo vale como está quando fecha 100% com o realizado; senão é reajustado
    const salvoSoma = futuros.reduce((a, p) => a.plus(b.salvo[g.id][p] ?? 0), dec(0));
    if (o === "salvo" && pct(realizado, total).plus(salvoSoma).minus(100).abs().lte(0.05)) {
      for (const p of futuros) previsto[g.id][p] = dec(b.salvo[g.id][p] ?? 0).toString();
      continue;
    }
    const valores = repartir(total, realizado, futuros, pesos);
    // em percentual com 2 casas; o último fecha 100%
    let usado = pct(realizado, total);
    const comValor = futuros.filter((p) => valores.has(p));
    for (const p of futuros) {
      if (!valores.has(p)) { previsto[g.id][p] = "0"; continue; }
      const v = p === comValor[comValor.length - 1] ? dec(100).minus(usado) : arredondar(pct(valores.get(p)!, total), 2, "ARREDONDAR");
      previsto[g.id][p] = arredondar(v, 4, "ARREDONDAR").toString();
      usado = usado.plus(v);
    }
  }
  return {
    contrato: { id: b.c.id, numero: b.c.numero, objeto: b.c.objeto, obraCodigo: b.c.obraCodigo, obraNome: b.c.obraNome, continuo: b.c.continuo },
    grupos: b.grupos, periodos: b.periodos, ultimaFechada, realizado: b.realizado, previsto, origem,
  };
}

/** Grava o previsto (percentual de cada etapa nos períodos seguintes à última medição fechada). */
export async function salvarDesembolso(ex: Executor, contratoId: string, previsto: Record<string, Record<number, string>>, usuarioId: string) {
  const e = await estadoDesembolso(ex, contratoId);
  const futuros = e.periodos.filter((p) => p.numero > e.ultimaFechada).map((p) => p.numero);
  const linhas: { grupoId: string; periodo: number; percentual: string }[] = [];
  for (const g of e.grupos) {
    const total = dec(g.total);
    const realizado = Object.values(e.realizado[g.id]).reduce((a, v) => a.plus(v), dec(0));
    let soma = pct(realizado, total);
    for (const p of futuros) {
      const t = (previsto[g.id]?.[p] ?? "").trim();
      if (!t) continue;
      const v = lerNumero(t);
      if (!v || v.isNegative() || v.gt(100)) throw new ErroMedicao(`Percentual inválido na etapa ${g.numero}, período ${p}.`);
      if (v.decimalPlaces() > 4) throw new ErroMedicao(`Percentual com no máximo 4 casas (etapa ${g.numero}, período ${p}).`);
      soma = soma.plus(v);
      if (v.gt(0)) linhas.push({ grupoId: g.id, periodo: p, percentual: v.toString() });
    }
    if (total.gt(0) && soma.minus(100).abs().gt(0.05)) {
      throw new ErroMedicao(`A etapa ${g.numero} (${g.titulo}) soma ${arredondar(soma, 2, "ARREDONDAR").toFixed(2).replace(".", ",")}% (realizado + previsto); deve fechar 100%.`);
    }
  }
  await ex.transacao([
    { sql: `DELETE FROM cronograma_desembolso WHERE contrato_id = $1 AND periodo > $2`, params: [contratoId, e.ultimaFechada] },
    ...(linhas.length ? [{
      sql: `INSERT INTO cronograma_desembolso (contrato_id, grupo_id, periodo, percentual)
            SELECT $1, x."grupoId", x.periodo, x.percentual::numeric FROM jsonb_to_recordset($2::jsonb) AS x("grupoId" uuid, periodo int, percentual text)`,
      params: [contratoId, JSON.stringify(linhas)],
    }] : []),
    comandoAuditoria({ usuarioId, acao: "DESEMBOLSO_SALVO", entidade: "contrato", entidadeId: contratoId, depois: { periodos: futuros.length, parcelas: linhas.length } }),
  ]);
}

export interface Desembolso {
  cabecalho: CabecalhoDocumento | null;
  contrato: EstadoDesembolso["contrato"];
  /** medição de referência (o documento é "Cronograma de desembolso — Nª medição") */
  medicao: number;
  periodos: (PeriodoDesembolso & { realizado: boolean })[];
  rotuloPeriodos: string;
  grupos: (GrupoDesembolso & { valores: string[]; percentuais: string[] })[];
  mensal: string[];
  acumulado: string[];
  total: string;
}

/** Cronograma de desembolso na posição da medição `numero` (realizado até ela, previsto depois). */
export async function dadosDesembolso(ex: Executor, contratoId: string, numero: number): Promise<Desembolso> {
  const b = await baseDesembolso(ex, contratoId);
  const fechadas = b.periodos.filter((p) => p.situacao === "FECHADA").map((p) => p.numero);
  const ultimaFechada = fechadas.length ? Math.max(...fechadas) : 0;
  if (!fechadas.includes(numero)) throw new ErroMedicao("O cronograma de desembolso é gerado a partir de uma medição fechada.");
  const nums = b.periodos.map((p) => p.numero);
  const posteriores = nums.filter((p) => p > numero);
  const grupos = b.grupos.map((g) => {
    const total = dec(g.total);
    const realizadoAteN = nums.filter((p) => p <= numero).reduce((a, p) => a.plus(b.realizado[g.id][p] ?? 0), dec(0));
    const { pesos } = pesosDoGrupo(b, g.id, numero, ultimaFechada);
    const previsto = repartir(total, realizadoAteN, posteriores, pesos);
    const valores = nums.map((p) => (p <= numero ? dec(b.realizado[g.id][p] ?? 0) : previsto.get(p) ?? dec(0)));
    return { ...g, valores: valores.map((v) => v.toFixed(2)), percentuais: valores.map((v) => p2(pct(v, total))) };
  });
  const mensal = nums.map((_, k) => grupos.reduce((a, g) => a.plus(g.valores[k]), dec(0)));
  let acc = dec(0);
  const acumulado = mensal.map((v) => (acc = acc.plus(v)).toFixed(2));
  const diasIguais = new Set(b.periodos.map((p) => p.dias));
  return {
    cabecalho: await cabecalhoDaObra(ex, b.c.obraId),
    contrato: { id: b.c.id, numero: b.c.numero, objeto: b.c.objeto, obraCodigo: b.c.obraCodigo, obraNome: b.c.obraNome, continuo: b.c.continuo },
    medicao: numero,
    periodos: b.periodos.map((p) => ({ ...p, realizado: p.numero <= numero })),
    rotuloPeriodos: b.c.continuo ? "PERÍODOS MENSAIS" : diasIguais.size === 1 ? `PERÍODOS DE ${[...diasIguais][0]} DIAS` : "PERÍODOS DE MEDIÇÃO",
    grupos,
    mensal: mensal.map((v) => v.toFixed(2)),
    acumulado,
    total: grupos.reduce((a, g) => a.plus(g.total), dec(0)).toFixed(2),
  };
}
