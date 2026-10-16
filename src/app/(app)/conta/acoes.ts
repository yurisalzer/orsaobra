"use server";

import { prisma } from "@/lib/db";
import { auditar } from "@/lib/auditoria";
import { exigirUsuario } from "@/lib/auth/sessao";
import { conferirSenha, gerarHashSenha, validarForcaSenha } from "@/lib/auth/senha";

export interface EstadoSenha { erro?: string; ok?: boolean }

export async function acaoTrocarSenha(_: EstadoSenha, form: FormData): Promise<EstadoSenha> {
  const u = await exigirUsuario();
  const atual = String(form.get("atual") ?? "");
  const nova = String(form.get("nova") ?? "");
  const repetir = String(form.get("repetir") ?? "");
  if (nova !== repetir) return { erro: "A confirmação não confere com a nova senha." };
  const problema = validarForcaSenha(nova);
  if (problema) return { erro: problema };
  const reg = await prisma.usuario.findUniqueOrThrow({ where: { id: u.id } });
  if (!(await conferirSenha(atual, reg.senhaHash))) return { erro: "Senha atual incorreta." };
  await prisma.$transaction(async (tx) => {
    await tx.usuario.update({ where: { id: u.id }, data: { senhaHash: await gerarHashSenha(nova) } });
    await auditar({ usuarioId: u.id, acao: "SENHA_ALTERADA", entidade: "usuario", entidadeId: u.id }, tx);
  });
  return { ok: true };
}
