import type { Comando } from "./banco/executor";

export interface RegistroAuditoria {
  usuarioId?: string | null;
  acao: string;
  entidade: string;
  entidadeId?: string | null;
  antes?: unknown;
  depois?: unknown;
  ip?: string | null;
}

/** Comando de auditoria para incluir na mesma transação da alteração. */
export function comandoAuditoria(r: RegistroAuditoria): Comando {
  return {
    sql: `INSERT INTO auditoria (usuario_id, acao, entidade, entidade_id, antes, depois, ip) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7)`,
    params: [
      r.usuarioId ?? null, r.acao, r.entidade, r.entidadeId ?? null,
      r.antes === undefined ? null : JSON.stringify(r.antes), r.depois === undefined ? null : JSON.stringify(r.depois), r.ip ?? null,
    ],
  };
}
