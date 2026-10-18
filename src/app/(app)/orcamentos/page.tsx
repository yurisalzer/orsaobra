import Link from "next/link";
import { exigirUsuario, temPermissao } from "@/lib/auth/sessao";
import { executor } from "@/lib/banco/servidor";
import { formatarMoeda } from "@/lib/calculo/decimal";
import { listarOrcamentos, podeExcluirOrcamento } from "@/lib/orcamento/servico";
import { ExcluirOrcamento } from "./ExcluirOrcamento";

export const dynamic = "force-dynamic";

export default async function Orcamentos({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const u = await exigirUsuario("ORCAMENTOS_VER");
  const busca = ((await searchParams).q ?? "").slice(0, 120).trim();
  const lista = await listarOrcamentos(await executor(), busca);
  const editor = temPermissao(u, "ORCAMENTOS_EDITAR");
  const quem = { id: u.id, administrador: temPermissao(u, "USUARIOS") };
  const obras = [...new Map(lista.map((l) => [l.obraId, l])).values()];
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Obras e orçamentos</h1>
        {temPermissao(u, "ORCAMENTOS_EDITAR") && <Link href="/orcamentos/novo" className="rounded-md bg-marca-600 px-4 py-2 text-sm font-medium text-white hover:bg-marca-700">Novo orçamento</Link>}
      </div>
      <form role="search" className="flex flex-wrap items-center gap-2" action="/orcamentos">
        <input name="q" type="search" defaultValue={busca} aria-label="Pesquisar obras e orçamentos"
          placeholder="Pesquisar por nome da obra, número/código, processo ou orçamento"
          className="min-w-0 flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm sm:max-w-xl" />
        <button type="submit" className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm hover:bg-slate-50">Pesquisar</button>
        {busca && <Link href="/orcamentos" className="text-sm text-marca-700 hover:underline">Limpar</Link>}
      </form>
      {busca && (
        <p className="text-sm text-slate-600" role="status">
          {obras.length === 0 ? `Nada encontrado para “${busca}”.` : `${obras.length} ${obras.length === 1 ? "obra encontrada" : "obras encontradas"} para “${busca}”.`}
        </p>
      )}
      {obras.length === 0 && !busca && <p className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-500">Nenhuma obra cadastrada.</p>}
      {obras.map((o) => (
        <section key={o.obraId} className="overflow-x-auto rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-medium">{o.obraCodigo ? <span className="text-slate-500">{o.obraCodigo} · </span> : null}{o.obra}{o.orgaoSolicitante ? <span className="text-slate-500"> — {o.orgaoSolicitante}</span> : null}</h2>
              {o.obraProcesso && <p className="text-xs text-slate-500">Processo {o.obraProcesso}</p>}
            </div>
            {editor && (
              <Link href={`/orcamentos/obra/${o.obraId}`} aria-label={`Editar obra ${o.obra}`} className="shrink-0 text-sm text-marca-700 hover:underline">Editar obra</Link>
            )}
          </div>
          <table className="mt-2 w-full text-sm">
            <thead className="text-left text-slate-500"><tr><th className="py-1">Orçamento</th><th>Revisões</th><th>Última revisão</th><th className="text-right">Total</th><th>Atualizado</th><th>Criado por</th>{editor && <th><span className="sr-only">Ações</span></th>}</tr></thead>
            <tbody>
              {lista.filter((l) => l.obraId === o.obraId && l.orcamentoId).map((l) => (
                <tr key={l.orcamentoId} className="border-t border-slate-100">
                  <td className="py-2"><Link className="text-marca-700 hover:underline" href={`/orcamentos/revisao/${l.ultimaRevisaoId}`}>{l.codigo ? `${l.codigo} — ` : ""}{l.titulo}</Link></td>
                  <td>{l.revisoes}</td>
                  <td>{l.ultimaNumero} — {l.ultimaStatus === "FECHADA" ? "fechada" : "em elaboração"}</td>
                  <td className="num">{l.total ? formatarMoeda(l.total) : "—"}</td>
                  <td className="whitespace-nowrap">{l.atualizado}</td>
                  <td className="text-slate-600">{l.criadoPor ?? "—"}</td>
                  {editor && (
                    <td className="whitespace-nowrap text-right">
                      {podeExcluirOrcamento(l, quem) && <ExcluirOrcamento orcamentoId={l.orcamentoId!} titulo={l.titulo ?? ""} />}
                    </td>
                  )}
                </tr>
              ))}
              {!lista.some((l) => l.obraId === o.obraId && l.orcamentoId) && (
                <tr className="border-t border-slate-100"><td colSpan={7} className="py-2 text-slate-500">Nenhum orçamento nesta obra.</td></tr>
              )}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
}
