import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { exigirUsuario } from "@/lib/auth/sessao";
import { executor } from "@/lib/banco/servidor";
import { detalheImportacao, verificacoes } from "@/lib/importacao/consultas";
import type { Identificacao } from "@/lib/importacao/tipos";
import { Selo } from "../nova/Assistente";

export const dynamic = "force-dynamic";

export default async function RelatorioImportacao({ params }: { params: Promise<{ id: string }> }) {
  await exigirUsuario("IMPORTACAO");
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const ex = await executor();
  const d = await detalheImportacao(ex, id);
  if (!d) notFound();
  const lista = await verificacoes(ex, id, 1000);
  const ident = d.resumo.identificacao as Identificacao;
  const contagens = d.resumo.contagens as Record<string, number> | undefined;
  const gravado = d.resumo.gravado as Record<string, number> | undefined;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-semibold">Relatório de importação — {ident.fonte} {ident.uf} {ident.competencia.split("-").reverse().join("/")}</h1>
        <div className="flex gap-4 text-sm">
          <a className="text-marca-700 underline" href={`/api/importacao/${id}/relatorio`}>Baixar em Excel</a>
          <Link className="text-marca-700 underline" href="/importacao">Voltar</Link>
        </div>
      </div>
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[14rem_1fr]">
          <dt className="text-slate-500">Situação</dt><dd>{d.status}{d.erro ? <span className="text-red-700"> — {d.erro}</span> : null}</dd>
          <dt className="text-slate-500">Revisão da base</dt><dd>{d.numero === 0 ? "Original" : `Retificação ${d.numero}`} ({d.base_status})</dd>
          <dt className="text-slate-500">Importador</dt><dd>{d.adaptador} v{d.adaptador_versao} — {ident.layout}</dd>
          <dt className="text-slate-500">Regimes</dt><dd>{ident.regimes.map((r) => r.nome).join("; ")}</dd>
          <dt className="text-slate-500">Início / conclusão</dt><dd>{d.iniciada_em} / {d.concluida_em ?? "—"} — por {d.usuario}</dd>
          <dt className="text-slate-500">Duplicidade autorizada</dt><dd>{d.duplicidade_autorizada ? "Sim" : "Não"}</dd>
          {contagens && (<><dt className="text-slate-500">Lido</dt><dd>{Object.entries(contagens).map(([k, v]) => `${k}: ${v.toLocaleString("pt-BR")}`).join(" · ")}</dd></>)}
          {gravado && (<><dt className="text-slate-500">Gravado</dt><dd>{Object.entries(gravado).map(([k, v]) => `${k}: ${Number(v).toLocaleString("pt-BR")}`).join(" · ")}</dd></>)}
        </dl>
        <h3 className="mt-4 text-sm font-medium">Arquivos originais</h3>
        <ul className="mt-1 text-sm">
          {d.arquivos.map((a) => <li key={a.sha256}>{a.nome_original} — {Number(a.tamanho_bytes).toLocaleString("pt-BR")} bytes — <span className="font-mono text-xs">SHA-256 {a.sha256}</span></li>)}
        </ul>
      </section>
      <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="mb-3 font-medium">Verificações ({lista.length >= 1000 ? "primeiras 1.000; baixe o Excel para todas" : lista.length})</h2>
        <table className="w-full text-sm">
          <thead className="text-left text-slate-500"><tr><th className="py-1">Gravidade</th><th>Regra</th><th>Mensagem</th><th>Origem</th></tr></thead>
          <tbody>
            {lista.map((v, i) => (
              <tr key={i} className="border-t border-slate-100 align-top">
                <td className="py-1 pr-2"><Selo severidade={v.severidade} /></td>
                <td className="pr-2 text-xs">{v.regra}</td>
                <td className="pr-2">{v.mensagem}</td>
                <td className="whitespace-nowrap text-xs text-slate-500">{[v.arquivo, v.planilha, v.linha ? `linha ${v.linha}` : null].filter(Boolean).join(" · ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
