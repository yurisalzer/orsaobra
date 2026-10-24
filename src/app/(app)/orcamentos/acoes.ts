"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ErroPermissao, exigirPermissao, temPermissao, type Permissao } from "@/lib/auth/sessao";
import { semAcessoRevisao as semAcesso } from "@/lib/acesso-sessao";
import { executor } from "@/lib/banco/servidor";
import { arquivarPerfil, ErroBdi, salvarPerfil } from "@/lib/orcamento/bdi";
import {
  adicionarItem, alterarItem, alterarObra, atualizarBdi, desbloquearRevisao, gerarVersaoRegime, basesDaRevisao, configurarRevisao, criarEtapa, criarObra, criarOrcamento, duplicarOrcamento, ErroOrcamento,
  excluirEtapa, excluirItem, excluirObra, excluirOrcamento, fecharRevisao, moverEtapa, moverItem, novaRevisao, renomearEtapa, renomearOrcamento, reprecificarRevisao, salvarCronograma, trocarItem,
} from "@/lib/orcamento/servico";
import { buscarItens } from "@/lib/referencia/busca";

export type Resultado<T> = { ok: true; dados: T } | { ok: false; erro: string };

async function executar<T>(f: (usuarioId: string) => Promise<T>, caminho?: string, permissao: Permissao = "ORCAMENTOS_EDITAR"): Promise<Resultado<T>> {
  try {
    const u = await exigirPermissao(permissao);
    const dados = await f(u.id);
    if (caminho) revalidatePath(caminho);
    return { ok: true, dados };
  } catch (e) {
    if ((e as { digest?: string }).digest?.startsWith("NEXT_REDIRECT")) throw e;
    if (e instanceof ErroPermissao) return { ok: false, erro: e.message };
    if (e instanceof ErroOrcamento || e instanceof ErroBdi) return { ok: false, erro: e.message };
    if (e instanceof z.ZodError) return { ok: false, erro: e.issues[0]?.message ?? "Dados inválidos." };
    const msg = (e as Error).message ?? "";
    // mensagens de regras do banco (imp_exigir / gatilhos) são seguras para exibir
    const regra = /(alterado por outra pessoa|fechada|não pode ser|desbloque|Só a última|Já existe uma revisão|já está em elaboração|Nenhuma base deste|BDI não pode|percentual de BDI|BDI com no máximo|BDI grande|BDI foi alterado|tem orçamentos|preço informado|vem da base|não encontrad|publicada|Etapa)/i.test(msg) ? msg.replace(/^.*?ERROR:\s*/, "") : null;
    if (!regra) console.error(e);
    return { ok: false, erro: regra ?? "Não foi possível concluir a operação. Tente novamente." };
  }
}

const uuid = z.string().uuid();
const base = z.object({ baseRevisaoId: uuid, regime: z.string().max(40).nullable() });
const modo = z.enum(["ARREDONDAR", "TRUNCAR"]);
const novaObra = z.object({
  nome: z.string().max(200), codigo: z.string().max(60), processo: z.string().max(100), descricao: z.string().max(4000),
  endereco: z.string().max(300), municipio: z.string().max(100), orgaoSolicitante: z.string().max(200),
  cabecalhoId: z.union([z.literal(""), z.string().uuid()]),
});
export type DadosNovaObra = z.infer<typeof novaObra>;

export async function acaoCriarOrcamento(d: { obraId: string | null; novaObra: DadosNovaObra | null; codigo: string; titulo: string; bases: { baseRevisaoId: string; regime: string | null }[]; bdiPerfilId: string | null; arredondamento: string }) {
  return executar(async (u) => {
    const ex = await executor();
    const obraId = d.obraId ? uuid.parse(d.obraId) : await criarObra(ex, novaObra.parse(d.novaObra), u);
    return criarOrcamento(ex, {
      obraId, codigo: z.string().max(60).parse(d.codigo), titulo: z.string().max(200).parse(d.titulo), bases: z.array(base).min(1, "Escolha ao menos uma base de referência.").parse(d.bases),
      bdiPerfilId: d.bdiPerfilId ? uuid.parse(d.bdiPerfilId) : null, arredondamento: modo.parse(d.arredondamento),
    }, u);
  }, "/orcamentos");
}

export async function acaoAlterarObra(obraId: string, antes: DadosNovaObra, depois: DadosNovaObra) {
  return executar((u) => executor().then((ex) => alterarObra(ex, uuid.parse(obraId), novaObra.parse(antes), novaObra.parse(depois), u)), "/orcamentos");
}

export async function acaoConfigurar(revisaoId: string, versao: number, d: { descricao?: string | null; bases?: { baseRevisaoId: string; regime: string | null }[]; bdiPerfilId?: string | null; arredondamento?: string; dataReferencia?: string }) {
  const negado = await semAcesso(revisaoId, "editar");
  if (negado) return negado;
  return executar((u) => executor().then((ex) => configurarRevisao(ex, uuid.parse(revisaoId), versao, {
    descricao: d.descricao, bases: d.bases ? z.array(base).parse(d.bases) : undefined,
    bdiPerfilId: d.bdiPerfilId === undefined ? undefined : d.bdiPerfilId ? uuid.parse(d.bdiPerfilId) : null,
    arredondamento: d.arredondamento ? modo.parse(d.arredondamento) : undefined, dataReferencia: d.dataReferencia,
  }, u)));
}

export async function acaoCriarEtapa(revisaoId: string, versao: number, paiId: string | null, titulo: string) {
  const negado = await semAcesso(revisaoId, "editar");
  if (negado) return negado;
  return executar((u) => executor().then((ex) => criarEtapa(ex, uuid.parse(revisaoId), versao, { paiId: paiId ? uuid.parse(paiId) : null, titulo: z.string().max(300).parse(titulo) }, u)));
}
export async function acaoRenomearEtapa(revisaoId: string, versao: number, etapaId: string, titulo: string) {
  const negado = await semAcesso(revisaoId, "editar");
  if (negado) return negado;
  return executar((u) => executor().then((ex) => renomearEtapa(ex, uuid.parse(revisaoId), versao, uuid.parse(etapaId), z.string().max(300).parse(titulo), u)));
}
export async function acaoExcluirEtapa(revisaoId: string, versao: number, etapaId: string) {
  const negado = await semAcesso(revisaoId, "editar");
  if (negado) return negado;
  return executar((u) => executor().then((ex) => excluirEtapa(ex, uuid.parse(revisaoId), versao, uuid.parse(etapaId), u)));
}
export async function acaoMoverEtapa(revisaoId: string, versao: number, etapaId: string, direcao: -1 | 1) {
  const negado = await semAcesso(revisaoId, "editar");
  if (negado) return negado;
  return executar((u) => executor().then((ex) => moverEtapa(ex, uuid.parse(revisaoId), versao, uuid.parse(etapaId), direcao === 1 ? 1 : -1, u)));
}

export async function acaoBuscarParaOrcamento(revisaoId: string, texto: string) {
  const negado = await semAcesso(revisaoId, "editar");
  if (negado) return negado;
  return executar(async () => {
    const ex = await executor();
    const bases = await basesDaRevisao(ex, uuid.parse(revisaoId));
    // somente itens em conformidade com o regime adotado no orçamento (por fonte)
    const r = await buscarItens(ex, {
      texto: z.string().max(120).parse(texto), revisoes: bases.map((b) => b.baseRevisaoId), incluirProprios: true, limite: 20,
      regimeAdotado: bases.map((b) => ({ revisaoId: b.baseRevisaoId, regime: b.regime })),
    });
    return {
      total: r.total,
      itens: r.itens.map((i) => {
        const regime = bases.find((b) => b.fonte === i.fonte)?.regime ?? "";
        return { itemId: i.itemId, fonte: i.fonte, tipo: i.tipo, codigo: i.codigo, descricao: i.descricao, unidade: i.unidade, preco: i.precos[regime] ?? i.precos[""] ?? null };
      }),
    };
  });
}

export async function acaoAdicionarItem(revisaoId: string, versao: number, d: { etapaId: string; itemReferenciaId: string; quantidade: string; memoriaQuantitativo?: string | null; base: { baseRevisaoId: string; regime: string | null } | null }) {
  const negado = await semAcesso(revisaoId, "editar");
  if (negado) return negado;
  return executar((u) => executor().then((ex) => adicionarItem(ex, uuid.parse(revisaoId), versao, {
    etapaId: uuid.parse(d.etapaId), itemReferenciaId: uuid.parse(d.itemReferenciaId), quantidade: z.string().max(40).parse(d.quantidade),
    memoriaQuantitativo: d.memoriaQuantitativo ? z.string().max(4000, "Memória de cálculo com mais de 4.000 caracteres.").parse(d.memoriaQuantitativo) : null,
    base: d.base ? base.parse(d.base) : null,
  }, u)));
}

export async function acaoAlterarItem(revisaoId: string, versao: number, itemId: string, d: { quantidade?: string; memoriaQuantitativo?: string | null; bdiPerfilId?: string | null; bdiInformado?: string; base?: { baseRevisaoId: string; regime: string | null }; etapaId?: string; custoInformado?: string }) {
  const negado = await semAcesso(revisaoId, "editar");
  if (negado) return negado;
  return executar((u) => executor().then((ex) => alterarItem(ex, uuid.parse(revisaoId), versao, uuid.parse(itemId), {
    quantidade: d.quantidade !== undefined ? z.string().max(40).parse(d.quantidade) : undefined,
    memoriaQuantitativo: d.memoriaQuantitativo !== undefined ? z.string().max(4000, "Memória de cálculo com mais de 4.000 caracteres.").nullable().parse(d.memoriaQuantitativo) : undefined,
    bdiPerfilId: d.bdiPerfilId === undefined ? undefined : d.bdiPerfilId ? uuid.parse(d.bdiPerfilId) : null,
    base: d.base ? base.parse(d.base) : undefined, etapaId: d.etapaId ? uuid.parse(d.etapaId) : undefined,
    custoInformado: d.custoInformado !== undefined ? z.string().max(40).parse(d.custoInformado) : undefined,
    bdiInformado: d.bdiInformado !== undefined ? z.string().max(20).parse(d.bdiInformado) : undefined,
  }, u)));
}
export async function acaoTrocarItem(revisaoId: string, versao: number, itemId: string, novoItemReferenciaId: string) {
  const negado = await semAcesso(revisaoId, "editar");
  if (negado) return negado;
  return executar((u) => executor().then((ex) => trocarItem(ex, uuid.parse(revisaoId), versao, uuid.parse(itemId), uuid.parse(novoItemReferenciaId), u)));
}
export async function acaoExcluirItem(revisaoId: string, versao: number, itemId: string) {
  const negado = await semAcesso(revisaoId, "editar");
  if (negado) return negado;
  return executar((u) => executor().then((ex) => excluirItem(ex, uuid.parse(revisaoId), versao, uuid.parse(itemId), u)));
}
export async function acaoMoverItem(revisaoId: string, versao: number, itemId: string, direcao: -1 | 1) {
  const negado = await semAcesso(revisaoId, "editar");
  if (negado) return negado;
  return executar((u) => executor().then((ex) => moverItem(ex, uuid.parse(revisaoId), versao, uuid.parse(itemId), direcao === 1 ? 1 : -1, u)));
}
export async function acaoReprecificar(revisaoId: string, versao: number) {
  const negado = await semAcesso(revisaoId, "editar");
  if (negado) return negado;
  return executar((u) => executor().then((ex) => reprecificarRevisao(ex, uuid.parse(revisaoId), versao, u)));
}
export async function acaoFechar(revisaoId: string, versao: number) {
  const negado = await semAcesso(revisaoId, "editar");
  if (negado) return negado;
  return executar((u) => executor().then((ex) => fecharRevisao(ex, uuid.parse(revisaoId), versao, u)), "/orcamentos");
}
export async function acaoAtualizarBdi(revisaoId: string, versao: number) {
  const negado = await semAcesso(revisaoId, "editar");
  if (negado) return negado;
  return executar((u) => executor().then((ex) => atualizarBdi(ex, uuid.parse(revisaoId), versao, u)), "/orcamentos");
}
export async function acaoNovaRevisao(origemId: string, descricao: string, novasBases: { baseRevisaoId: string; regime: string | null }[] | null) {
  const negado = await semAcesso(origemId, "editar");
  if (negado) return negado;
  return executar((u) => executor().then((ex) => novaRevisao(ex, uuid.parse(origemId), { descricao: z.string().max(300).parse(descricao), novasBases: novasBases ? z.array(base).parse(novasBases) : null }, u)), "/orcamentos");
}
export async function acaoDuplicar(revisaoId: string, titulo: string) {
  const negado = await semAcesso(revisaoId, "ver");
  if (negado) return negado;
  return executar((u) => executor().then((ex) => duplicarOrcamento(ex, uuid.parse(revisaoId), { titulo: z.string().max(200).parse(titulo) }, u)), "/orcamentos");
}

const parcela = z.object({ tipo: z.enum(["AC", "S", "R", "G", "DF", "L", "I"]), nome: z.string().max(100), percentual: z.string().max(20) });
export async function acaoSalvarPerfil(d: { id: string | null; nome: string; descricao: string | null; percentualInformado: string | null; parcelas: { tipo: string; nome: string; percentual: string }[] }) {
  return executar((u) => executor().then((ex) => salvarPerfil(ex, {
    id: d.id ? uuid.parse(d.id) : null, nome: z.string().max(120).parse(d.nome), descricao: d.descricao ? z.string().max(500).parse(d.descricao) : null,
    percentualInformado: d.percentualInformado, parcelas: z.array(parcela).max(30).parse(d.parcelas),
  }, u)), "/bdi", "BDI");
}
export async function acaoArquivarPerfil(id: string, ativo: boolean) {
  return executar((u) => executor().then((ex) => arquivarPerfil(ex, uuid.parse(id), ativo, u)), "/bdi", "BDI");
}

export async function acaoSalvarCronograma(revisaoId: string, versao: number, d: { meses: number; parcelas: { etapaId: string; periodo: number; percentual: string }[] }) {
  const negado = await semAcesso(revisaoId, "editar");
  if (negado) return negado;
  return executar((u) => executor().then((ex) => salvarCronograma(ex, uuid.parse(revisaoId), versao, z.object({
    meses: z.number().int(), parcelas: z.array(z.object({ etapaId: uuid, periodo: z.number().int(), percentual: z.string().max(20) })).max(5000),
  }).parse(d), u)));
}

/** Exclui o orçamento: só em elaboração, por quem o criou ou pelo administrador (permissão "Usuários"). */
export async function acaoExcluirOrcamento(orcamentoId: string) {
  return executar(async (usuarioId) => {
    const u = await exigirPermissao("ORCAMENTOS_EDITAR");
    await excluirOrcamento(await executor(), uuid.parse(orcamentoId), { id: usuarioId, administrador: temPermissao(u, "USUARIOS") });
  }, "/orcamentos");
}

/** Exclui a obra sem orçamentos: quem a cadastrou ou o administrador. */
export async function acaoExcluirObra(obraId: string) {
  return executar(async (usuarioId) => {
    const u = await exigirPermissao("ORCAMENTOS_EDITAR");
    await excluirObra(await executor(), uuid.parse(obraId), { id: usuarioId, administrador: temPermissao(u, "USUARIOS") });
  }, "/orcamentos");
}

/** Gera a versão do orçamento com ou sem desoneração (outro orçamento ligado, para comparação). */
export async function acaoGerarVersaoRegime(revisaoId: string, regime: string, titulo: string) {
  const negado = await semAcesso(revisaoId, "ver");
  if (negado) return negado;
  return executar((u) => executor().then((ex) => gerarVersaoRegime(ex, uuid.parse(revisaoId), {
    regime: z.enum(["COM_DESONERACAO", "SEM_DESONERACAO"]).parse(regime), titulo: z.string().max(200).parse(titulo),
  }, u)), "/orcamentos");
}

/** Desbloqueia a revisão fechada para edição: quem criou o orçamento ou o administrador. */
/** Altera o nome do orçamento: quem o criou ou o administrador. */
export async function acaoRenomearOrcamento(orcamentoId: string, titulo: string) {
  return executar(async (usuarioId) => {
    const u = await exigirPermissao("ORCAMENTOS_EDITAR");
    await renomearOrcamento(await executor(), uuid.parse(orcamentoId), z.string().max(400).parse(titulo), { id: usuarioId, administrador: temPermissao(u, "USUARIOS") });
  }, "/orcamentos");
}

export async function acaoDesbloquearRevisao(revisaoId: string) {
  return executar(async (usuarioId) => {
    const u = await exigirPermissao("ORCAMENTOS_EDITAR");
    await desbloquearRevisao(await executor(), uuid.parse(revisaoId), { id: usuarioId, administrador: temPermissao(u, "USUARIOS") });
  }, "/orcamentos");
}
