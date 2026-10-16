/**
 * Acesso SQL direto, usado pela importação (cargas em lote).
 * Duas implementações com o mesmo contrato:
 *  - PostgreSQL via TCP (node-postgres): desenvolvimento local e testes;
 *  - Neon via HTTPS (porta 443): produção na Cloudflare e redes que bloqueiam 5432.
 * `transacao` executa uma lista de comandos de forma atômica (tudo ou nada).
 */
export interface Comando {
  sql: string;
  params?: unknown[];
}

export interface Executor {
  consulta<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  transacao(comandos: Comando[]): Promise<void>;
  encerrar?(): Promise<void>;
}

export async function executorPg(connectionString: string): Promise<Executor> {
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString, max: 3 });
  return {
    async consulta(sql, params) {
      return (await pool.query(sql, params as unknown[])).rows;
    },
    async transacao(comandos) {
      const c = await pool.connect();
      try {
        await c.query("BEGIN");
        for (const cmd of comandos) {
          const t0 = Date.now();
          const explicar = process.env.SQL_EXPLAIN && cmd.sql.includes(process.env.SQL_EXPLAIN);
          const r = await c.query((explicar ? "EXPLAIN (ANALYZE, BUFFERS) " : "") + cmd.sql, cmd.params as unknown[]);
          if (explicar) console.error(r.rows.map((x) => x["QUERY PLAN"]).join("\n"));
          if (process.env.SQL_PERFIL) console.error(`[sql ${Date.now() - t0} ms] ${cmd.sql.replace(/\s+/g, " ").slice(0, 110)}`);
        }
        await c.query("COMMIT");
      } catch (e) {
        await c.query("ROLLBACK").catch(() => {});
        throw e;
      } finally {
        c.release();
      }
    },
    encerrar: () => pool.end(),
  };
}

export async function executorNeonHttp(connectionString: string): Promise<Executor> {
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(connectionString);
  return {
    async consulta(q, params) {
      return (await sql.query(q, params ?? [])) as never[];
    },
    async transacao(comandos) {
      await sql.transaction(comandos.map((c) => sql.query(c.sql, c.params ?? [])));
    },
  };
}

/** Escolhe a implementação pela URL: Neon → HTTPS; demais → TCP. */
export function criarExecutor(url = process.env.DATABASE_URL ?? ""): Promise<Executor> {
  if (!url) throw new Error("DATABASE_URL não definida.");
  return /\.neon\.tech[/:?]/.test(url) ? executorNeonHttp(url) : executorPg(url);
}
