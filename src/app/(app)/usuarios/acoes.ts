"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ErroPermissao, exigirPermissao } from "@/lib/auth/sessao";
import { CODIGOS_PERMISSAO, type Permissao } from "@/lib/auth/permissoes";
import { criarUsuario, definirAtivo, definirPermissao, ErroUsuarios, redefinirSenha, substituirPermissoes } from "@/lib/auth/usuarios";
import { executor } from "@/lib/banco/servidor";
import { urlBase } from "@/lib/auth/requisicao";

type Resultado<T> = { ok: true; dados: T } | { ok: false; erro: string };

async function executar<T>(f: (autorId: string) => Promise<T>): Promise<Resultado<T>> {
  try {
    const u = await exigirPermissao("USUARIOS");
    const dados = await f(u.id);
    revalidatePath("/usuarios");
    return { ok: true, dados };
  } catch (e) {
    if ((e as { digest?: string }).digest?.startsWith("NEXT_REDIRECT")) throw e;
    if (e instanceof ErroUsuarios || e instanceof ErroPermissao) return { ok: false, erro: e.message };
    if (e instanceof z.ZodError) return { ok: false, erro: e.issues[0]?.message ?? "Dados inválidos." };
    const msg = (e as Error).message ?? "";
    if (/ao menos um usuário ativo/.test(msg)) return { ok: false, erro: msg.replace(/^.*?ERROR:\s*/, "") };
    console.error(e);
    return { ok: false, erro: "Não foi possível salvar. Tente novamente." };
  }
}

const uuid = z.string().uuid();
const permissao = z.enum(CODIGOS_PERMISSAO as [Permissao, ...Permissao[]]);

export async function acaoDefinirPermissao(usuarioId: string, p: string, conceder: boolean) {
  return executar((autor) => executor().then((ex) => definirPermissao(ex, uuid.parse(usuarioId), permissao.parse(p), conceder, autor)));
}
export async function acaoAplicarModelo(usuarioId: string, permissoes: string[]) {
  return executar((autor) => executor().then((ex) => substituirPermissoes(ex, uuid.parse(usuarioId), z.array(permissao).parse(permissoes), autor)));
}
export async function acaoDefinirAtivo(usuarioId: string, ativo: boolean) {
  return executar((autor) => executor().then(async (ex) => definirAtivo(ex, uuid.parse(usuarioId), ativo, autor, await urlBase())));
}
export async function acaoCriarUsuario(d: { nome: string; email: string; senha: string; permissoes: string[] }) {
  return executar((autor) => executor().then((ex) => criarUsuario(ex, {
    nome: z.string().max(120).parse(d.nome), email: z.string().max(200).parse(d.email), senha: z.string().max(200).parse(d.senha),
    permissoes: z.array(permissao).parse(d.permissoes),
  }, autor)));
}
export async function acaoRedefinirSenha(usuarioId: string) {
  return executar((autor) => executor().then((ex) => redefinirSenha(ex, uuid.parse(usuarioId), autor)));
}
