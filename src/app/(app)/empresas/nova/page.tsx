import Link from "next/link";
import { exigirUsuario } from "@/lib/auth/sessao";
import { FormEmpresa } from "../FormEmpresa";

export default async function PaginaNovaEmpresa() {
  await exigirUsuario("MEDICOES_EDITAR");
  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-slate-500"><Link href="/empresas" className="underline">Empresas</Link></p>
        <h1 className="text-2xl font-semibold">Nova empresa</h1>
      </div>
      <FormEmpresa inicial={null} podeEditar />
    </div>
  );
}
