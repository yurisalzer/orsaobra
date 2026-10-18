"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ErroPermissao, exigirPermissao } from "@/lib/auth/sessao";
import { executor } from "@/lib/banco/servidor";
import { basePadraoPorFonte, basesDisponiveis } from "@/lib/referencia/bases";
import { buscarItens } from "@/lib/referencia/busca";
import { ErroProprio, registrarCotacao, salvarComposicaoPropria, salvarInsumoProprio } from "@/lib/referencia/proprios";

export type Resultado<T> = { ok: true; dados: T } | { ok: false; erro: string };

async function executar<T>(f: (usuarioId: string) => Promise<T>): Promise<Resultado<T>> {
  try {
    const u = await exigirPermissao("COMPOSICOES");
    return { ok: true, dados: await f(u.id) };
  } catch (e) {
    if ((e as { digest?: string }).digest?.startsWith("NEXT_REDIRECT")) throw e;
    if (e instanceof ErroPermissao) return { ok: false, erro: e.message };
    if (e instanceof ErroProprio) return { ok: false, erro: e.message };
    if (e instanceof z.ZodError) return { ok: false, erro: e.issues[0]?.message ?? "Dados inválidos." };
    console.error(e);
    return { ok: false, erro: "Não foi possível salvar. Tente novamente." };
  }
}

/** Busca de componentes para o editor (bases publicadas mais recentes + próprios). */
export async function acaoBuscarComponentes(texto: string) {
  return executar(async () => {
    const ex = await executor();
    const revisoes = Object.values(basePadraoPorFonte(await basesDisponiveis(ex))).map((b) => b.revisaoId);
    const r = await buscarItens(ex, { texto: z.string().max(120).parse(texto), revisoes, incluirProprios: true, limite: 15 });
    return r.itens.map((i) => ({ itemId: i.itemId, fonte: i.fonte, tipo: i.tipo, codigo: i.codigo, descricao: i.descricao, unidade: i.unidade }));
  });
}

const esquemaComp = z.object({
  itemId: z.string().uuid().nullable(),
  versaoEsperada: z.number().int().nullable(),
  codigo: z.string().max(30),
  descricao: z.string().max(1000),
  unidade: z.string().max(10),
  observacao: z.string().max(1000).nullable(),
  componentes: z.array(z.object({ itemId: z.string().uuid(), coeficiente: z.string().max(40) })).max(300),
});

export async function acaoSalvarComposicao(d: z.infer<typeof esquemaComp>) {
  return executar(async (usuarioId) => {
    const p = esquemaComp.parse(d);
    const id = await salvarComposicaoPropria(await executor(), p, usuarioId);
    revalidatePath("/composicoes");
    return id;
  });
}

const esquemaInsumo = z.object({
  itemId: z.string().uuid().nullable(),
  versaoEsperada: z.number().int().nullable(),
  codigo: z.string().max(30),
  descricao: z.string().max(1000),
  unidade: z.string().max(10),
});

export async function acaoSalvarInsumo(d: z.infer<typeof esquemaInsumo>) {
  return executar(async (usuarioId) => {
    const id = await salvarInsumoProprio(await executor(), esquemaInsumo.parse(d), usuarioId);
    revalidatePath("/composicoes");
    return id;
  });
}

const esquemaCotacao = z.object({
  itemId: z.string().uuid(),
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida."),
  valor: z.string().max(30),
  fonteCotacao: z.string().max(300),
  observacao: z.string().max(1000).nullable(),
});

export async function acaoRegistrarCotacao(d: z.infer<typeof esquemaCotacao>) {
  return executar(async (usuarioId) => {
    const p = esquemaCotacao.parse(d);
    await registrarCotacao(await executor(), p, usuarioId);
    revalidatePath(`/consulta/item/${p.itemId}`);
    return true;
  });
}
