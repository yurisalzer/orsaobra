import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { exigirUsuario } from "@/lib/auth/sessao";
import { executor } from "@/lib/banco/servidor";
import { ErroOrcamento, lerObra } from "@/lib/orcamento/servico";
import { FormObra } from "./FormObra";

export const dynamic = "force-dynamic";

export default async function EditarObra({ params }: { params: Promise<{ id: string }> }) {
  await exigirUsuario("ORCAMENTISTA");
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const obra = await lerObra(await executor(), id).catch((e) => {
    if (e instanceof ErroOrcamento) notFound();
    throw e;
  });
  const dados = {
    nome: obra.nome, codigo: obra.codigo ?? "", processo: obra.processo ?? "", descricao: obra.descricao ?? "",
    endereco: obra.endereco ?? "", municipio: obra.municipio ?? "", orgaoSolicitante: obra.orgaoSolicitante ?? "",
  };
  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-slate-500"><Link href="/orcamentos" className="underline">Orçamentos</Link></p>
        <h1 className="text-2xl font-semibold">Editar obra</h1>
        <p className="text-sm text-slate-500">
          {obra.orcamentos === 1 ? "1 orçamento" : `${obra.orcamentos} orçamentos`} nesta obra. Os novos dados aparecem em todos eles.
        </p>
      </div>
      <FormObra obraId={obra.id} inicial={dados} />
    </div>
  );
}
