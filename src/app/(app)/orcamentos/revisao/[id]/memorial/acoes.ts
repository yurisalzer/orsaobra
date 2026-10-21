"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ErroPermissao, exigirPermissao } from "@/lib/auth/sessao";
import { executor } from "@/lib/banco/servidor";
import { descartarMemorial, ErroMemorial, LIMITES_MEMORIAL as L, salvarMemorial, sugerirMemorial, type ConteudoMemorial } from "@/lib/relatorios/memorial";
import type { Resultado } from "../../../acoes";

const conteudo = z.object({
  data: z.string().max(L.data),
  obra: z.string().max(L.obra),
  secoes: z.array(z.object({
    id: z.string().max(20),
    nivel: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    titulo: z.string().max(L.titulo),
    texto: z.string().max(L.texto),
    destaque: z.boolean().optional(),
  })).max(L.secoes),
});

async function executar<T>(f: (usuarioId: string) => Promise<T>, revisaoId: string): Promise<Resultado<T>> {
  try {
    const u = await exigirPermissao("ORCAMENTOS_EDITAR");
    const dados = await f(u.id);
    revalidatePath(`/orcamentos/revisao/${revisaoId}/memorial`);
    return { ok: true, dados };
  } catch (e) {
    if ((e as { digest?: string }).digest?.startsWith("NEXT_REDIRECT")) throw e;
    if (e instanceof ErroPermissao || e instanceof ErroMemorial) return { ok: false, erro: e.message };
    if (e instanceof z.ZodError) return { ok: false, erro: e.issues[0]?.message ?? "Dados inválidos." };
    console.error(e);
    return { ok: false, erro: "Não foi possível concluir a operação. Tente novamente." };
  }
}

export async function acaoSalvarMemorial(revisaoId: string, c: ConteudoMemorial) {
  return executar(async (u) => salvarMemorial(await executor(), z.string().uuid().parse(revisaoId), conteudo.parse(c), u), revisaoId);
}

/** Descarta o texto editado e devolve a sugestão do sistema. */
export async function acaoRestaurarMemorial(revisaoId: string) {
  return executar(async (u) => {
    const ex = await executor();
    const id = z.string().uuid().parse(revisaoId);
    await descartarMemorial(ex, id, u);
    return sugerirMemorial(ex, id);
  }, revisaoId);
}
