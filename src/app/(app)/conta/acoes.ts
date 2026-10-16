"use server";

import { comandoAuditoria } from "@/lib/auditoria";
import { exigirUsuario } from "@/lib/auth/sessao";
import { conferirSenha, gerarHashSenha, validarForcaSenha } from "@/lib/auth/senha";
import { executor } from "@/lib/banco/servidor";

export interface EstadoSenha { erro?: string; ok?: boolean }

export async function acaoTrocarSenha(_: EstadoSenha, form: FormData): Promise<EstadoSenha> {
  const u = await exigirUsuario();
  const atual = String(form.get("atual") ?? "");
  const nova = String(form.get("nova") ?? "");
  const repetir = String(form.get("repetir") ?? "");
  if (nova !== repetir) return { erro: "A confirmação não confere com a nova senha." };
  const problema = validarForcaSenha(nova);
  if (problema) return { erro: problema };
  const ex = await executor();
  const [reg] = await ex.consulta<{ senha_hash: string }>(`SELECT senha_hash FROM usuario WHERE id = $1`, [u.id]);
  if (!reg || !(await conferirSenha(atual, reg.senha_hash))) return { erro: "Senha atual incorreta." };
  await ex.transacao([
    { sql: `UPDATE usuario SET senha_hash = $2, atualizado_em = now() WHERE id = $1`, params: [u.id, await gerarHashSenha(nova)] },
    comandoAuditoria({ usuarioId: u.id, acao: "SENHA_ALTERADA", entidade: "usuario", entidadeId: u.id }),
  ]);
  return { ok: true };
}
