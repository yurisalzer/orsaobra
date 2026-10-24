import { z } from "zod";
import { comandoAuditoria } from "@/lib/auditoria";
import { acessoRevisao } from "@/lib/acesso";
import { temPermissao, usuarioAtual } from "@/lib/auth/sessao";
import { executor } from "@/lib/banco/servidor";
import { RELATORIOS, type TipoRelatorio } from "@/lib/relatorios/documento";
import { ErroRelatorio, montarRelatorio } from "@/lib/relatorios/montar";

export const dynamic = "force-dynamic";

const tipos = RELATORIOS.map((r) => r.tipo) as [TipoRelatorio, ...TipoRelatorio[]];

/** Dados do relatório (Documento em JSON). O PDF/XLSX é gerado no navegador. */
export async function GET(req: Request, { params }: { params: Promise<{ revisaoId: string }> }) {
  const u = await usuarioAtual();
  if (!u) return Response.json({ erro: "Sessão expirada. Entre novamente." }, { status: 401 });
  if (!temPermissao(u, "RELATORIOS")) return Response.json({ erro: "Você não tem permissão para emitir relatórios. Fale com o administrador." }, { status: 403 });
  const { revisaoId } = await params;
  const url = new URL(req.url);
  const p = z.object({
    revisaoId: z.string().uuid(), tipo: z.enum(tipos), outra: z.string().uuid().nullable(), formato: z.enum(["tela", "pdf", "xlsx"]).catch("tela"),
  }).safeParse({ revisaoId, tipo: url.searchParams.get("tipo"), outra: url.searchParams.get("outra") || null, formato: url.searchParams.get("formato") });
  if (!p.success) return Response.json({ erro: "Relatório inválido." }, { status: 400 });
  const ex = await executor();
  for (const r of [p.data.revisaoId, p.data.outra]) {
    if (!r) continue;
    const a = await acessoRevisao(ex, r, u);
    if (!a) return Response.json({ erro: "Revisão não encontrada." }, { status: 404 });
    if (!a.ver) return Response.json({ erro: "Você não tem acesso a este orçamento. Peça acesso a quem o criou ou ao administrador." }, { status: 403 });
  }
  try {
    const doc = await montarRelatorio(ex, p.data.revisaoId, p.data.tipo, { outraRevisaoId: p.data.outra, emitidoPor: u.nome });
    if (p.data.formato !== "tela") {
      await ex.transacao([comandoAuditoria({ usuarioId: u.id, acao: "RELATORIO_EMITIDO", entidade: "orcamento_revisao", entidadeId: p.data.revisaoId, depois: { tipo: p.data.tipo, formato: p.data.formato, outra: p.data.outra } })]);
    }
    return Response.json(doc, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof ErroRelatorio) return Response.json({ erro: e.message }, { status: 400 });
    console.error(e);
    return Response.json({ erro: "Não foi possível montar o relatório." }, { status: 500 });
  }
}
