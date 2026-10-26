import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { exigirUsuario, temPermissao } from "@/lib/auth/sessao";
import { executor } from "@/lib/banco/servidor";
import { acessoA } from "@/lib/acesso";
import { SemAcessoItem } from "@/components/SemAcessoItem";
import { carregarMedicao, ErroMedicao } from "@/lib/medicoes/servico";
import { LancamentoMedicao } from "./LancamentoMedicao";
import { DocumentosMedicao } from "./DocumentosMedicao";

export const dynamic = "force-dynamic";

export default async function PaginaMedicao({ params }: { params: Promise<{ id: string; medicaoId: string }> }) {
  const u = await exigirUsuario("MEDICOES_VER");
  const { id, medicaoId } = await params;
  if (!z.string().uuid().safeParse(id).success || !z.string().uuid().safeParse(medicaoId).success) notFound();
  const ex = await executor();
  const acesso = await acessoA(ex, "contrato", id, u);
  if (!acesso) notFound();
  if (!acesso.ver) return <SemAcessoItem tipo="contrato" voltar="/contratos" />;
  const e = await carregarMedicao(ex, medicaoId).catch((err) => { if (err instanceof ErroMedicao) return null; throw err; });
  if (!e || e.contrato.id !== id) notFound();
  const [resp] = await ex.consulta<{ responsavelTecnico: string | null; artRrt: string | null }>(
    `SELECT responsavel_tecnico AS "responsavelTecnico", art_rrt AS "artRrt" FROM contrato WHERE id = $1`, [id],
  );
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">
        <Link href="/contratos" className="underline">Contratos</Link> · <Link href={`/contratos/${id}`} className="underline">Contrato {e.contrato.numero}</Link> · <Link href={`/contratos/${id}/medicoes`} className="underline">Medições</Link> · {e.medicao.numero}ª medição
      </p>
      <LancamentoMedicao estado={e} podeEditar={acesso.editar} podeGerenciar={acesso.gerenciar && temPermissao(u, "MEDICOES_EDITAR")}
        documentos={e.medicao.situacao === "FECHADA" && (
          <DocumentosMedicao contratoId={id} contratoNumero={e.contrato.numero} medicaoId={medicaoId} numero={e.medicao.numero}
            fechadaPor={e.medicao.fechadaPor} responsavelTecnico={resp?.responsavelTecnico ?? null} artRrt={resp?.artRrt ?? null} />
        )} />
    </div>
  );
}
