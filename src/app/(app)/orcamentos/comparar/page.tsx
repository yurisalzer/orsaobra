import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { SeloFonte } from "@/components/SeloFonte";
import { exigirUsuario } from "@/lib/auth/sessao";
import { executor } from "@/lib/banco/servidor";
import { formatarMoeda, formatarNumero } from "@/lib/calculo/decimal";
import { compararRevisoes } from "@/lib/orcamento/servico";

export const dynamic = "force-dynamic";

const SIT: Record<string, { nome: string; cor: string }> = {
  INCLUIDO: { nome: "Incluído", cor: "bg-green-100 text-green-800" },
  EXCLUIDO: { nome: "Excluído", cor: "bg-red-100 text-red-800" },
  ALTERADO: { nome: "Alterado", cor: "bg-amber-100 text-amber-900" },
  IGUAL: { nome: "Igual", cor: "bg-slate-100 text-slate-600" },
};

export default async function Comparar({ searchParams }: { searchParams: Promise<{ a?: string; b?: string; todos?: string }> }) {
  await exigirUsuario("ORCAMENTOS_VER");
  const sp = await searchParams;
  const ids = z.object({ a: z.string().uuid(), b: z.string().uuid() }).safeParse(sp);
  if (!ids.success) notFound();
  const c = await compararRevisoes(await executor(), ids.data.a, ids.data.b);
  const mostrarTodos = sp.todos === "1";
  const linhas = c.linhas.filter((l) => mostrarTodos || l.situacao !== "IGUAL");
  const bases = (x: typeof c.a) => x.bases.map((b) => `${b.fonte} ${b.competencia.split("-").reverse().join("/")}${b.numeroBase ? ` ret.${b.numeroBase}` : ""} (${b.regimeNome})`).join("; ");
  const dif = Number(c.diferencaTotal);
  return (
    <div className="space-y-4">
      <Link href={`/orcamentos/revisao/${c.b.id}`} className="text-sm text-marca-700 underline">← Voltar ao orçamento</Link>
      <h1 className="text-2xl font-semibold">Comparação: revisão {c.a.numero} × revisão {c.b.numero}</h1>
      <section className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm"><p className="text-slate-500">Revisão {c.a.numero} ({c.a.status === "FECHADA" ? "fechada" : "em elaboração"})</p><p className="text-lg font-semibold">{formatarMoeda(c.a.total)}</p><p className="text-xs text-slate-500">{bases(c.a)}</p></div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm"><p className="text-slate-500">Revisão {c.b.numero} ({c.b.status === "FECHADA" ? "fechada" : "em elaboração"})</p><p className="text-lg font-semibold">{formatarMoeda(c.b.total)}</p><p className="text-xs text-slate-500">{bases(c.b)}</p></div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm"><p className="text-slate-500">Diferença</p><p className={`text-lg font-semibold ${dif > 0 ? "text-red-700" : dif < 0 ? "text-green-700" : ""}`}>{formatarMoeda(c.diferencaTotal)}{Number(c.a.total) ? ` (${formatarNumero((dif / Number(c.a.total)) * 100, 2)}%)` : ""}</p></div>
      </section>
      <p className="text-sm"><Link className="text-marca-700 underline" href={`/orcamentos/comparar?a=${c.a.id}&b=${c.b.id}${mostrarTodos ? "" : "&todos=1"}`}>{mostrarTodos ? "Mostrar só diferenças" : "Mostrar todos os itens"}</Link></p>
      <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white p-4">
        {linhas.length === 0 ? <p className="text-sm text-slate-500">Nenhuma diferença entre as revisões.</p> : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-slate-500"><tr><th className="py-1">Situação</th><th>Etapa</th><th>Fonte</th><th>Código</th><th>Descrição</th><th className="text-right">Qtd. {c.a.numero}</th><th className="text-right">P.U. {c.a.numero}</th><th className="text-right">Qtd. {c.b.numero}</th><th className="text-right">P.U. {c.b.numero}</th><th className="text-right">Diferença</th></tr></thead>
            <tbody>
              {linhas.map((l) => (
                <tr key={l.chave} className="border-t border-slate-100 align-top">
                  <td className="py-1"><span className={`rounded px-2 py-0.5 text-xs ${SIT[l.situacao].cor}`}>{SIT[l.situacao].nome}</span></td>
                  <td className="text-xs">{l.etapa}</td>
                  <td><SeloFonte fonte={l.fonte} /></td>
                  <td className="font-mono text-xs">{l.codigo}</td>
                  <td>{l.descricao}<div className="text-xs text-slate-500">{l.b?.referencia && l.a?.referencia !== l.b.referencia ? `${l.a?.referencia ?? "—"} → ${l.b.referencia}` : ""}</div></td>
                  <td className="num">{l.a ? formatarNumero(l.a.quantidade, 2) : "—"}</td>
                  <td className="num">{l.a ? formatarMoeda(l.a.precoUnitario) : "—"}</td>
                  <td className="num">{l.b ? formatarNumero(l.b.quantidade, 2) : "—"}</td>
                  <td className="num">{l.b ? formatarMoeda(l.b.precoUnitario) : "—"}</td>
                  <td className="num font-medium">{formatarMoeda(l.diferenca)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
