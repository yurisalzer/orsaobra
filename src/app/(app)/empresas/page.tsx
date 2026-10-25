import Link from "next/link";
import { exigirUsuario, temPermissao } from "@/lib/auth/sessao";
import { executor } from "@/lib/banco/servidor";
import { formatarCnpj, listarEmpresas } from "@/lib/empresas/servico";

export const dynamic = "force-dynamic";

export default async function PaginaEmpresas({ searchParams }: { searchParams: Promise<{ busca?: string }> }) {
  const u = await exigirUsuario("MEDICOES_VER");
  const { busca = "" } = await searchParams;
  const empresas = await listarEmpresas(await executor(), busca.slice(0, 100));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Empresas</h1>
          <p className="text-sm text-slate-500">Empresas contratadas e os seus responsáveis técnicos, para vincular aos contratos.</p>
        </div>
        {temPermissao(u, "MEDICOES_EDITAR") && <Link href="/empresas/nova" className="rounded-md bg-marca-600 px-4 py-2 text-sm font-medium text-white">Nova empresa</Link>}
      </div>
      <form className="flex gap-2">
        <input name="busca" defaultValue={busca} placeholder="Pesquisar por razão social, nome fantasia, CNPJ, município ou responsável técnico" aria-label="Pesquisar empresas"
          className="w-full max-w-xl rounded-md border border-slate-300 bg-white px-3 py-2 text-sm" />
        <button className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm">Pesquisar</button>
      </form>
      {empresas.length === 0 ? (
        <p className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">{busca ? "Nenhuma empresa encontrada." : "Nenhuma empresa cadastrada."}</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-500">
              <tr><th className="px-3 py-2">Empresa</th><th>CNPJ</th><th>Município</th><th>Responsável técnico principal</th><th className="text-right">RTs</th><th className="px-3 text-right">Contratos</th></tr>
            </thead>
            <tbody>
              {empresas.map((e) => (
                <tr key={e.id} className={`border-t border-slate-100 align-top ${e.ativo ? "" : "text-slate-400"}`}>
                  <td className="px-3 py-2">
                    <Link href={`/empresas/${e.id}`} className="font-medium text-marca-700 hover:underline">{e.razaoSocial}</Link>
                    {e.nomeFantasia && <span className="block text-xs text-slate-500">{e.nomeFantasia}</span>}
                    {!e.ativo && <span className="mt-0.5 inline-block rounded bg-slate-100 px-1.5 text-xs">inativa</span>}
                  </td>
                  <td className="whitespace-nowrap">{formatarCnpj(e.cnpj)}</td>
                  <td>{[e.municipio, e.uf].filter(Boolean).join("/") || "—"}</td>
                  <td>{e.responsavel ?? "—"}</td>
                  <td className="text-right">{e.responsaveis}</td>
                  <td className="px-3 text-right">{e.contratos}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
