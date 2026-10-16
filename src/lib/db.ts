import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * Prisma sem motor nativo (queryCompiler), compatível com Cloudflare Workers:
 *  - Neon (produção): driver serverless do Neon (WebSocket, porta 443);
 *  - demais (desenvolvimento/testes): node-postgres (TCP).
 */
export function criarPrisma(url = process.env.DATABASE_URL ?? ""): PrismaClient {
  if (!url) throw new Error("DATABASE_URL não definida.");
  const adapter = /\.neon\.tech[/:?]/.test(url) ? new PrismaNeon({ connectionString: url }) : new PrismaPg({ connectionString: url });
  return new PrismaClient({ adapter });
}

// Reaproveita a conexão entre recargas em desenvolvimento.
const globalParaPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalParaPrisma.prisma ?? criarPrisma();

if (process.env.NODE_ENV !== "production") globalParaPrisma.prisma = prisma;
