import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Verificação de saúde: confirma que a aplicação alcança o banco. */
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 503 });
  }
}
