/**
 * Verificação de acesso individual nas ações do servidor: devolve o erro a
 * mostrar (ou null quando o usuário da sessão pode prosseguir).
 */
import { z } from "zod";
import { ErroAcesso, exigirAcesso, exigirAcessoRevisao } from "@/lib/acesso";
import { ErroPermissao, exigirPermissao } from "@/lib/auth/sessao";
import { executor } from "@/lib/banco/servidor";

type Negado = { ok: false; erro: string };

async function verificar(f: () => Promise<unknown>): Promise<Negado | null> {
  try {
    await f();
    return null;
  } catch (e) {
    if ((e as { digest?: string }).digest?.startsWith("NEXT_REDIRECT")) throw e;
    if (e instanceof ErroAcesso || e instanceof ErroPermissao) return { ok: false, erro: e.message };
    if (e instanceof z.ZodError) return { ok: false, erro: "Identificador inválido." };
    throw e;
  }
}

export function semAcessoRevisao(revisaoId: string, nivel: "ver" | "editar"): Promise<Negado | null> {
  return verificar(async () => {
    const u = await exigirPermissao(nivel === "editar" ? "ORCAMENTOS_EDITAR" : "ORCAMENTOS_VER");
    await exigirAcessoRevisao(await executor(), z.string().uuid().parse(revisaoId), u, nivel);
  });
}

export function semAcessoContrato(contratoId: string, nivel: "ver" | "editar"): Promise<Negado | null> {
  return verificar(async () => {
    const u = await exigirPermissao(nivel === "editar" ? "MEDICOES_EDITAR" : "MEDICOES_VER");
    await exigirAcesso(await executor(), "contrato", z.string().uuid().parse(contratoId), u, nivel);
  });
}
