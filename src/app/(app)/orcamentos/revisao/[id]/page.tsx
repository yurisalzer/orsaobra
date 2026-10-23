import { notFound } from "next/navigation";
import { z } from "zod";
import { exigirUsuario, temPermissao } from "@/lib/auth/sessao";
import { executor } from "@/lib/banco/servidor";
import { listarPerfis } from "@/lib/orcamento/bdi";
import { carregarRevisao, ErroOrcamento } from "@/lib/orcamento/servico";
import { basesDisponiveis, rotuloBase } from "@/lib/referencia/bases";
import { Editor } from "./Editor";

export const dynamic = "force-dynamic";

export default async function PaginaRevisao({ params }: { params: Promise<{ id: string }> }) {
  const u = await exigirUsuario("ORCAMENTOS_VER");
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const ex = await executor();
  const estado = await carregarRevisao(ex, id).catch((e) => { if (e instanceof ErroOrcamento) return null; throw e; });
  if (!estado) notFound();
  const [perfis, bases, [criador]] = await Promise.all([
    listarPerfis(ex, true), basesDisponiveis(ex),
    ex.consulta<{ id: string | null }>(`SELECT criado_por_id AS id FROM orcamento_revisao WHERE orcamento_id = $1 ORDER BY numero LIMIT 1`, [estado.orcamento.id]),
  ]);
  // criador do orçamento ou administrador: desbloquear revisão fechada e excluir o orçamento
  const dono = temPermissao(u, "ORCAMENTOS_EDITAR") && (temPermissao(u, "USUARIOS") || criador?.id === u.id);
  return (
    <Editor
      estado={estado}
      perfis={perfis.map((p) => ({ id: p.id, nome: p.nome, bdi: p.bdiAplicado }))}
      bases={bases.filter((b) => b.publicada).map((b) => ({ revisaoId: b.revisaoId, fonte: b.fonte, rotulo: rotuloBase(b), regimes: b.regimes }))}
      podeEditar={temPermissao(u, "ORCAMENTOS_EDITAR")}
      podeRelatorios={temPermissao(u, "RELATORIOS")}
      podeGerenciar={dono}
      podeContrato={temPermissao(u, "MEDICOES_EDITAR")}
    />
  );
}
