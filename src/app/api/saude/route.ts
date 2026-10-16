import { executor } from "@/lib/banco/servidor";

export const dynamic = "force-dynamic";

/** Verificação de saúde: confirma que a aplicação alcança o banco. */
export async function GET() {
  try {
    await (await executor()).consulta("SELECT 1");
    return Response.json({ ok: true });
  } catch (e) {
    // detalhe só no log do servidor (não exposto ao visitante)
    console.error("saude: falha ao acessar o banco", e);
    return Response.json({ ok: false }, { status: 503 });
  }
}
