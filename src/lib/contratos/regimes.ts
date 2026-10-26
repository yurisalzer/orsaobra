/**
 * Regimes de execução do contrato (Lei 14.133/2021, art. 46) e o tipo de
 * medição: no preço unitário mede-se a QUANTIDADE executada de cada item; nos
 * demais, o PERCENTUAL executado. O usuário pode cadastrar regimes novos
 * (medidos por percentual).
 */
import type { Executor } from "@/lib/banco/executor";
import { comandoAuditoria } from "@/lib/auditoria";

export class ErroRegime extends Error {}

export type TipoMedicao = "QUANTIDADE" | "PERCENTUAL";
export interface Regime { id: string; nome: string; medicao: TipoMedicao; sistema: boolean }

export const REGIMES_DA_LEI: { nome: string; medicao: TipoMedicao }[] = [
  { nome: "Empreitada por preço unitário", medicao: "QUANTIDADE" },
  { nome: "Empreitada por preço global", medicao: "PERCENTUAL" },
  { nome: "Empreitada integral (Turnkey)", medicao: "PERCENTUAL" },
  { nome: "Contratação por tarefa", medicao: "PERCENTUAL" },
  { nome: "Contratação integrada", medicao: "PERCENTUAL" },
  { nome: "Contratação semi-integrada", medicao: "PERCENTUAL" },
  { nome: "Fornecimento e prestação de serviço associado", medicao: "PERCENTUAL" },
];

export const DESCRICAO_MEDICAO: Record<TipoMedicao, string> = {
  QUANTIDADE: "medição pela quantidade executada de cada item",
  PERCENTUAL: "medição pelo percentual executado",
};

/** Regimes ativos; garante os da lei (idempotente). */
export async function listarRegimes(ex: Executor): Promise<Regime[]> {
  let r = await ex.consulta<Regime>(`SELECT id, nome, medicao, sistema FROM regime_execucao WHERE ativo ORDER BY ordem, nome`);
  if (r.filter((x) => x.sistema).length < REGIMES_DA_LEI.length) {
    await ex.transacao([{
      sql: `INSERT INTO regime_execucao (nome, medicao, sistema, ordem)
            SELECT x.nome, x.medicao, true, x.ordem FROM jsonb_to_recordset($1::jsonb) AS x(nome text, medicao text, ordem int)
            ON CONFLICT ((lower(nome))) DO NOTHING`,
      params: [JSON.stringify(REGIMES_DA_LEI.map((x, i) => ({ ...x, ordem: i + 1 })))],
    }]);
    r = await ex.consulta<Regime>(`SELECT id, nome, medicao, sistema FROM regime_execucao WHERE ativo ORDER BY ordem, nome`);
  }
  return r;
}

/** Cadastra um regime novo (medido por percentual, como os demais regimes que não são de preço unitário). */
export async function criarRegime(ex: Executor, nome: string, usuarioId: string): Promise<Regime> {
  const n = nome.replace(/\s+/g, " ").trim();
  if (n.length < 3) throw new ErroRegime("Informe o nome do regime de execução.");
  if (n.length > 150) throw new ErroRegime("Nome do regime com mais de 150 caracteres.");
  const [existe] = await ex.consulta<{ nome: string }>(`SELECT nome FROM regime_execucao WHERE lower(nome) = lower($1)`, [n]);
  if (existe) throw new ErroRegime(`O regime "${existe.nome}" já está cadastrado.`);
  const id = crypto.randomUUID();
  await ex.transacao([
    { sql: `INSERT INTO regime_execucao (id, nome, medicao, criado_por_id) VALUES ($1, $2, 'PERCENTUAL', $3)`, params: [id, n, usuarioId] },
    comandoAuditoria({ usuarioId, acao: "REGIME_EXECUCAO_CRIADO", entidade: "regime_execucao", entidadeId: id, depois: { nome: n, medicao: "PERCENTUAL" } }),
  ]);
  return { id, nome: n, medicao: "PERCENTUAL", sistema: false };
}
