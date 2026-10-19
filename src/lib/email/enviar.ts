/**
 * Envio de e-mails do sistema. Usa a API HTTP da Resend (funciona na
 * Cloudflare, sem SMTP), configurada por variáveis de ambiente:
 *  - RESEND_API_KEY: chave da API (segredo);
 *  - EMAIL_REMETENTE: ex. "Orçamento de Obras <nao-responda@seudominio.com.br>".
 * Sem configuração, o e-mail não sai, mas fica registrado na caixa de saída
 * (tabela email_saida) com status NAO_CONFIGURADO — o administrador vê o que
 * teria sido enviado. Todo envio, com sucesso ou não, é registrado.
 */
import type { Executor } from "../banco/executor";

export interface Email {
  para: string;
  assunto: string;
  texto: string;
  html?: string;
  /** Por que o e-mail foi gerado (CONFIRMACAO, NOVO_CADASTRO, ACESSO_LIBERADO…). */
  motivo: string;
  usuarioId?: string | null;
  /** Endereço para a resposta (ex.: o e-mail de quem preencheu o formulário de contato). */
  responderPara?: string | null;
}

export type StatusEnvio = "ENVIADO" | "FALHOU" | "NAO_CONFIGURADO";

export function emailConfigurado(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_REMETENTE);
}

const escapar = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** HTML simples a partir do texto (parágrafos; URLs viram links). */
export function htmlDeTexto(texto: string): string {
  const corpo = texto.split(/\n{2,}/).map((p) =>
    `<p>${escapar(p).replace(/\n/g, "<br>").replace(/https?:\/\/[^\s<]+/g, (u) => `<a href="${u}">${u}</a>`)}</p>`).join("");
  return `<div style="font-family:Arial,sans-serif;font-size:14px;color:#1e293b;line-height:1.5">${corpo}</div>`;
}

export async function enviarEmail(ex: Executor, e: Email): Promise<StatusEnvio> {
  const html = e.html ?? htmlDeTexto(e.texto);
  let status: StatusEnvio = "NAO_CONFIGURADO";
  let erro: string | null = null;
  let idProvedor: string | null = null;
  if (emailConfigurado()) {
    try {
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: process.env.EMAIL_REMETENTE, to: [e.para], subject: e.assunto, text: e.texto, html, ...(e.responderPara ? { reply_to: e.responderPara } : {}) }),
      });
      const corpo = (await r.json().catch(() => ({}))) as { id?: string; message?: string };
      if (r.ok) { status = "ENVIADO"; idProvedor = corpo.id ?? null; }
      else { status = "FALHOU"; erro = `HTTP ${r.status}: ${corpo.message ?? ""}`.slice(0, 500); }
    } catch (x) {
      status = "FALHOU";
      erro = String((x as Error).message ?? x).slice(0, 500);
    }
  }
  await ex.consulta(
    `INSERT INTO email_saida (para, assunto, texto, html, motivo, usuario_id, status, erro, id_provedor) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [e.para, e.assunto, e.texto, html, e.motivo, e.usuarioId ?? null, status, erro, idProvedor],
  );
  if (status === "FALHOU") console.error(`[e-mail] falha ao enviar "${e.assunto}" para ${e.para}: ${erro}`);
  return status;
}

export interface EmailRegistrado {
  id: string;
  para: string;
  assunto: string;
  texto: string;
  motivo: string;
  status: StatusEnvio;
  erro: string | null;
  criadoEm: string;
}

export async function listarCaixaSaida(ex: Executor, limite = 50): Promise<EmailRegistrado[]> {
  return ex.consulta<EmailRegistrado>(
    `SELECT id, para, assunto, texto, motivo, status, erro,
            to_char(criado_em AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') AS "criadoEm"
       FROM email_saida ORDER BY criado_em DESC LIMIT $1`, [limite],
  );
}
