import Link from "next/link";
import { exigirUsuario } from "@/lib/auth/sessao";
import { idsComAcesso } from "@/lib/acesso";
import { executor } from "@/lib/banco/servidor";
import { revisoesParaContrato } from "@/lib/contratos/servico";
import { NovoContrato } from "./NovoContrato";

export const dynamic = "force-dynamic";

export default async function PaginaNovoContrato({ searchParams }: { searchParams: Promise<{ revisao?: string }> }) {
  const u = await exigirUsuario("MEDICOES_EDITAR");
  const { revisao } = await searchParams;
  const ex = await executor();
  // só os orçamentos que o usuário pode abrir
  const [todas, liberados] = await Promise.all([revisoesParaContrato(ex), idsComAcesso(ex, "orcamento", u)]);
  const revisoes = todas.filter((r) => !liberados || liberados.has(r.orcamentoId));
  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-slate-500"><Link href="/contratos" className="underline">Contratos</Link></p>
        <h1 className="text-2xl font-semibold">Novo contrato a partir do orçamento</h1>
        <p className="text-sm text-slate-500">A planilha contratual copia etapas, itens, códigos, descrições, unidades, quantidades, preços, BDI e memórias da revisão fechada escolhida. O preço unitário contratado começa igual ao orçado e pode ser ajustado à proposta vencedora.</p>
      </div>
      {revisoes.length === 0
        ? <p className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">Nenhuma revisão de orçamento fechada. Feche a revisão do orçamento (ou importe a planilha da proposta).</p>
        : <NovoContrato revisoes={revisoes} inicial={revisoes.some((r) => r.revisaoId === revisao) ? revisao! : ""} />}
    </div>
  );
}
