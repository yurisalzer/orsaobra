/**
 * Aplica as migrações de prisma/migrations no Neon usando o endpoint HTTPS
 * (porta 443), registrando-as em _prisma_migrations exatamente como o
 * `prisma migrate deploy` faria. Cada migração roda numa única transação.
 *
 * Uso: npx dotenv -e .env.neon -- tsx scripts/migrar-neon-http.ts
 * (Em redes sem bloqueio da porta 5432, prefira `npm run db:migrar`.)
 */
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { neon } from "@neondatabase/serverless";
import { ProxyAgent, setGlobalDispatcher } from "undici";
import { dividirSql } from "../src/lib/banco/sql-dividir";

const proxy = process.env.HTTPS_PROXY ?? process.env.https_proxy;
if (proxy) setGlobalDispatcher(new ProxyAgent(proxy));

async function main() {
  const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL não definida");
  const sql = neon(url, { fullResults: false });

  await sql.query(`CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
    "id" VARCHAR(36) PRIMARY KEY NOT NULL,
    "checksum" VARCHAR(64) NOT NULL,
    "finished_at" TIMESTAMPTZ,
    "migration_name" VARCHAR(255) NOT NULL,
    "logs" TEXT,
    "rolled_back_at" TIMESTAMPTZ,
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "applied_steps_count" INTEGER NOT NULL DEFAULT 0
  )`);
  const aplicadas = new Set(
    ((await sql.query(`SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`)) as { migration_name: string }[])
      .map((r) => r.migration_name),
  );

  const dir = path.join(process.cwd(), "prisma", "migrations");
  const nomes = fs.readdirSync(dir).filter((d) => fs.existsSync(path.join(dir, d, "migration.sql"))).sort();
  for (const nome of nomes) {
    if (aplicadas.has(nome)) {
      console.log(`✓ ${nome} (já aplicada)`);
      continue;
    }
    const conteudo = fs.readFileSync(path.join(dir, nome, "migration.sql"), "utf8");
    const checksum = createHash("sha256").update(conteudo).digest("hex");
    const comandos = dividirSql(conteudo);
    const t0 = Date.now();
    await sql.transaction([
      ...comandos.map((c) => sql.query(c)),
      sql.query(
        `INSERT INTO "_prisma_migrations" (id, checksum, migration_name, started_at, finished_at, applied_steps_count)
         VALUES ($1, $2, $3, now(), now(), 1)`,
        [randomUUID(), checksum, nome],
      ),
    ]);
    console.log(`✓ ${nome} aplicada (${comandos.length} comandos, ${Date.now() - t0} ms)`);
  }
}

main().catch((e) => {
  console.error("Falha:", e.message);
  process.exit(1);
});
