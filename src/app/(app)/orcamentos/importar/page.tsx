import Link from "next/link";
import { exigirUsuario } from "@/lib/auth/sessao";
import { executor } from "@/lib/banco/servidor";
import { listarPerfis } from "@/lib/orcamento/bdi";
import { basesDisponiveis, rotuloBase } from "@/lib/referencia/bases";
import { listarCabecalhos } from "@/lib/relatorios/cabecalhos";
import { ImportarOrcamento } from "./ImportarOrcamento";

export const dynamic = "force-dynamic";

export default async function PaginaImportar() {
  await exigirUsuario("ORCAMENTOS_EDITAR");
  const ex = await executor();
  const [obras, bases, perfis, cabecalhos] = await Promise.all([
    ex.consulta<{ id: string; nome: string; codigo: string | null; processo: string | null }>(`SELECT id, nome, codigo, processo FROM obra ORDER BY nome`),
    basesDisponiveis(ex),
    listarPerfis(ex, true),
    listarCabecalhos(ex, true),
  ]);
  return (
    <div className="space-y-4">
      <div className="text-sm text-slate-500"><Link href="/orcamentos" className="hover:underline">Orçamentos</Link> · Importar</div>
      <h1 className="text-2xl font-semibold">Importar orçamento</h1>
      <p className="max-w-3xl text-sm text-slate-600">
        Envie a planilha (.xls ou .xlsx) ou o PDF de um orçamento. O sistema identifica as colunas, as etapas, os itens e os dados da obra; o que não for
        identificado você informa. Cada código é conferido nas bases de referência escolhidas e o preço vem da base — os valores do arquivo servem só para conferência.
      </p>
      <ImportarOrcamento
        obras={obras}
        bases={bases.filter((b) => b.publicada).map((b) => ({ revisaoId: b.revisaoId, fonte: b.fonte, competencia: b.competencia, rotulo: rotuloBase(b), regimes: b.regimes }))}
        perfis={perfis.map((p) => ({ id: p.id, nome: p.nome, bdi: p.bdiAplicado }))}
        cabecalhos={cabecalhos.map((c) => ({ id: c.id, nome: c.nome, padrao: c.padrao }))}
      />
    </div>
  );
}
