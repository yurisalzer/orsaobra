import { notFound } from "next/navigation";
import { acessoRevisao } from "@/lib/acesso";
import { SemAcessoItem } from "@/components/SemAcessoItem";
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
  const acesso = await acessoRevisao(ex, id, u);
  if (!acesso) notFound();
  if (!acesso.ver) return <SemAcessoItem tipo="orçamento" voltar="/orcamentos" />;
  const estado = await carregarRevisao(ex, id).catch((e) => { if (e instanceof ErroOrcamento) return null; throw e; });
  if (!estado) notFound();
  const [perfis, bases] = await Promise.all([listarPerfis(ex, true), basesDisponiveis(ex)]);
  // criador do orçamento ou administrador: desbloquear revisão fechada, excluir o orçamento e escolher quem tem acesso
  const dono = temPermissao(u, "ORCAMENTOS_EDITAR") && acesso.gerenciar;
  return (
    <Editor
      estado={estado}
      perfis={perfis.map((p) => ({ id: p.id, nome: p.nome, bdi: p.bdiAplicado }))}
      bases={bases.filter((b) => b.publicada).map((b) => ({ revisaoId: b.revisaoId, fonte: b.fonte, rotulo: rotuloBase(b), regimes: b.regimes }))}
      podeEditar={acesso.editar}
      podeRelatorios={temPermissao(u, "RELATORIOS")}
      podeGerenciar={dono}
      podeContrato={temPermissao(u, "MEDICOES_EDITAR")}
      podeCompartilhar={acesso.gerenciar}
    />
  );
}
