import Link from "next/link";
import { exigirUsuario, temPapel } from "@/lib/auth/sessao";
import { executor } from "@/lib/banco/servidor";
import { formatarMoeda } from "@/lib/calculo/decimal";
import { listarOrcamentos } from "@/lib/orcamento/servico";

export const dynamic = "force-dynamic";

export default async function Orcamentos() {
  const u = await exigirUsuario();
  const lista = await listarOrcamentos(await executor());
  const obras = [...new Map(lista.map((l) => [l.obraId, l])).values()];
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Obras e orçamentos</h1>
        {temPapel(u, "ORCAMENTISTA") && <Link href="/orcamentos/novo" className="rounded-md bg-marca-600 px-4 py-2 text-sm font-medium text-white hover:bg-marca-700">Novo orçamento</Link>}
      </div>
      {obras.length === 0 && <p className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-500">Nenhuma obra cadastrada.</p>}
      {obras.map((o) => (
        <section key={o.obraId} className="overflow-x-auto rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="font-medium">{o.obraCodigo ? <span className="text-slate-500">{o.obraCodigo} · </span> : null}{o.obra}{o.orgaoSolicitante ? <span className="text-slate-500"> — {o.orgaoSolicitante}</span> : null}</h2>
          <table className="mt-2 w-full text-sm">
            <thead className="text-left text-slate-500"><tr><th className="py-1">Orçamento</th><th>Revisões</th><th>Última revisão</th><th className="text-right">Total</th><th>Atualizado</th></tr></thead>
            <tbody>
              {lista.filter((l) => l.obraId === o.obraId && l.orcamentoId).map((l) => (
                <tr key={l.orcamentoId} className="border-t border-slate-100">
                  <td className="py-2"><Link className="text-marca-700 hover:underline" href={`/orcamentos/revisao/${l.ultimaRevisaoId}`}>{l.codigo ? `${l.codigo} — ` : ""}{l.titulo}</Link></td>
                  <td>{l.revisoes}</td>
                  <td>{l.ultimaNumero} — {l.ultimaStatus === "FECHADA" ? "fechada" : "em elaboração"}</td>
                  <td className="num">{l.total ? formatarMoeda(l.total) : "—"}</td>
                  <td className="whitespace-nowrap">{l.atualizado}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
}
