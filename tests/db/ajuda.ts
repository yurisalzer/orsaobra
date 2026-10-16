import { criarPrisma } from "@/lib/db";

if (!process.env.DATABASE_URL?.includes("_test")) {
  throw new Error("Testes de banco só rodam no banco de teste (DATABASE_URL deve conter _test). Use `npm test`.");
}

export const prisma = criarPrisma();

/** Limpa todas as tabelas (TRUNCATE não dispara os gatilhos de linha). */
export async function limparBanco() {
  const tabelas = await prisma.$queryRaw<{ t: string }[]>`
    SELECT quote_ident(schemaname) || '.' || quote_ident(tablename) AS t
      FROM pg_tables WHERE schemaname IN ('public', 'staging') AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(`TRUNCATE ${tabelas.map((x) => x.t).join(", ")} RESTART IDENTITY CASCADE`);
}

export async function criarFonteERegime(codigoFonte = "SINAPI") {
  const fonte = await prisma.fonte.create({ data: { codigo: codigoFonte, nome: codigoFonte } });
  const regime = await prisma.regime.create({ data: { fonteId: fonte.id, codigo: "R1", nome: "Regime de teste" } });
  return { fonte, regime };
}
