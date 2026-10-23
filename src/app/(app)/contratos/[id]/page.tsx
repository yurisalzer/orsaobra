import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { exigirUsuario, temPermissao } from "@/lib/auth/sessao";
import { executor } from "@/lib/banco/servidor";
import { carregarContrato, ErroContrato, podeGerenciarContrato } from "@/lib/contratos/servico";
import { PlanilhaContrato } from "./PlanilhaContrato";

export const dynamic = "force-dynamic";

export default async function PaginaContrato({ params }: { params: Promise<{ id: string }> }) {
  const u = await exigirUsuario("MEDICOES_VER");
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const e = await carregarContrato(await executor(), id).catch((err) => { if (err instanceof ErroContrato) return null; throw err; });
  if (!e) notFound();
  const editor = temPermissao(u, "MEDICOES_EDITAR");
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500"><Link href="/contratos" className="underline">Contratos</Link> · {e.contrato.obraCodigo ? `${e.contrato.obraCodigo} · ` : ""}{e.contrato.obraNome}</p>
      <PlanilhaContrato estado={e} podeEditar={editor} podeGerenciar={editor && podeGerenciarContrato(e.contrato, { id: u.id, administrador: temPermissao(u, "USUARIOS") })} />
    </div>
  );
}
