import Link from "next/link";
import { exigirUsuario, temPermissao } from "@/lib/auth/sessao";
import { idsComAcesso } from "@/lib/acesso";
import { executor } from "@/lib/banco/servidor";
import { formatarMoeda } from "@/lib/calculo/decimal";
import { listarContratos } from "@/lib/contratos/servico";

export const dynamic = "force-dynamic";

export default async function PaginaContratos({ searchParams }: { searchParams: Promise<{ busca?: string }> }) {
  const u = await exigirUsuario("MEDICOES_VER");
  const { busca = "" } = await searchParams;
  const ex = await executor();
  const [contratos, liberados] = await Promise.all([listarContratos(ex, busca.slice(0, 100)), idsComAcesso(ex, "contrato", u)]);
  const editor = temPermissao(u, "MEDICOES_EDITAR");
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Contratos e medições</h1>
          <p className="text-sm text-slate-500">Planilha contratual de cada obra, gerada de um orçamento ou importada da proposta vencedora. Medições, aditivos e reajustes partem dela.</p>
        </div>
        {editor && (
          <div className="flex gap-2 text-sm">
            <Link href="/contratos/novo" className="rounded-md bg-marca-600 px-3 py-2 font-medium text-white">Novo contrato do orçamento</Link>
            <Link href="/contratos/importar" className="rounded-md border border-slate-300 bg-white px-3 py-2">Importar planilha da proposta</Link>
          </div>
        )}
      </div>
      <form className="flex gap-2">
        <input name="busca" defaultValue={busca} placeholder="Pesquisar por número, objeto, empresa, obra ou processo" aria-label="Pesquisar contratos"
          className="w-full max-w-xl rounded-md border border-slate-300 px-3 py-2 text-sm" />
        <button className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm">Pesquisar</button>
      </form>
      {contratos.length === 0 ? (
        <p className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">{busca ? "Nenhum contrato encontrado." : "Nenhum contrato cadastrado."}</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-500">
              <tr><th className="px-3 py-2">Contrato</th><th>Objeto</th><th>Empresa</th><th>Obra</th><th>Origem</th><th>Situação</th><th className="text-right">Itens</th><th className="px-3 text-right">Valor contratado</th></tr>
            </thead>
            <tbody>
              {contratos.map((c) => (
                <tr key={c.id} className="border-t border-slate-100 align-top">
                  <td className="px-3 py-2 font-medium">{!liberados || liberados.has(c.id)
                    ? <Link href={`/contratos/${c.id}`} className="text-marca-700 hover:underline">{c.numero}</Link>
                    : <span className="text-slate-500" title="Sem acesso: peça a quem cadastrou o contrato ou ao administrador">🔒 {c.numero}</span>}</td>
                  <td className="max-w-md">{c.objeto}</td>
                  <td>{c.empresa ?? "—"}</td>
                  <td>{c.obraCodigo ? `${c.obraCodigo} · ` : ""}{c.obraNome}</td>
                  <td>{c.origem === "ORCAMENTO" ? "Orçamento" : "Planilha importada"}</td>
                  <td>{c.situacao === "VIGENTE" ? <span className="rounded bg-green-50 px-2 py-0.5 text-green-800">Vigente</span> : <span className="rounded bg-amber-50 px-2 py-0.5 text-amber-800">Em cadastro</span>}</td>
                  <td className="text-right">{c.itens}</td>
                  <td className="num px-3 whitespace-nowrap">{formatarMoeda(c.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
