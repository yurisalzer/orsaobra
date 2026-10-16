import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

/**
 * Prisma: no Neon (produção/Cloudflare) usa o driver serverless do Neon
 * (WebSocket na porta 443); em desenvolvimento local, conexão TCP comum.
 */
function criar(): PrismaClient {
  const url = process.env.DATABASE_URL ?? "";
  if (/\.neon\.tech[/:?]/.test(url)) return new PrismaClient({ adapter: new PrismaNeon({ connectionString: url }) });
  return new PrismaClient();
}

// Reaproveita a conexão entre recargas em desenvolvimento.
const globalParaPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalParaPrisma.prisma ?? criar();

if (process.env.NODE_ENV !== "production") globalParaPrisma.prisma = prisma;
