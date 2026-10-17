import { exigirUsuario, temPapel } from "@/lib/auth/sessao";
import { executor } from "@/lib/banco/servidor";
import { listarPerfis } from "@/lib/orcamento/bdi";
import { ListaBdi } from "./ListaBdi";

export const dynamic = "force-dynamic";

export default async function PaginaBdi() {
  const u = await exigirUsuario();
  const perfis = await listarPerfis(await executor());
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Perfis de BDI</h1>
      <p className="text-sm text-slate-600">Use um perfil como BDI global do orçamento e, quando necessário, outro perfil como BDI diferenciado em itens específicos (ex.: fornecimento de equipamentos).</p>
      <ListaBdi perfis={perfis} podeEditar={temPapel(u, "ORCAMENTISTA")} />
    </div>
  );
}
