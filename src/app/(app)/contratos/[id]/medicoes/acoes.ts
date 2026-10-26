"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { semAcessoContrato } from "@/lib/acesso-sessao";
import { ErroPermissao, exigirPermissao, temPermissao } from "@/lib/auth/sessao";
import { executor } from "@/lib/banco/servidor";
import {
  acrescentarMedicao, alterarPeriodo, ErroMedicao, excluirUltimaPrevista, fecharMedicao, iniciarMedicao, planejarMedicoes, reabrirMedicao, salvarLancamentos,
} from "@/lib/medicoes/servico";
import { dadosBoletim, dadosDesembolso, salvarDesembolso } from "@/lib/medicoes/relatorios";

type Resultado<T> = { ok: true; dados: T } | { ok: false; erro: string };
type Usuario = { id: string; administrador: boolean };

const uuid = z.string().uuid();

/** Executa com permissão MEDICOES_EDITAR e acesso de edição ao contrato. */
async function executar<T>(contratoId: string, f: (u: Usuario, ex: Awaited<ReturnType<typeof executor>>) => Promise<T>): Promise<Resultado<T>> {
  const negado = await semAcessoContrato(contratoId, "editar");
  if (negado) return negado;
  try {
    const u = await exigirPermissao("MEDICOES_EDITAR");
    const ex = await executor();
    const dados = await f({ id: u.id, administrador: temPermissao(u, "USUARIOS") }, ex);
    revalidatePath(`/contratos/${contratoId}/medicoes`, "layout");
    return { ok: true, dados };
  } catch (e) {
    if ((e as { digest?: string }).digest?.startsWith("NEXT_REDIRECT")) throw e;
    if (e instanceof ErroPermissao || e instanceof ErroMedicao) return { ok: false, erro: e.message };
    if (e instanceof z.ZodError) return { ok: false, erro: e.issues[0]?.message ?? "Dados inválidos." };
    const msg = (e as Error).message ?? "";
    if (/Medição fechada|alterada por outra pessoa/.test(msg)) return { ok: false, erro: msg.replace(/^.*?ERROR:\s*/, "") };
    console.error(e);
    return { ok: false, erro: "Não foi possível concluir a operação. Tente novamente." };
  }
}

/** Confere que a medição é do contrato informado (o acesso é verificado pelo contrato). */
async function daMedicao(ex: Awaited<ReturnType<typeof executor>>, contratoId: string, medicaoId: string) {
  const [m] = await ex.consulta<{ id: string }>(`SELECT id FROM medicao WHERE id = $1 AND contrato_id = $2`, [uuid.parse(medicaoId), contratoId]);
  if (!m) throw new ErroMedicao("Medição não encontrada.");
  return m.id;
}

const planejamento = z.object({
  inicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Informe a data de início."),
  quantidade: z.number().int(),
  dias: z.number().int().nullable(),
  servicoContinuo: z.boolean(),
});

export async function acaoPlanejarMedicoes(contratoId: string, d: z.infer<typeof planejamento>) {
  return executar(contratoId, (u, ex) => planejarMedicoes(ex, uuid.parse(contratoId), planejamento.parse(d), u.id));
}

export async function acaoAlterarPeriodo(contratoId: string, medicaoId: string, fim: string) {
  return executar(contratoId, async (u, ex) => alterarPeriodo(ex, await daMedicao(ex, contratoId, medicaoId), z.string().max(10).parse(fim), u.id));
}

export async function acaoAcrescentarMedicao(contratoId: string) {
  return executar(contratoId, (u, ex) => acrescentarMedicao(ex, uuid.parse(contratoId), u.id));
}

export async function acaoExcluirUltimaMedicao(contratoId: string) {
  return executar(contratoId, (u, ex) => excluirUltimaPrevista(ex, uuid.parse(contratoId), u.id));
}

export async function acaoIniciarMedicao(contratoId: string, medicaoId: string) {
  return executar(contratoId, async (u, ex) => iniciarMedicao(ex, await daMedicao(ex, contratoId, medicaoId), u.id));
}

export async function acaoSalvarLancamentos(contratoId: string, medicaoId: string, versao: number, lancamentos: { itemId: string; valor: string }[]) {
  return executar(contratoId, async (u, ex) => salvarLancamentos(
    ex, await daMedicao(ex, contratoId, medicaoId), z.number().int().parse(versao),
    z.array(z.object({ itemId: uuid, valor: z.string().max(40) })).max(5000).parse(lancamentos), u.id,
  ));
}

export async function acaoFecharMedicao(contratoId: string, medicaoId: string, versao: number, observacao: string) {
  return executar(contratoId, async (u, ex) => fecharMedicao(ex, await daMedicao(ex, contratoId, medicaoId), z.number().int().parse(versao), z.string().max(2000).parse(observacao), u.id));
}

export async function acaoReabrirMedicao(contratoId: string, medicaoId: string) {
  return executar(contratoId, async (u, ex) => reabrirMedicao(ex, await daMedicao(ex, contratoId, medicaoId), u));
}

/** Leitura (MEDICOES_VER e acesso de leitura ao contrato). */
async function ler<T>(contratoId: string, f: (ex: Awaited<ReturnType<typeof executor>>) => Promise<T>): Promise<Resultado<T & { rodape: string }>> {
  const negado = await semAcessoContrato(contratoId, "ver");
  if (negado) return negado;
  try {
    const u = await exigirPermissao("MEDICOES_VER");
    const dados = await f(await executor());
    const agora = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });
    return { ok: true, dados: { ...dados, rodape: `Emitido em ${agora} por ${u.nome} · Orçamento de Obras` } };
  } catch (e) {
    if ((e as { digest?: string }).digest?.startsWith("NEXT_REDIRECT")) throw e;
    if (e instanceof ErroPermissao || e instanceof ErroMedicao) return { ok: false, erro: e.message };
    if (e instanceof z.ZodError) return { ok: false, erro: "Dados inválidos." };
    console.error(e);
    return { ok: false, erro: "Não foi possível gerar o documento. Tente novamente." };
  }
}

export async function acaoDadosBoletim(contratoId: string, medicaoId: string) {
  return ler(contratoId, async (ex) => ({ boletim: await dadosBoletim(ex, await daMedicao(ex, contratoId, medicaoId)) }));
}

export async function acaoDadosDesembolso(contratoId: string, numero: number) {
  return ler(contratoId, async (ex) => ({ desembolso: await dadosDesembolso(ex, uuid.parse(contratoId), z.number().int().min(1).parse(numero)) }));
}

export async function acaoSalvarDesembolso(contratoId: string, previsto: Record<string, Record<string, string>>) {
  const dados = z.record(uuid, z.record(z.string().regex(/^\d{1,3}$/), z.string().max(20))).parse(previsto);
  return executar(contratoId, (u, ex) => salvarDesembolso(ex, uuid.parse(contratoId), dados as Record<string, Record<number, string>>, u.id));
}
