"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { exigirUsuario } from "@/lib/auth/sessao";
import { executor } from "@/lib/banco/servidor";
import { arquivarCabecalho, ErroCabecalho, salvarCabecalho } from "@/lib/relatorios/cabecalhos";

type Resultado<T> = { ok: true; dados: T } | { ok: false; erro: string };

async function executar<T>(f: (usuarioId: string) => Promise<T>): Promise<Resultado<T>> {
  try {
    const u = await exigirUsuario("ORCAMENTISTA");
    const dados = await f(u.id);
    revalidatePath("/cabecalhos");
    return { ok: true, dados };
  } catch (e) {
    if ((e as { digest?: string }).digest?.startsWith("NEXT_REDIRECT")) throw e;
    if (e instanceof ErroCabecalho) return { ok: false, erro: e.message };
    if (e instanceof z.ZodError) return { ok: false, erro: e.issues[0]?.message ?? "Dados inválidos." };
    console.error(e);
    return { ok: false, erro: "Não foi possível salvar. Tente novamente." };
  }
}

const dados = z.object({
  id: z.string().uuid().nullable(),
  nome: z.string().max(120),
  linhas: z.array(z.string().max(150, "Cada linha pode ter no máximo 150 caracteres.")).max(6, "Use no máximo 6 linhas."),
  // undefined = manter o logo atual; null = remover
  logo: z.object({ tipo: z.string().max(40), base64: z.string().max(720_000, "A imagem do logo deve ter no máximo 512 KB.") }).nullable().optional(),
  padrao: z.boolean(),
});

export async function acaoSalvarCabecalho(d: z.input<typeof dados>) {
  return executar((u) => executor().then((ex) => salvarCabecalho(ex, dados.parse(d), u)));
}

export async function acaoArquivarCabecalho(id: string, ativo: boolean) {
  return executar((u) => executor().then((ex) => arquivarCabecalho(ex, z.string().uuid().parse(id), ativo, u)));
}
