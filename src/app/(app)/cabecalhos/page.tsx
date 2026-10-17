import { exigirUsuario, temPapel } from "@/lib/auth/sessao";
import { executor } from "@/lib/banco/servidor";
import { listarCabecalhos } from "@/lib/relatorios/cabecalhos";
import { ListaCabecalhos } from "./ListaCabecalhos";

export const dynamic = "force-dynamic";

export default async function PaginaCabecalhos() {
  const u = await exigirUsuario();
  const lista = await listarCabecalhos(await executor());
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Cabeçalhos dos relatórios</h1>
      <p className="text-sm text-slate-600">
        Logo e linhas de texto que aparecem no topo de todos os relatórios (PDF, Excel e tela). Marque um como padrão; cada obra pode usar outro
        (em “Editar obra”). Ao fechar uma revisão, o cabeçalho usado fica registrado com ela.
      </p>
      <ListaCabecalhos lista={lista} podeEditar={temPapel(u, "ORCAMENTISTA")} />
    </div>
  );
}
