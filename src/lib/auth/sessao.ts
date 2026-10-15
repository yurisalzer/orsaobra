import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import type { Papel, Usuario } from "@prisma/client";
import { prisma } from "../db";
import { auditar } from "../auditoria";
import { conferirSenha } from "./senha";

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
  const ip = await ipAtual();
  const usuario = await prisma.usuario.findUnique({ where: { email: email.trim().toLowerCase() } });
  const falha: ResultadoLogin = { ok: false, mensagem: "E-mail ou senha inválidos." };

  if (usuario?.bloqueadoAte && usuario.bloqueadoAte > new Date()) {
    await auditar({ usuarioId: usuario.id, acao: "LOGIN_BLOQUEADO", entidade: "usuario", entidadeId: usuario.id, ip });
    return { ok: false, mensagem: "Muitas tentativas. Tente novamente em alguns minutos." };
  }
  const senhaOk = await conferirSenha(senha, usuario?.senhaHash ?? null);
  if (!usuario || !senhaOk || !usuario.ativo) {
    if (usuario) {
      const tentativas = usuario.tentativas + 1;
      await prisma.usuario.update({
        where: { id: usuario.id },
        data: {
          tentativas: tentativas >= MAX_TENTATIVAS ? 0 : tentativas,
          bloqueadoAte: tentativas >= MAX_TENTATIVAS ? new Date(Date.now() + BLOQUEIO_MS) : undefined,
        },
      });
      await auditar({ usuarioId: usuario.id, acao: "LOGIN_FALHOU", entidade: "usuario", entidadeId: usuario.id, ip });
    }
    return falha;
  }

  const token = randomBytes(32).toString("base64url");
  const expiraEm = new Date(Date.now() + DURACAO_MS);
  const h = await headers();
  await prisma.$transaction(async (tx) => {
    await tx.usuario.update({ where: { id: usuario.id }, data: { tentativas: 0, bloqueadoAte: null } });
    await tx.sessao.create({
      data: { usuarioId: usuario.id, tokenHash: hashToken(token), expiraEm, ip, userAgent: h.get("user-agent")?.slice(0, 300) },
    });
    await auditar({ usuarioId: usuario.id, acao: "LOGIN", entidade: "usuario", entidadeId: usuario.id, ip }, tx);
  });
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
  if (token) await prisma.sessao.deleteMany({ where: { tokenHash: hashToken(token) } });
  jar.delete(COOKIE_SESSAO);
}

export type UsuarioSessao = Pick<Usuario, "id" | "email" | "nome" | "papel">;

export async function usuarioAtual(): Promise<UsuarioSessao | null> {
  const token = (await cookies()).get(COOKIE_SESSAO)?.value;
  if (!token) return null;
  const sessao = await prisma.sessao.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { usuario: { select: { id: true, email: true, nome: true, papel: true, ativo: true } } },
  });
  if (!sessao || sessao.expiraEm < new Date() || !sessao.usuario.ativo) return null;
  const { id, email, nome, papel } = sessao.usuario;
  return { id, email, nome, papel };
}

const HIERARQUIA: Record<Papel, number> = { LEITOR: 1, ORCAMENTISTA: 2, ADMIN: 3 };

export function temPapel(u: Pick<Usuario, "papel">, minimo: Papel): boolean {
  return HIERARQUIA[u.papel] >= HIERARQUIA[minimo];
}

/** Para páginas e ações do servidor: exige login (e papel mínimo). */
export async function exigirUsuario(minimo: Papel = "LEITOR"): Promise<UsuarioSessao> {
  const u = await usuarioAtual();
  if (!u) redirect("/login");
  if (!temPapel(u, minimo)) throw new Error("Permissão insuficiente.");
  return u;
}
