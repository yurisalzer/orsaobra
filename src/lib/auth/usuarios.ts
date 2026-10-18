/**
 * Gestão de usuários e permissões (área "Usuários", só para quem tem a
 * permissão USUARIOS). Regras de segurança:
 *  - sempre resta ao menos um usuário ativo com a permissão USUARIOS;
 *  - ninguém retira de si mesmo a permissão USUARIOS nem desativa a si mesmo;
 *  - toda alteração é auditada (antes/depois).
 */
import { randomBytes } from "node:crypto";
import type { Executor } from "../banco/executor";
import { comandoAuditoria } from "../auditoria";
import { completarPermissoes, DEPENDE_DE, type Permissao } from "./permissoes";
import { enviarEmail } from "../email/enviar";
import { formatarCpf } from "./cadastro";
import { gerarHashSenha, validarForcaSenha } from "./senha";

export class ErroUsuarios extends Error {}

export interface UsuarioLista {
  id: string;
  nome: string;
  email: string;
  ativo: boolean;
  permissoes: Permissao[];
  ultimoAcesso: string | null;
  criadoEm: string;
  cpf: string | null;
  telefone: string | null;
  origem: "ADMINISTRADOR" | "AUTOCADASTRO";
  emailConfirmado: boolean;
  /** Acesso já liberado alguma vez pelo administrador. */
  aprovado: boolean;
}

export async function listarUsuarios(ex: Executor): Promise<UsuarioLista[]> {
  const l = await ex.consulta<UsuarioLista>(
    `SELECT u.id, u.nome, u.email, u.ativo, u.cpf, u.telefone, u.origem,
            u.email_confirmado_em IS NOT NULL AS "emailConfirmado", u.aprovado_em IS NOT NULL AS aprovado,
            ARRAY(SELECT p.permissao FROM usuario_permissao p WHERE p.usuario_id = u.id ORDER BY p.permissao) AS permissoes,
            (SELECT to_char(max(a.criado_em) AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') FROM auditoria a WHERE a.usuario_id = u.id AND a.acao = 'LOGIN') AS "ultimoAcesso",
            to_char(u.criado_em AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY') AS "criadoEm"
       FROM usuario u
      ORDER BY (u.aprovado_em IS NULL) DESC, u.ativo DESC, lower(u.nome)`,
  );
  return l.map((u) => ({ ...u, cpf: u.cpf ? formatarCpf(u.cpf) : null }));
}

async function permissoesDe(ex: Executor, id: string) {
  const [u] = await ex.consulta<{ ativo: boolean; permissoes: string[] }>(
    `SELECT ativo, ARRAY(SELECT permissao FROM usuario_permissao WHERE usuario_id = id ORDER BY permissao) AS permissoes FROM usuario WHERE id = $1`, [id],
  );
  if (!u) throw new ErroUsuarios("Usuário não encontrado.");
  return u;
}

/** Comando que garante, na mesma transação, que resta um administrador ativo. */
const garantirAdministrador = {
  sql: `SELECT imp_exigir(EXISTS (SELECT 1 FROM usuario u JOIN usuario_permissao p ON p.usuario_id = u.id AND p.permissao = 'USUARIOS' WHERE u.ativo),
                          'É preciso manter ao menos um usuário ativo com a permissão "Usuários e permissões".')`,
  params: [] as unknown[],
};

/**
 * Marca ou desmarca uma permissão de um usuário. Dependências são mantidas:
 * marcar "Editar orçamentos" marca "Ver orçamentos"; desmarcar "Ver
 * orçamentos" desmarca o que depende dela. Retorna as permissões finais.
 */
export async function definirPermissao(ex: Executor, alvoId: string, permissao: Permissao, conceder: boolean, autorId: string): Promise<Permissao[]> {
  if (alvoId === autorId && permissao === "USUARIOS" && !conceder) throw new ErroUsuarios("Você não pode retirar de si mesmo a permissão de gerenciar usuários.");
  const atual = await permissoesDe(ex, alvoId);
  let nova = new Set(atual.permissoes);
  if (conceder) nova.add(permissao);
  else {
    nova.delete(permissao);
    // o que depende da permissão retirada também sai
    for (const [p, d] of Object.entries(DEPENDE_DE)) if (d === permissao) nova.delete(p);
  }
  const final = completarPermissoes(nova);
  nova = new Set(final);
  await ex.transacao([
    { sql: `DELETE FROM usuario_permissao WHERE usuario_id = $1 AND NOT (permissao = ANY($2::text[]))`, params: [alvoId, final] },
    { sql: `INSERT INTO usuario_permissao (usuario_id, permissao) SELECT $1, unnest($2::text[]) ON CONFLICT DO NOTHING`, params: [alvoId, final] },
    garantirAdministrador,
    comandoAuditoria({ usuarioId: autorId, acao: "PERMISSOES_ALTERADAS", entidade: "usuario", entidadeId: alvoId, antes: { permissoes: atual.permissoes }, depois: { permissoes: final } }),
  ]);
  return final;
}

/** Substitui todas as permissões (ex.: aplicar um modelo). */
export async function substituirPermissoes(ex: Executor, alvoId: string, permissoes: Permissao[], autorId: string): Promise<Permissao[]> {
  const final = completarPermissoes(permissoes);
  if (alvoId === autorId && !final.includes("USUARIOS")) throw new ErroUsuarios("Você não pode retirar de si mesmo a permissão de gerenciar usuários.");
  const atual = await permissoesDe(ex, alvoId);
  await ex.transacao([
    { sql: `DELETE FROM usuario_permissao WHERE usuario_id = $1`, params: [alvoId] },
    { sql: `INSERT INTO usuario_permissao (usuario_id, permissao) SELECT $1, unnest($2::text[])`, params: [alvoId, final] },
    garantirAdministrador,
    comandoAuditoria({ usuarioId: autorId, acao: "PERMISSOES_ALTERADAS", entidade: "usuario", entidadeId: alvoId, antes: { permissoes: atual.permissoes }, depois: { permissoes: final } }),
  ]);
  return final;
}

/**
 * Ativa ou desativa. A primeira ativação de um autocadastro é a liberação do
 * acesso: registra aprovado_em e avisa o usuário por e-mail.
 */
export async function definirAtivo(ex: Executor, alvoId: string, ativo: boolean, autorId: string, urlBase?: string) {
  if (alvoId === autorId && !ativo) throw new ErroUsuarios("Você não pode desativar o seu próprio usuário.");
  await permissoesDe(ex, alvoId);
  const [alvo] = await ex.consulta<{ nome: string; email: string; aprovado: boolean; email_confirmado: boolean }>(
    `SELECT nome, email, aprovado_em IS NOT NULL AS aprovado, email_confirmado_em IS NOT NULL AS email_confirmado FROM usuario WHERE id = $1`, [alvoId],
  );
  const liberacao = ativo && !alvo.aprovado;
  await ex.transacao([
    { sql: `UPDATE usuario SET ativo = $2, aprovado_em = CASE WHEN $2 THEN coalesce(aprovado_em, now()) ELSE aprovado_em END, atualizado_em = now() WHERE id = $1`, params: [alvoId, ativo] },
    // desativado: encerra as sessões abertas
    ...(ativo ? [] : [{ sql: `DELETE FROM sessao WHERE usuario_id = $1`, params: [alvoId] }]),
    garantirAdministrador,
    comandoAuditoria({ usuarioId: autorId, acao: liberacao ? "ACESSO_LIBERADO" : ativo ? "USUARIO_ATIVADO" : "USUARIO_DESATIVADO", entidade: "usuario", entidadeId: alvoId }),
  ]);
  if (liberacao) {
    await enviarEmail(ex, {
      para: alvo.email, motivo: "ACESSO_LIBERADO", usuarioId: alvoId,
      assunto: "Acesso liberado — Orçamento de Obras",
      texto: `Olá, ${alvo.nome}.\n\nO administrador liberou o seu acesso ao sistema Orçamento de Obras.` +
        (urlBase ? ` Entre com o seu e-mail e a senha cadastrada: ${urlBase}/login` : " Entre com o seu e-mail e a senha cadastrada.") +
        (alvo.email_confirmado ? "" : "\n\nAntes, confirme o seu e-mail pelo link que enviamos no cadastro."),
    });
  }
}

/** Senha provisória legível (sem caracteres ambíguos), com letras e números. */
export function gerarSenhaProvisoria(): string {
  const letras = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";
  const numeros = "23456789";
  const todos = letras + numeros;
  const b = randomBytes(12);
  let s = "";
  for (let i = 0; i < 12; i++) s += (i === 3 ? numeros : i === 0 ? letras : todos)[b[i] % (i === 3 ? numeros.length : i === 0 ? letras.length : todos.length)];
  return s;
}

export async function criarUsuario(ex: Executor, d: { nome: string; email: string; senha: string; permissoes: Permissao[] }, autorId: string) {
  const nome = d.nome.trim();
  const email = d.email.trim().toLowerCase();
  if (nome.length < 2) throw new ErroUsuarios("Informe o nome.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ErroUsuarios("E-mail inválido.");
  const problema = validarForcaSenha(d.senha);
  if (problema) throw new ErroUsuarios(problema);
  const [existe] = await ex.consulta<{ id: string }>(`SELECT id FROM usuario WHERE email = $1`, [email]);
  if (existe) throw new ErroUsuarios("Já existe um usuário com esse e-mail.");
  const id = crypto.randomUUID();
  const permissoes = completarPermissoes(d.permissoes);
  await ex.transacao([
    { sql: `INSERT INTO usuario (id, email, nome, senha_hash, papel, email_confirmado_em, aprovado_em, atualizado_em) VALUES ($1, $2, $3, $4, 'LEITOR', now(), now(), now())`, params: [id, email, nome, await gerarHashSenha(d.senha)] },
    { sql: `INSERT INTO usuario_permissao (usuario_id, permissao) SELECT $1, unnest($2::text[])`, params: [id, permissoes] },
    comandoAuditoria({ usuarioId: autorId, acao: "USUARIO_CRIADO", entidade: "usuario", entidadeId: id, depois: { nome, email, permissoes } }),
  ]);
  return id;
}

/** Nova senha provisória (o usuário troca em "Minha conta"); encerra as sessões e desbloqueia. */
export async function redefinirSenha(ex: Executor, alvoId: string, autorId: string): Promise<string> {
  await permissoesDe(ex, alvoId);
  const senha = gerarSenhaProvisoria();
  await ex.transacao([
    { sql: `UPDATE usuario SET senha_hash = $2, tentativas = 0, bloqueado_ate = NULL, atualizado_em = now() WHERE id = $1`, params: [alvoId, await gerarHashSenha(senha)] },
    { sql: `DELETE FROM sessao WHERE usuario_id = $1`, params: [alvoId] },
    comandoAuditoria({ usuarioId: autorId, acao: "SENHA_REDEFINIDA", entidade: "usuario", entidadeId: alvoId }),
  ]);
  return senha;
}
