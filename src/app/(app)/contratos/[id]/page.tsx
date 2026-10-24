import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { exigirUsuario, temPermissao } from "@/lib/auth/sessao";
import { executor } from "@/lib/banco/servidor";
import { acessoA } from "@/lib/acesso";
import { SemAcessoItem } from "@/components/SemAcessoItem";
import { carregarContrato, ErroContrato } from "@/lib/contratos/servico";
import { PlanilhaContrato } from "./PlanilhaContrato";

export const dynamic = "force-dynamic";

export default async function PaginaContrato({ params }: { params: Promise<{ id: string }> }) {
  const u = await exigirUsuario("MEDICOES_VER");
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const ex = await executor();
  const acesso = await acessoA(ex, "contrato", id, u);
  if (!acesso) notFound();
  if (!acesso.ver) return <SemAcessoItem tipo="contrato" voltar="/contratos" />;
  const e = await carregarContrato(ex, id).catch((err) => { if (err instanceof ErroContrato) return null; throw err; });
  if (!e) notFound();
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500"><Link href="/contratos" className="underline">Contratos</Link> · {e.contrato.obraCodigo ? `${e.contrato.obraCodigo} · ` : ""}{e.contrato.obraNome}</p>
      <PlanilhaContrato estado={e} podeEditar={acesso.editar} podeGerenciar={acesso.gerenciar && temPermissao(u, "MEDICOES_EDITAR")} podeCompartilhar={acesso.gerenciar} />
    </div>
  );
}
