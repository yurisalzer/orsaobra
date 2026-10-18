/**
 * Autocadastro: qualquer pessoa cria a conta na tela de login, confirma o
 * e-mail pelo link recebido e aguarda o administrador liberar o acesso
 * (ativar o usuário e marcar as permissões). Sem liberação, não entra.
 *
 * Proteções: senha só em hash (bcrypt); código de confirmação aleatório,
 * guardado só em hash, válido por 48 h e de uso único; limite de pedidos por
 * IP; resposta igual para e-mail/CPF já cadastrados (não revela quem existe).
 */
import { createHash, randomBytes } from "node:crypto";
import type { Executor } from "../banco/executor";
import { comandoAuditoria } from "../auditoria";
import { enviarEmail } from "../email/enviar";
import { gerarHashSenha, validarForcaSenha } from "./senha";

export class ErroCadastro extends Error {}

const VALIDADE_MS = 48 * 60 * 60 * 1000;
const LIMITE_POR_HORA = 5;
const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");
const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** CPF só com dígitos, se válido (dígitos verificadores conferidos); senão null. */
export function normalizarCpf(cpf: string): string | null {
  const d = cpf.replace(/\D/g, "");
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return null;
  const dv = (n: number) => {
    let s = 0;
    for (let i = 0; i < n; i++) s += Number(d[i]) * (n + 1 - i);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10]) ? d : null;
}

export const formatarCpf = (d: string) => d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");

/** Telefone com DDD (10 ou 11 dígitos), formatado; "" = não informado; null = inválido. */
export function normalizarTelefone(t: string): string | null {
  const d = t.replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "");
  if (d.length === 0) return "";
  if (d.length !== 10 && d.length !== 11) return null;
  return d.length === 11 ? `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}` : `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
}

export interface DadosCadastro {
  nome: string;
  email: string;
  senha: string;
  confirmacaoSenha: string;
  cpf: string;
  telefone?: string;
}

interface Contexto {
  ip: string | null;
  /** Endereço do sistema (para montar os links), sem barra no fim. */
  urlBase: string;
}

async function limitarPorIp(ex: Executor, acao: string, ip: string | null) {
  if (!ip) return;
  const [r] = await ex.consulta<{ n: string }>(
    `SELECT count(*) AS n FROM auditoria WHERE acao = $1 AND ip = $2 AND criado_em > now() - interval '1 hour'`, [acao, ip],
  );
  if (Number(r.n) >= LIMITE_POR_HORA) throw new ErroCadastro("Muitas solicitações a partir desta rede. Tente novamente em uma hora.");
}

async function enviarConfirmacao(ex: Executor, u: { id: string; nome: string; email: string }, urlBase: string) {
  const token = randomBytes(32).toString("base64url");
  await ex.consulta(`INSERT INTO confirmacao_email (token_hash, usuario_id, expira_em) VALUES ($1, $2, $3)`,
    [hashToken(token), u.id, new Date(Date.now() + VALIDADE_MS).toISOString()]);
  const link = `${urlBase}/cadastro/confirmar?token=${token}`;
  await enviarEmail(ex, {
    para: u.email, motivo: "CONFIRMACAO", usuarioId: u.id,
    assunto: "Confirme seu e-mail — Orçamento de Obras",
    texto: `Olá, ${u.nome}.\n\nRecebemos o seu cadastro no sistema Orçamento de Obras. Para confirmar o seu e-mail, abra o link abaixo (válido por 48 horas):\n\n${link}\n\n` +
      `Depois da confirmação, o administrador analisará o cadastro e liberará o acesso. Você receberá outro e-mail quando isso acontecer.\n\n` +
      `Se você não fez este cadastro, ignore esta mensagem.`,
  });
}

/** Cria a conta (inativa, sem permissões) e envia o e-mail de confirmação. */
export async function criarCadastro(ex: Executor, d: DadosCadastro, ctx: Contexto): Promise<void> {
  const nome = d.nome.trim().replace(/\s+/g, " ");
  const email = d.email.trim().toLowerCase();
  if (nome.length < 5 || !nome.includes(" ")) throw new ErroCadastro("Informe o nome completo.");
  if (nome.length > 120) throw new ErroCadastro("Nome muito longo.");
  if (!RE_EMAIL.test(email) || email.length > 200) throw new ErroCadastro("Informe um e-mail válido.");
  const cpf = normalizarCpf(d.cpf);
  if (!cpf) throw new ErroCadastro("CPF inválido. Confira os números digitados.");
  const telefone = normalizarTelefone(d.telefone ?? "");
  if (telefone === null) throw new ErroCadastro("Telefone inválido. Informe o DDD e o número.");
  const problema = validarForcaSenha(d.senha);
  if (problema) throw new ErroCadastro(problema);
  if (d.senha !== d.confirmacaoSenha) throw new ErroCadastro("A confirmação não confere com a senha.");
  await limitarPorIp(ex, "CADASTRO_SOLICITADO", ctx.ip);

  const existentes = await ex.consulta<{ id: string; email: string; nome: string; email_confirmado: boolean }>(
    `SELECT id, email, nome, email_confirmado_em IS NOT NULL AS email_confirmado FROM usuario WHERE email = $1 OR cpf = $2`, [email, cpf],
  );
  if (existentes.length) {
    // mesma resposta da tela; quem é dono do e-mail recebe a explicação
    await ex.transacao([comandoAuditoria({ acao: "CADASTRO_SOLICITADO", entidade: "usuario", entidadeId: existentes[0].id, ip: ctx.ip, depois: { duplicado: true } })]);
    const mesmo = existentes.find((u) => u.email === email);
    if (mesmo && !mesmo.email_confirmado) return enviarConfirmacao(ex, mesmo, ctx.urlBase);
    await enviarEmail(ex, {
      para: email, motivo: "CADASTRO_DUPLICADO", usuarioId: mesmo?.id ?? null,
      assunto: "Tentativa de cadastro — Orçamento de Obras",
      texto: mesmo
        ? `Olá.\n\nAlguém (possivelmente você) tentou criar uma conta com este e-mail, mas ele já está cadastrado. Para entrar, use a tela de login: ${ctx.urlBase}/login\n\nSe esqueceu a senha, peça ao administrador uma senha provisória.`
        : `Olá.\n\nNão foi possível concluir o cadastro: o CPF informado já pertence a outra conta. Se acredita que isso é um engano, procure o administrador do sistema.`,
    });
    return;
  }

  const id = crypto.randomUUID();
  await ex.transacao([
    {
      sql: `INSERT INTO usuario (id, email, nome, senha_hash, papel, ativo, cpf, telefone, origem, atualizado_em)
            VALUES ($1, $2, $3, $4, 'LEITOR', false, $5, $6, 'AUTOCADASTRO', now())`,
      params: [id, email, nome, await gerarHashSenha(d.senha), cpf, telefone || null],
    },
    comandoAuditoria({ usuarioId: id, acao: "CADASTRO_SOLICITADO", entidade: "usuario", entidadeId: id, ip: ctx.ip, depois: { nome, email, telefone: telefone || null } }),
  ]);
  await enviarConfirmacao(ex, { id, nome, email }, ctx.urlBase);
}

export type ResultadoConfirmacao = { ok: true; nome: string; jaConfirmado: boolean } | { ok: false; mensagem: string };

/** Confirma o e-mail pelo código do link e avisa os administradores. */
export async function confirmarEmail(ex: Executor, token: string, urlBase: string): Promise<ResultadoConfirmacao> {
  if (!/^[\w-]{20,100}$/.test(token)) return { ok: false, mensagem: "Link de confirmação inválido." };
  const [c] = await ex.consulta<{ usuario_id: string; nome: string; email: string; cpf: string | null; telefone: string | null; expirado: boolean; usado: boolean; confirmado: boolean }>(
    `SELECT c.usuario_id, u.nome, u.email, u.cpf, u.telefone, c.expira_em < now() AS expirado, c.usado_em IS NOT NULL AS usado,
            u.email_confirmado_em IS NOT NULL AS confirmado
       FROM confirmacao_email c JOIN usuario u ON u.id = c.usuario_id WHERE c.token_hash = $1`, [hashToken(token)],
  );
  if (!c) return { ok: false, mensagem: "Link de confirmação inválido." };
  if (c.confirmado) return { ok: true, nome: c.nome, jaConfirmado: true };
  if (c.usado || c.expirado) return { ok: false, mensagem: "Este link expirou. Solicite um novo e-mail de confirmação." };
  await ex.transacao([
    { sql: `UPDATE usuario SET email_confirmado_em = now(), atualizado_em = now() WHERE id = $1`, params: [c.usuario_id] },
    { sql: `UPDATE confirmacao_email SET usado_em = now() WHERE usuario_id = $1 AND usado_em IS NULL`, params: [c.usuario_id] },
    comandoAuditoria({ usuarioId: c.usuario_id, acao: "EMAIL_CONFIRMADO", entidade: "usuario", entidadeId: c.usuario_id }),
  ]);
  const admins = await ex.consulta<{ email: string; id: string }>(
    `SELECT u.id, u.email FROM usuario u JOIN usuario_permissao p ON p.usuario_id = u.id AND p.permissao = 'USUARIOS' WHERE u.ativo`,
  );
  for (const a of admins) {
    await enviarEmail(ex, {
      para: a.email, motivo: "NOVO_CADASTRO", usuarioId: a.id,
      assunto: `Novo cadastro aguardando liberação: ${c.nome}`,
      texto: `Um novo usuário confirmou o e-mail e aguarda a liberação do acesso.\n\nNome: ${c.nome}\nE-mail: ${c.email}\nCPF: ${c.cpf ? formatarCpf(c.cpf) : "—"}\nTelefone: ${c.telefone ?? "—"}\n\n` +
        `Para liberar, abra "Usuários e permissões", marque "Ativo" e as permissões desejadas:\n${urlBase}/usuarios`,
    });
  }
  return { ok: true, nome: c.nome, jaConfirmado: false };
}

/** Novo link de confirmação (resposta sempre genérica). */
export async function reenviarConfirmacao(ex: Executor, emailInformado: string, ctx: Contexto): Promise<void> {
  const email = emailInformado.trim().toLowerCase();
  if (!RE_EMAIL.test(email)) throw new ErroCadastro("Informe um e-mail válido.");
  await limitarPorIp(ex, "CONFIRMACAO_REENVIADA", ctx.ip);
  const [u] = await ex.consulta<{ id: string; nome: string; email: string }>(
    `SELECT id, nome, email FROM usuario WHERE email = $1 AND email_confirmado_em IS NULL`, [email],
  );
  await ex.transacao([comandoAuditoria({ acao: "CONFIRMACAO_REENVIADA", entidade: "usuario", entidadeId: u?.id ?? null, ip: ctx.ip })]);
  if (u) await enviarConfirmacao(ex, u, ctx.urlBase);
}
