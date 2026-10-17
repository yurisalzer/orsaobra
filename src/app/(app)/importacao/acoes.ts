"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { exigirUsuario } from "@/lib/auth/sessao";
import { executor } from "@/lib/banco/servidor";
import { adaptadorPorId } from "@/lib/importacao/adaptadores";
import { amostraStaging, detalheImportacao } from "@/lib/importacao/consultas";
import {
  cancelarImportacao, confirmarImportacao, descartarBase, ErroImportacao, gravarLote, iniciarImportacao, publicarBase,
  validarBase, validarImportacao, type Lote,
} from "@/lib/importacao/servico";
import type { Identificacao } from "@/lib/importacao/tipos";

export type Resultado<T> = { ok: true; dados: T } | { ok: false; erro: string; codigo?: string };

async function executar<T>(f: (usuarioId: string) => Promise<T>): Promise<Resultado<T>> {
  try {
    const u = await exigirUsuario("ADMIN");
    return { ok: true, dados: await f(u.id) };
  } catch (e) {
    if (e instanceof ErroImportacao) return { ok: false, erro: e.message, codigo: e.codigo };
    // erros de redirecionamento do Next (sessão expirada) devem seguir adiante
    if ((e as { digest?: string }).digest?.startsWith("NEXT_REDIRECT")) throw e;
    console.error(e);
    return { ok: false, erro: (e as Error).message ?? "Erro inesperado." };
  }
}

const uuid = z.string().uuid();

const esquemaInicio = z.object({
  identificacao: z.object({
    adaptador: z.string(),
    versao: z.string(),
    fonte: z.enum(["SINAPI", "EMOP", "SICRO"]),
    uf: z.string().length(2),
    competencia: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
    layout: z.string(),
    regimes: z.array(z.object({ codigo: z.string(), nome: z.string(), descricao: z.string().optional() })).min(1),
    arquivos: z.array(z.object({ nome: z.string(), papel: z.string() })),
    dataEmissao: z.string().nullable().optional(),
    observacoes: z.array(z.string()),
  }),
  arquivos: z.array(z.object({ nome: z.string().max(300), tamanho: z.number().int().nonnegative(), sha256: z.string().regex(/^[0-9a-f]{64}$/) })).min(1).max(20),
  competenciaConfirmada: z.literal(true),
  autorizarDuplicidade: z.boolean(),
  retificacao: z.string().trim().min(5).max(500).nullable(),
});

export async function acaoIniciar(entrada: z.infer<typeof esquemaInicio>) {
  return executar(async (usuarioId) => {
    const p = esquemaInicio.parse(entrada);
    // o adaptador e sua versão precisam ser os do servidor
    const ad = adaptadorPorId(p.identificacao.adaptador);
    if (!ad || ad.versao !== p.identificacao.versao || ad.fonte !== p.identificacao.fonte) {
      throw new ErroImportacao("Versão do importador desatualizada no navegador. Recarregue a página.", "VERSAO");
    }
    const ex = await executor();
    return iniciarImportacao(ex, {
      ident: p.identificacao as Identificacao,
      arquivos: p.arquivos.map((a) => ({ ...a, papel: p.identificacao.arquivos.map((x) => x.nome).join(", ") })),
      usuarioId,
      autorizarDuplicidade: p.autorizarDuplicidade,
      retificacao: p.retificacao ? { motivo: p.retificacao } : null,
    });
  });
}

const LIMITE_LOTE = 5000;

export async function acaoEnviarLote(importacaoId: string, lote: Lote) {
  return executar(async () => {
    uuid.parse(importacaoId);
    const total = (lote.itens?.length ?? 0) + (lote.precos?.length ?? 0) + (lote.componentes?.length ?? 0) + (lote.ocorrencias?.length ?? 0);
    if (total > LIMITE_LOTE) throw new ErroImportacao("Lote grande demais.", "LOTE");
    await gravarLote(await executor(), importacaoId, lote);
    return total;
  });
}

export async function acaoValidar(importacaoId: string) {
  return executar(async () => {
    uuid.parse(importacaoId);
    const ex = await executor();
    const resumo = await validarImportacao(ex, importacaoId);
    const [detalhe, amostra] = await Promise.all([detalheImportacao(ex, importacaoId), amostraStaging(ex, importacaoId)]);
    return { resumo, grupos: detalhe?.grupos ?? [], amostra };
  });
}

export async function acaoConfirmar(importacaoId: string, cienteAvisos: boolean) {
  return executar(async (usuarioId) => {
    uuid.parse(importacaoId);
    await confirmarImportacao(await executor(), importacaoId, { usuarioId, cienteAvisos });
    revalidatePath("/importacao");
    return true;
  });
}

export async function acaoCancelar(importacaoId: string) {
  return executar(async (usuarioId) => {
    uuid.parse(importacaoId);
    await cancelarImportacao(await executor(), importacaoId, usuarioId);
    revalidatePath("/importacao");
    return true;
  });
}

export async function acaoValidarBase(revisaoId: string) {
  return executar(async (usuarioId) => {
    await validarBase(await executor(), uuid.parse(revisaoId), usuarioId);
    revalidatePath("/importacao");
    revalidatePath("/");
    return true;
  });
}

export async function acaoPublicarBase(revisaoId: string) {
  return executar(async (usuarioId) => {
    await publicarBase(await executor(), uuid.parse(revisaoId), usuarioId);
    revalidatePath("/importacao");
    revalidatePath("/");
    return true;
  });
}

export async function acaoDescartarBase(revisaoId: string, motivo: string) {
  return executar(async (usuarioId) => {
    const m = z.string().trim().min(5, "Informe o motivo (mínimo 5 caracteres).").max(500).parse(motivo);
    await descartarBase(await executor(), uuid.parse(revisaoId), usuarioId, m);
    revalidatePath("/importacao");
    return true;
  });
}
