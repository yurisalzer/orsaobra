import { exigirUsuario } from "@/lib/auth/sessao";
import { executor } from "@/lib/banco/servidor";
import { basesDisponiveis, rotuloBase } from "@/lib/referencia/bases";
import { listarPerfis } from "@/lib/orcamento/bdi";
import { listarCabecalhos } from "@/lib/relatorios/cabecalhos";
import { FormNovo } from "./FormNovo";

export const dynamic = "force-dynamic";

export default async function Novo() {
  await exigirUsuario("ORCAMENTISTA");
  const ex = await executor();
  const [obras, bases, perfis, cabecalhos] = await Promise.all([
    ex.consulta<{ id: string; nome: string }>(`SELECT id, nome FROM obra ORDER BY nome`),
    basesDisponiveis(ex),
    listarPerfis(ex, true),
    listarCabecalhos(ex, true),
  ]);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Novo orçamento</h1>
      <FormNovo
        obras={obras}
        bases={bases.filter((b) => b.publicada).map((b) => ({ revisaoId: b.revisaoId, fonte: b.fonte, rotulo: rotuloBase(b), regimes: b.regimes }))}
        perfis={perfis.map((p) => ({ id: p.id, nome: p.nome, bdi: p.bdiAplicado }))}
        cabecalhos={cabecalhos.map((c) => ({ id: c.id, nome: c.nome, padrao: c.padrao }))}
      />
    </div>
  );
}
