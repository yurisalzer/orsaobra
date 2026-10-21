import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { exigirUsuario } from "@/lib/auth/sessao";
import { executor } from "@/lib/banco/servidor";
import { carregarRevisao, ErroOrcamento } from "@/lib/orcamento/servico";
import { situacaoMemorial } from "@/lib/relatorios/memorial";
import { Relatorios } from "./Relatorios";

export const dynamic = "force-dynamic";

export default async function PaginaRelatorios({ params }: { params: Promise<{ id: string }> }) {
  await exigirUsuario("RELATORIOS");
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const ex = await executor();
  const estado = await carregarRevisao(ex, id).catch((e) => { if (e instanceof ErroOrcamento) return null; throw e; });
  if (!estado) notFound();
  const memorial = await situacaoMemorial(ex, estado);
  const r = estado.revisao;
  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-slate-500">
          <Link href="/orcamentos" className="underline">Orçamentos</Link> · <Link href={`/orcamentos/revisao/${id}`} className="underline">{estado.orcamento.codigo ? `${estado.orcamento.codigo} — ` : ""}{estado.orcamento.titulo}</Link>
        </p>
        <h1 className="text-2xl font-semibold">Relatórios — revisão {r.numero}</h1>
        <p className="text-sm text-slate-500">
          {r.status === "FECHADA"
            ? `Revisão fechada em ${r.fechadaEm}: os relatórios mostram os valores registrados no fechamento.`
            : "Revisão em elaboração: os relatórios saem marcados como PRÉVIA."}
        </p>
      </div>
      <Relatorios revisaoId={id} outras={estado.revisoes.filter((x) => x.id !== id).map((x) => ({ id: x.id, numero: x.numero }))}
        proprias={new Set(estado.itens.filter((i) => i.tipo === "COMPOSICAO" && i.fonte === "PROPRIA").map((i) => i.itemReferenciaId)).size} />
      <section className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-4 sm:max-w-[calc(50%-0.375rem)]">
        <div>
          <h2 className="font-medium">Memorial descritivo</h2>
          <p className="text-sm text-slate-500">Objeto, justificativa, considerações gerais, escopo de cada etapa e item, relevância técnica, subcontratações e recursos, com as normas técnicas e a legislação aplicáveis. Gera .docx ou PDF com o cabeçalho do orçamento.</p>
        </div>
        {!memorial.pronto && (
          <ul className="list-disc pl-5 text-xs text-amber-800">{memorial.pendencias.map((p) => <li key={p}>{p}</li>)}</ul>
        )}
        <div className="mt-auto text-sm">
          {memorial.pronto
            ? <Link href={`/orcamentos/revisao/${id}/memorial`} className="inline-block rounded-md bg-marca-600 px-3 py-1.5 text-white">Gerar memorial descritivo</Link>
            : <span aria-disabled="true" className="inline-block cursor-not-allowed rounded-md bg-marca-600 px-3 py-1.5 text-white opacity-50">Gerar memorial descritivo</span>}
        </div>
      </section>
    </div>
  );
}
