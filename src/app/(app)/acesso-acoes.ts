"use server";

import { z } from "zod";
import { definirAcesso, ErroAcesso, exigirAcesso, listarCompartilhamento, type Recurso, type UsuarioCompartilhamento } from "@/lib/acesso";
import { usuarioAtual } from "@/lib/auth/sessao";
import { executor } from "@/lib/banco/servidor";

type Resultado<T> = { ok: true; dados: T } | { ok: false; erro: string };
const recurso = z.enum(["orcamento", "contrato"]);

async function executar<T>(f: (u: NonNullable<Awaited<ReturnType<typeof usuarioAtual>>>) => Promise<T>): Promise<Resultado<T>> {
  try {
    const u = await usuarioAtual();
    if (!u) return { ok: false, erro: "Sessão expirada. Entre novamente." };
    return { ok: true, dados: await f(u) };
  } catch (e) {
    if (e instanceof ErroAcesso) return { ok: false, erro: e.message };
    if (e instanceof z.ZodError) return { ok: false, erro: "Dados inválidos." };
    console.error(e);
    return { ok: false, erro: "Não foi possível concluir a operação. Tente novamente." };
  }
}

/** Usuários e o acesso de cada um (só para o criador ou o administrador). */
export async function acaoListarAcesso(tipo: Recurso, id: string): Promise<Resultado<UsuarioCompartilhamento[]>> {
  return executar(async (u) => {
    const ex = await executor();
    const r = recurso.parse(tipo);
    const alvo = z.string().uuid().parse(id);
    await exigirAcesso(ex, r, alvo, u, "gerenciar");
    return listarCompartilhamento(ex, r, alvo);
  });
}

export async function acaoDefinirAcesso(tipo: Recurso, id: string, usuarioId: string, nivel: "VER" | "EDITAR" | null) {
  return executar(async (u) => definirAcesso(await executor(), recurso.parse(tipo), z.string().uuid().parse(id), z.string().uuid().parse(usuarioId),
    z.enum(["VER", "EDITAR"]).nullable().parse(nivel), u));
}
