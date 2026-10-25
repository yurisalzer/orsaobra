import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { exigirUsuario, temPermissao } from "@/lib/auth/sessao";
import { executor } from "@/lib/banco/servidor";
import { carregarEmpresa, ErroEmpresa } from "@/lib/empresas/servico";
import { FormEmpresa } from "../FormEmpresa";

export const dynamic = "force-dynamic";

export default async function PaginaEmpresa({ params }: { params: Promise<{ id: string }> }) {
  const u = await exigirUsuario("MEDICOES_VER");
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const e = await carregarEmpresa(await executor(), id).catch((err) => { if (err instanceof ErroEmpresa) return null; throw err; });
  if (!e) notFound();
  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-slate-500"><Link href="/empresas" className="underline">Empresas</Link></p>
        <h1 className="text-2xl font-semibold">{e.razaoSocial}{!e.ativo && <span className="ml-2 rounded bg-slate-100 px-2 py-0.5 align-middle text-sm font-normal text-slate-600">inativa</span>}</h1>
        <p className="text-xs text-slate-500">Cadastrada em {e.criadoEm}{e.criadoPor ? ` por ${e.criadoPor}` : ""} · atualizada em {e.atualizadoEm}</p>
      </div>
      <FormEmpresa inicial={e} podeEditar={temPermissao(u, "MEDICOES_EDITAR")} />
    </div>
  );
}
