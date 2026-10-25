import { exigirUsuario } from "@/lib/auth/sessao";

export const dynamic = "force-dynamic";

/** Página reservada: o cadastro será criado em uma próxima etapa. */
export default async function PaginaSetores() {
  await exigirUsuario("USUARIOS");
  return (
    <div className="space-y-3">
      <h1 className="text-2xl font-semibold">Setores</h1>
      <section className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
        <p className="font-medium text-slate-800">Em desenvolvimento.</p>
        <p className="mt-1">Cadastro dos setores dentro da empresa (secretarias, departamentos e equipes), para organizar contratos, orçamentos e responsáveis.</p>
      </section>
    </div>
  );
}
