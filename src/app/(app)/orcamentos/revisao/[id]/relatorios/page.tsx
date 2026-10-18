import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { exigirUsuario } from "@/lib/auth/sessao";
import { executor } from "@/lib/banco/servidor";
import { carregarRevisao, ErroOrcamento } from "@/lib/orcamento/servico";
import { Relatorios } from "./Relatorios";

export const dynamic = "force-dynamic";

export default async function PaginaRelatorios({ params }: { params: Promise<{ id: string }> }) {
  await exigirUsuario("RELATORIOS");
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const estado = await carregarRevisao(await executor(), id).catch((e) => { if (e instanceof ErroOrcamento) return null; throw e; });
  if (!estado) notFound();
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
      <Relatorios revisaoId={id} outras={estado.revisoes.filter((x) => x.id !== id).map((x) => ({ id: x.id, numero: x.numero }))} />
    </div>
  );
}
