import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { exigirUsuario } from "@/lib/auth/sessao";
import { executor } from "@/lib/banco/servidor";
import { acessoA } from "@/lib/acesso";
import { SemAcessoItem } from "@/components/SemAcessoItem";
import { ErroMedicao } from "@/lib/medicoes/servico";
import { estadoDesembolso } from "@/lib/medicoes/relatorios";
import { EditorDesembolso } from "./EditorDesembolso";

export const dynamic = "force-dynamic";

export default async function PaginaDesembolso({ params }: { params: Promise<{ id: string }> }) {
  const u = await exigirUsuario("MEDICOES_VER");
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const ex = await executor();
  const acesso = await acessoA(ex, "contrato", id, u);
  if (!acesso) notFound();
  if (!acesso.ver) return <SemAcessoItem tipo="contrato" voltar="/contratos" />;
  const e = await estadoDesembolso(ex, id).catch((err) => { if (err instanceof ErroMedicao) return null; throw err; });
  if (!e) notFound();
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">
        <Link href="/contratos" className="underline">Contratos</Link> · <Link href={`/contratos/${id}`} className="underline">Contrato {e.contrato.numero}</Link> · <Link href={`/contratos/${id}/medicoes`} className="underline">Medições</Link> · Cronograma de desembolso
      </p>
      <EditorDesembolso estado={e} podeEditar={acesso.editar} />
    </div>
  );
}
