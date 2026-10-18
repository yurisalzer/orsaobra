import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { exigirUsuario, temPermissao } from "@/lib/auth/sessao";
import { executor } from "@/lib/banco/servidor";
import { carregarRevisao, ErroOrcamento, lerCronograma } from "@/lib/orcamento/servico";
import { EditorCronograma } from "./EditorCronograma";

export const dynamic = "force-dynamic";

export default async function PaginaCronograma({ params }: { params: Promise<{ id: string }> }) {
  const u = await exigirUsuario("ORCAMENTOS_VER");
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const ex = await executor();
  const estado = await carregarRevisao(ex, id).catch((e) => { if (e instanceof ErroOrcamento) return null; throw e; });
  if (!estado) notFound();
  const cronograma = await lerCronograma(ex, id);
  const etapas = estado.etapas.filter((e) => e.paiId === null).sort((a, b) => a.ordem - b.ordem).map((e) => ({ id: e.id, numero: e.numero, titulo: e.titulo, total: e.total }));
  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-slate-500">
          <Link href="/orcamentos" className="underline">Orçamentos</Link> · <Link href={`/orcamentos/revisao/${id}`} className="underline">{estado.orcamento.titulo} — revisão {estado.revisao.numero}</Link>
        </p>
        <h1 className="text-2xl font-semibold">Cronograma físico-financeiro</h1>
        <p className="text-sm text-slate-500">Percentual de execução de cada etapa principal em cada mês. O valor de cada mês é calculado sobre o total da etapa (com BDI).</p>
      </div>
      <EditorCronograma
        revisaoId={id} versao={estado.revisao.versao} etapas={etapas} total={estado.totais.total}
        inicial={cronograma} editavel={estado.revisao.status === "EM_ELABORACAO" && temPermissao(u, "ORCAMENTOS_EDITAR")}
      />
    </div>
  );
}
