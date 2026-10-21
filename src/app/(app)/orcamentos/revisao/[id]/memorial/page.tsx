import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { exigirUsuario, temPermissao } from "@/lib/auth/sessao";
import { executor } from "@/lib/banco/servidor";
import { carregarMemorial, ErroMemorial } from "@/lib/relatorios/memorial";
import { EditorMemorial } from "./EditorMemorial";

export const dynamic = "force-dynamic";

export default async function PaginaMemorial({ params }: { params: Promise<{ id: string }> }) {
  const u = await exigirUsuario("RELATORIOS");
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const m = await carregarMemorial(await executor(), id).catch((e) => { if (e instanceof ErroMemorial) return null; throw e; });
  if (!m) notFound();
  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-slate-500">
          <Link href="/orcamentos" className="underline">Orçamentos</Link> · <Link href={`/orcamentos/revisao/${id}`} className="underline">{m.titulo}</Link> · <Link href={`/orcamentos/revisao/${id}/relatorios`} className="underline">Relatórios</Link>
        </p>
        <h1 className="text-2xl font-semibold">Memorial descritivo</h1>
        <p className="text-sm text-slate-500">
          Texto sugerido a partir da planilha, do cronograma e das normas técnicas de cada tipo de serviço. Revise e complete cada seção antes de gerar o documento.
        </p>
      </div>
      {!m.situacao.pronto ? (
        <section role="alert" className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-medium">O memorial descritivo só pode ser gerado com o orçamento concluído e bloqueado e o cronograma físico-financeiro pronto:</p>
          <ul className="list-disc pl-5">{m.situacao.pendencias.map((p) => <li key={p}>{p}</li>)}</ul>
        </section>
      ) : (
        <EditorMemorial revisaoId={id} inicial={m.conteudo} cabecalho={m.cabecalho} nomeArquivo={m.nomeArquivo}
          salvo={m.salvo} podeEditar={temPermissao(u, "ORCAMENTOS_EDITAR")} />
      )}
    </div>
  );
}
