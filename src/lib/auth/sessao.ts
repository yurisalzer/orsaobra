import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { comandoAuditoria } from "../auditoria";
import { executor } from "../banco/servidor";
import { CODIGOS_PERMISSAO, PERMISSOES, type Permissao } from "./permissoes";
import { conferirSenha } from "./senha";

export type { Permissao } from "./permissoes";

export const COOKIE_SESSAO = "sessao";
const DURACAO_MS = 12 * 60 * 60 * 1000; // 12 horas
const MAX_TENTATIVAS = 5;
const BLOQUEIO_MS = 15 * 60 * 1000;

const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

async function ipAtual(): Promise<string | null> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0].trim() ?? h.get("x-real-ip");
}

export type ResultadoLogin = { ok: true } | { ok: false; mensagem: string };

export async function entrar(email: string, senha: string): Promise<ResultadoLogin> {
  const ex = await executor();
  const ip = await ipAtual();
  const [usuario] = await ex.consulta<{ id: string; senha_hash: string; ativo: boolean; tentativas: number; bloqueado: boolean }>(
    `SELECT id, senha_hash, ativo, tentativas, (bloqueado_ate IS NOT NULL AND bloqueado_ate > now()) AS bloqueado FROM usuario WHERE email = $1`,
    [email.trim().toLowerCase()],
  );
  const falha: ResultadoLogin = { ok: false, mensagem: "E-mail ou senha inválidos." };

  if (usuario?.bloqueado) {
    await ex.transacao([comandoAuditoria({ usuarioId: usuario.id, acao: "LOGIN_BLOQUEADO", entidade: "usuario", entidadeId: usuario.id, ip })]);
    return { ok: false, mensagem: "Muitas tentativas. Tente novamente em alguns minutos." };
  }
  const senhaOk = await conferirSenha(senha, usuario?.senha_hash ?? null);
  if (!usuario || !senhaOk || !usuario.ativo) {
    if (usuario) {
      const tentativas = usuario.tentativas + 1;
      const bloquear = tentativas >= MAX_TENTATIVAS;
      await ex.transacao([
        {
          sql: `UPDATE usuario SET tentativas = $2, bloqueado_ate = CASE WHEN $3 THEN now() + ($4 || ' milliseconds')::interval ELSE bloqueado_ate END WHERE id = $1`,
          params: [usuario.id, bloquear ? 0 : tentativas, bloquear, String(BLOQUEIO_MS)],
        },
        comandoAuditoria({ usuarioId: usuario.id, acao: "LOGIN_FALHOU", entidade: "usuario", entidadeId: usuario.id, ip }),
      ]);
    }
    return falha;
  }

  const token = randomBytes(32).toString("base64url");
  const expiraEm = new Date(Date.now() + DURACAO_MS);
  const h = await headers();
  await ex.transacao([
    { sql: `UPDATE usuario SET tentativas = 0, bloqueado_ate = NULL WHERE id = $1`, params: [usuario.id] },
    {
      sql: `INSERT INTO sessao (usuario_id, token_hash, expira_em, ip, user_agent) VALUES ($1, $2, $3, $4, $5)`,
      params: [usuario.id, hashToken(token), expiraEm.toISOString(), ip, h.get("user-agent")?.slice(0, 300) ?? null],
    },
    { sql: `DELETE FROM sessao WHERE usuario_id = $1 AND expira_em < now()`, params: [usuario.id] },
    comandoAuditoria({ usuarioId: usuario.id, acao: "LOGIN", entidade: "usuario", entidadeId: usuario.id, ip }),
  ]);
  (await cookies()).set(COOKIE_SESSAO, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiraEm,
  });
  return { ok: true };
}

export async function sair() {
  const jar = await cookies();
  const token = jar.get(COOKIE_SESSAO)?.value;
  if (token) await (await executor()).consulta(`DELETE FROM sessao WHERE token_hash = $1`, [hashToken(token)]);
  jar.delete(COOKIE_SESSAO);
}

export interface UsuarioSessao {
  id: string;
  email: string;
  nome: string;
  permissoes: Permissao[];
}

export async function usuarioAtual(): Promise<UsuarioSessao | null> {
  const token = (await cookies()).get(COOKIE_SESSAO)?.value;
  if (!token) return null;
  const [u] = await (await executor()).consulta<UsuarioSessao>(
    `SELECT u.id, u.email, u.nome,
            ARRAY(SELECT p.permissao FROM usuario_permissao p WHERE p.usuario_id = u.id ORDER BY p.permissao) AS permissoes
       FROM sessao s JOIN usuario u ON u.id = s.usuario_id
      WHERE s.token_hash = $1 AND s.expira_em > now() AND u.ativo`,
    [hashToken(token)],
  );
  if (!u) return null;
  return { ...u, permissoes: u.permissoes.filter((p): p is Permissao => CODIGOS_PERMISSAO.includes(p)) };
}

export function temPermissao(u: { permissoes: readonly string[] }, p: Permissao): boolean {
  return u.permissoes.includes(p);
}

/** Erro de permissão em ações do servidor (vira mensagem para o usuário). */
export class ErroPermissao extends Error {
  constructor(p: Permissao) {
    super(`Você não tem permissão para esta ação (${PERMISSOES.find((x) => x.codigo === p)!.nome}). Fale com o administrador.`);
  }
}

/**
 * Para páginas: exige login e, se informada, a permissão (sem ela, mostra a
 * página "sem acesso"). Para ações, use exigirPermissao.
 */
export async function exigirUsuario(permissao?: Permissao): Promise<UsuarioSessao> {
  const u = await usuarioAtual();
  if (!u) redirect("/login");
  if (permissao && !temPermissao(u, permissao)) redirect(`/sem-acesso?p=${permissao}`);
  return u;
}

/** Para ações do servidor: exige login e a permissão; sem ela, lança ErroPermissao. */
export async function exigirPermissao(permissao: Permissao): Promise<UsuarioSessao> {
  const u = await usuarioAtual();
  if (!u) redirect("/login");
  if (!temPermissao(u, permissao)) throw new ErroPermissao(permissao);
  return u;
}
