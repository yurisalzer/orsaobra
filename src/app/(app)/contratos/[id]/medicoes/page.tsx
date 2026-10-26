import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { exigirUsuario, temPermissao } from "@/lib/auth/sessao";
import { executor } from "@/lib/banco/servidor";
import { acessoA } from "@/lib/acesso";
import { SemAcessoItem } from "@/components/SemAcessoItem";
import { ErroMedicao, painelMedicoes } from "@/lib/medicoes/servico";
import { PainelMedicoes } from "./PainelMedicoes";

export const dynamic = "force-dynamic";

export default async function PaginaMedicoes({ params }: { params: Promise<{ id: string }> }) {
  const u = await exigirUsuario("MEDICOES_VER");
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const ex = await executor();
  const acesso = await acessoA(ex, "contrato", id, u);
  if (!acesso) notFound();
  if (!acesso.ver) return <SemAcessoItem tipo="contrato" voltar="/contratos" />;
  const p = await painelMedicoes(ex, id).catch((err) => { if (err instanceof ErroMedicao) return null; throw err; });
  if (!p) notFound();
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">
        <Link href="/contratos" className="underline">Contratos</Link> · <Link href={`/contratos/${id}`} className="underline">Contrato {p.contrato.numero}</Link> · Medições
      </p>
      <PainelMedicoes painel={p} podeEditar={acesso.editar} podeGerenciar={acesso.gerenciar && temPermissao(u, "MEDICOES_EDITAR")} />
    </div>
  );
}
