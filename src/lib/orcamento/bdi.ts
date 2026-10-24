/**
 * Perfis de BDI. O BDI de um perfil é:
 *  - o percentual INFORMADO (quando definido — ex.: fixado em edital), ou
 *  - calculado pelas parcelas com a fórmula do Acórdão TCU 2.622/2013.
 * O BDI aplicado aos itens é arredondado a 2 casas decimais (pontos
 * percentuais), como usualmente apresentado no demonstrativo de BDI.
 */
import type { Comando, Executor } from "../banco/executor";
import { calcularBdi, somasBdi, type TipoParcelaBdi } from "../calculo/bdi";
import { calcularBdiPorFormula, ErroFormulaBdi } from "../calculo/formula-bdi";
import { arredondar, lerNumero, type Dec } from "../calculo/decimal";
import { comandoAuditoria } from "../auditoria";

export class ErroBdi extends Error {}

export const TIPOS_PARCELA: { tipo: TipoParcelaBdi; nome: string }[] = [
  { tipo: "AC", nome: "Administração central" },
  { tipo: "S", nome: "Seguro" },
  { tipo: "R", nome: "Risco" },
  { tipo: "G", nome: "Garantia" },
  { tipo: "DF", nome: "Despesas financeiras" },
  { tipo: "L", nome: "Lucro" },
  { tipo: "I", nome: "Tributos (PIS, COFINS, ISS, CPRB...)" },
];

export interface ParcelaPerfil { tipo: TipoParcelaBdi; nome: string; percentual: string }
export interface PerfilBdi {
  id: string;
  nome: string;
  descricao: string | null;
  percentualInformado: string | null;
  /** fórmula do usuário (null = fórmula do Acórdão TCU 2.622/2013) */
  formula: string | null;
  ativo: boolean;
  parcelas: ParcelaPerfil[];
  /** BDI exato (sem arredondar), em pontos percentuais */
  bdiCalculado: string;
  /** BDI aplicado (2 casas) */
  bdiAplicado: string;
  emUso: number;
}

export function bdiDoPerfil(p: { percentualInformado: string | null; formula?: string | null; parcelas: ParcelaPerfil[] }): { exato: Dec; aplicado: Dec } {
  const exato = p.percentualInformado !== null ? lerNumero(p.percentualInformado)!
    : p.formula ? calcularBdiPorFormula(p.formula, somasBdi(p.parcelas)) : calcularBdi(p.parcelas).bdi;
  return { exato, aplicado: arredondar(exato, 2) };
}

export async function listarPerfis(ex: Executor, apenasAtivos = false): Promise<PerfilBdi[]> {
  const linhas = await ex.consulta<{ id: string; nome: string; descricao: string | null; percentual_informado: string | null; formula: string | null; ativo: boolean; parcelas: ParcelaPerfil[] | null; em_uso: number }>(
    `SELECT p.id, p.nome, p.descricao, p.percentual_informado::text, p.formula, p.ativo,
            (SELECT jsonb_agg(jsonb_build_object('tipo', x.tipo, 'nome', x.nome, 'percentual', x.percentual::text) ORDER BY x.ordem) FROM bdi_parcela x WHERE x.perfil_id = p.id) AS parcelas,
            ((SELECT count(*) FROM orcamento_revisao r WHERE r.bdi_perfil_id = p.id) + (SELECT count(*) FROM item_orcamento i WHERE i.bdi_perfil_id = p.id))::int AS em_uso
       FROM bdi_perfil p WHERE ($1::boolean = false OR p.ativo) ORDER BY p.nome`,
    [apenasAtivos],
  );
  return linhas.map((l) => {
    const parcelas = l.parcelas ?? [];
    const b = bdiDoPerfil({ percentualInformado: l.percentual_informado, formula: l.formula, parcelas });
    return {
      id: l.id, nome: l.nome, descricao: l.descricao, percentualInformado: l.percentual_informado, formula: l.formula, ativo: l.ativo, parcelas,
      bdiCalculado: b.exato.toString(), bdiAplicado: b.aplicado.toFixed(2), emUso: l.em_uso,
    };
  });
}

export async function salvarPerfil(
  ex: Executor,
  d: { id?: string | null; nome: string; descricao?: string | null; percentualInformado?: string | null; formula?: string | null; parcelas: { tipo: TipoParcelaBdi; nome: string; percentual: string }[] },
  usuarioId: string,
): Promise<string> {
  const nome = d.nome.trim();
  if (nome.length < 2) throw new ErroBdi("Informe o nome do perfil.");
  let informado: string | null = null;
  if (d.percentualInformado != null && d.percentualInformado.trim() !== "") {
    const v = lerNumero(d.percentualInformado);
    if (!v || v.isNegative() || v.gte(1000)) throw new ErroBdi("BDI informado inválido.");
    informado = v.toString();
  }
  const parcelas = d.parcelas.filter((p) => p.percentual.trim() !== "").map((p, i) => {
    if (!TIPOS_PARCELA.some((t) => t.tipo === p.tipo)) throw new ErroBdi("Tipo de parcela inválido.");
    const v = lerNumero(p.percentual);
    if (!v || v.isNegative()) throw new ErroBdi(`Percentual inválido na parcela ${p.nome || p.tipo}.`);
    return { tipo: p.tipo, nome: (p.nome || TIPOS_PARCELA.find((t) => t.tipo === p.tipo)!.nome).trim(), percentual: v.toString(), ordem: i + 1 };
  });
  const formula = informado === null ? (d.formula ?? "").replace(/\s+/g, " ").trim() || null : null;
  if (formula && formula.length > 500) throw new ErroBdi("Fórmula do BDI com mais de 500 caracteres.");
  if (informado === null && parcelas.length === 0) throw new ErroBdi("Informe as parcelas do BDI ou o percentual informado.");
  if (informado === null) {
    try {
      if (formula) calcularBdiPorFormula(formula, somasBdi(parcelas));
      else calcularBdi(parcelas);
    } catch (e) { throw new ErroBdi(e instanceof ErroFormulaBdi ? `Fórmula do BDI: ${e.message}` : (e as Error).message); }
  }
  const dup = await ex.consulta<{ id: string }>(`SELECT id FROM bdi_perfil WHERE lower(nome) = lower($1) AND id IS DISTINCT FROM $2::uuid`, [nome, d.id ?? null]);
  if (dup.length) throw new ErroBdi("Já existe perfil com esse nome.");
  if (d.id) {
    const [uso] = await ex.consulta<{ n: number }>(
      `SELECT ((SELECT count(*) FROM orcamento_revisao r WHERE r.bdi_perfil_id = $1 AND r.status = 'FECHADA') + (SELECT count(*) FROM item_orcamento i JOIN orcamento_revisao r ON r.id = i.revisao_id WHERE i.bdi_perfil_id = $1 AND r.status = 'FECHADA'))::int AS n`,
      [d.id],
    );
    if (uso.n > 0) throw new ErroBdi("Este perfil já foi usado em orçamento fechado e não pode ser alterado. Crie um novo perfil.");
  }
  const id = d.id ?? crypto.randomUUID();
  const cmds: Comando[] = d.id
    ? [
        { sql: `UPDATE bdi_perfil SET nome = $2, descricao = $3, percentual_informado = $4::numeric, formula = $5 WHERE id = $1`, params: [id, nome, d.descricao ?? null, informado, formula] },
        { sql: `DELETE FROM bdi_parcela WHERE perfil_id = $1`, params: [id] },
      ]
    : [{ sql: `INSERT INTO bdi_perfil (id, nome, descricao, percentual_informado, formula) VALUES ($1, $2, $3, $4::numeric, $5)`, params: [id, nome, d.descricao ?? null, informado, formula] }];
  if (parcelas.length) {
    cmds.push({
      sql: `INSERT INTO bdi_parcela (perfil_id, tipo, nome, percentual, ordem)
            SELECT $1, x.tipo::"TipoParcelaBdi", x.nome, x.percentual::numeric, x.ordem FROM jsonb_to_recordset($2::jsonb) AS x(tipo text, nome text, percentual text, ordem int)`,
      params: [id, JSON.stringify(parcelas)],
    });
  }
  cmds.push(comandoAuditoria({ usuarioId, acao: d.id ? "BDI_ALTERADO" : "BDI_CRIADO", entidade: "bdi_perfil", entidadeId: id, depois: { nome, informado, formula, parcelas } }));
  await ex.transacao(cmds);
  return id;
}

export async function arquivarPerfil(ex: Executor, id: string, ativo: boolean, usuarioId: string) {
  await ex.transacao([
    { sql: `UPDATE bdi_perfil SET ativo = $2 WHERE id = $1`, params: [id, ativo] },
    comandoAuditoria({ usuarioId, acao: ativo ? "BDI_REATIVADO" : "BDI_ARQUIVADO", entidade: "bdi_perfil", entidadeId: id }),
  ]);
}
