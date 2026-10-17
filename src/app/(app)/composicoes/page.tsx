import Link from "next/link";
import { exigirUsuario, temPapel } from "@/lib/auth/sessao";
import { executor } from "@/lib/banco/servidor";
import { listarProprios } from "@/lib/referencia/proprios";

export const dynamic = "force-dynamic";

export default async function Composicoes() {
  const u = await exigirUsuario();
  const lista = await listarProprios(await executor());
  const pode = temPapel(u, "ORCAMENTISTA");
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Composições e insumos próprios</h1>
        {pode && (
          <div className="flex gap-2">
            <Link href="/composicoes/nova?tipo=COMPOSICAO" className="rounded-md bg-marca-600 px-4 py-2 text-sm font-medium text-white hover:bg-marca-700">Nova composição própria</Link>
            <Link href="/composicoes/nova?tipo=INSUMO" className="rounded-md border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50">Novo insumo próprio</Link>
          </div>
        )}
      </div>
      <p className="text-sm text-slate-600">
        Composições analíticas <strong>oficiais</strong> (SINAPI/EMOP/SICRO/SCO) são consultadas em <Link href="/consulta" className="text-marca-700 underline">Consulta de preços</Link>.
        Aqui ficam os itens criados por você — sempre identificados como não oficiais.
      </p>
      <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white p-5">
        {lista.length === 0 ? <p className="text-sm text-slate-500">Nenhum item próprio cadastrado.</p> : (
          <table className="w-full text-sm">
            <thead className="text-left text-slate-500"><tr><th className="py-1">Tipo</th><th>Código</th><th>Descrição</th><th>Unid.</th><th>Componentes / última cotação</th><th>Versão</th><th>Atualizado</th></tr></thead>
            <tbody>
              {lista.map((i) => (
                <tr key={i.itemId} className="border-t border-slate-100">
                  <td className="py-2">{i.tipo === "COMPOSICAO" ? "Composição" : "Insumo"}</td>
                  <td className="font-mono"><Link className="text-marca-700 hover:underline" href={`/consulta/item/${i.itemId}`}>{i.codigo}</Link></td>
                  <td>{i.descricao}</td><td>{i.unidade}</td>
                  <td>{i.tipo === "COMPOSICAO" ? `${i.componentes} componente(s)` : i.ultimaCotacao ?? <em className="text-amber-700">sem cotação</em>}</td>
                  <td>{i.versao}</td><td className="whitespace-nowrap">{i.atualizadoEm}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
