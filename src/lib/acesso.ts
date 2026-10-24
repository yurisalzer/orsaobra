/**
 * Acesso individual a orçamentos e contratos.
 *
 * Entram (abrir, ver relatórios): o criador, os administradores (permissão
 * "Usuários") e os usuários escolhidos pelo criador/administrador. Editam os
 * que entram com "pode editar" — e que também tenham a permissão geral de
 * edição (Editar orçamentos / Editar contratos). Os demais veem o item na
 * lista, mas não conseguem abri-lo.
 *
 * Criador do orçamento = quem criou a revisão 1; do contrato = quem o cadastrou.
 */
import type { Executor } from "@/lib/banco/executor";
import { comandoAuditoria } from "@/lib/auditoria";

export class ErroAcesso extends Error {}

export type Recurso = "orcamento" | "contrato";
export interface UsuarioAcesso { id: string; permissoes: readonly string[] }
export interface Acesso { ver: boolean; editar: boolean; gerenciar: boolean; criadorId: string | null }

const admin = (u: UsuarioAcesso) => u.permissoes.includes("USUARIOS");
const PERM_EDITAR: Record<Recurso, string> = { orcamento: "ORCAMENTOS_EDITAR", contrato: "MEDICOES_EDITAR" };

const SQL_CRIADOR: Record<Recurso, string> = {
  orcamento: `(SELECT r.criado_por_id FROM orcamento_revisao r WHERE r.orcamento_id = x.id ORDER BY r.numero LIMIT 1)`,
  contrato: `x.criado_por_id`,
};
const TABELA: Record<Recurso, { tabela: string; acesso: string; coluna: string }> = {
  orcamento: { tabela: "orcamento", acesso: "orcamento_acesso", coluna: "orcamento_id" },
  contrato: { tabela: "contrato", acesso: "contrato_acesso", coluna: "contrato_id" },
};

export async function acessoA(ex: Executor, recurso: Recurso, id: string, u: UsuarioAcesso): Promise<Acesso | null> {
  const t = TABELA[recurso];
  const [r] = await ex.consulta<{ criador: string | null; concedido: boolean | null }>(
    `SELECT ${SQL_CRIADOR[recurso]} AS criador,
            (SELECT a.pode_editar FROM ${t.acesso} a WHERE a.${t.coluna} = x.id AND a.usuario_id = $2) AS concedido
       FROM ${t.tabela} x WHERE x.id = $1`, [id, u.id],
  );
  if (!r) return null;
  const gerenciar = admin(u) || (!!r.criador && r.criador === u.id);
  const ver = gerenciar || r.concedido !== null;
  return { ver, editar: (gerenciar || r.concedido === true) && u.permissoes.includes(PERM_EDITAR[recurso]), gerenciar, criadorId: r.criador };
}

export async function orcamentoDaRevisao(ex: Executor, revisaoId: string): Promise<string | null> {
  const [r] = await ex.consulta<{ id: string }>(`SELECT orcamento_id AS id FROM orcamento_revisao WHERE id = $1`, [revisaoId]);
  return r?.id ?? null;
}

export async function acessoRevisao(ex: Executor, revisaoId: string, u: UsuarioAcesso): Promise<Acesso | null> {
  const o = await orcamentoDaRevisao(ex, revisaoId);
  return o ? acessoA(ex, "orcamento", o, u) : null;
}

const NOME: Record<Recurso, string> = { orcamento: "orçamento", contrato: "contrato" };

/** Lança ErroAcesso quando o usuário não pode ver/editar. */
export async function exigirAcesso(ex: Executor, recurso: Recurso, id: string, u: UsuarioAcesso, nivel: "ver" | "editar" | "gerenciar"): Promise<Acesso> {
  const a = await acessoA(ex, recurso, id, u);
  if (!a) throw new ErroAcesso(`${NOME[recurso] === "orçamento" ? "Orçamento" : "Contrato"} não encontrado.`);
  if (!a[nivel]) {
    throw new ErroAcesso(nivel === "ver"
      ? `Você não tem acesso a este ${NOME[recurso]}. Peça acesso a quem o criou ou ao administrador.`
      : nivel === "editar"
        ? `Você pode ver este ${NOME[recurso]}, mas não editá-lo. Peça acesso de edição a quem o criou ou ao administrador.`
        : `Só quem criou o ${NOME[recurso]} (ou o administrador) pode fazer isso.`);
  }
  return a;
}

export async function exigirAcessoRevisao(ex: Executor, revisaoId: string, u: UsuarioAcesso, nivel: "ver" | "editar" | "gerenciar") {
  const o = await orcamentoDaRevisao(ex, revisaoId);
  if (!o) throw new ErroAcesso("Revisão não encontrada.");
  return exigirAcesso(ex, "orcamento", o, u, nivel);
}

/** Ids que o usuário pode abrir (para as listas). null = todos (administrador). */
export async function idsComAcesso(ex: Executor, recurso: Recurso, u: UsuarioAcesso): Promise<Set<string> | null> {
  if (admin(u)) return null;
  const t = TABELA[recurso];
  const r = await ex.consulta<{ id: string }>(
    `SELECT x.id FROM ${t.tabela} x
      WHERE ${SQL_CRIADOR[recurso]} = $1 OR EXISTS (SELECT 1 FROM ${t.acesso} a WHERE a.${t.coluna} = x.id AND a.usuario_id = $1)`, [u.id],
  );
  return new Set(r.map((x) => x.id));
}

// ---------------------------------------------------------------------------
// Compartilhamento
// ---------------------------------------------------------------------------

export interface UsuarioCompartilhamento {
  id: string; nome: string; email: string; administrador: boolean; criador: boolean; nivel: "EDITAR" | "VER" | null; podeEditarGeral: boolean;
}

/** Usuários ativos com a situação de acesso a este orçamento/contrato. */
export async function listarCompartilhamento(ex: Executor, recurso: Recurso, id: string): Promise<UsuarioCompartilhamento[]> {
  const t = TABELA[recurso];
  const [x] = await ex.consulta<{ criador: string | null }>(`SELECT ${SQL_CRIADOR[recurso]} AS criador FROM ${t.tabela} x WHERE x.id = $1`, [id]);
  if (!x) throw new ErroAcesso("Não encontrado.");
  const r = await ex.consulta<{ id: string; nome: string; email: string; administrador: boolean; pode_editar: boolean | null; editar_geral: boolean }>(
    `SELECT u.id, u.nome, u.email,
            EXISTS (SELECT 1 FROM usuario_permissao p WHERE p.usuario_id = u.id AND p.permissao = 'USUARIOS') AS administrador,
            EXISTS (SELECT 1 FROM usuario_permissao p WHERE p.usuario_id = u.id AND p.permissao = $2) AS editar_geral,
            a.pode_editar
       FROM usuario u LEFT JOIN ${t.acesso} a ON a.usuario_id = u.id AND a.${t.coluna} = $1
      WHERE u.ativo AND u.email_confirmado_em IS NOT NULL
      ORDER BY u.nome`, [id, PERM_EDITAR[recurso]],
  );
  return r.map((u) => ({
    id: u.id, nome: u.nome, email: u.email, administrador: u.administrador, criador: u.id === x.criador,
    nivel: u.pode_editar === null ? null : u.pode_editar ? "EDITAR" : "VER", podeEditarGeral: u.editar_geral,
  }));
}

/** Concede (VER/EDITAR) ou retira (null) o acesso de um usuário. Só criador/administrador. */
export async function definirAcesso(ex: Executor, recurso: Recurso, id: string, usuarioId: string, nivel: "VER" | "EDITAR" | null, autor: UsuarioAcesso) {
  const a = await exigirAcesso(ex, recurso, id, autor, "gerenciar");
  if (usuarioId === a.criadorId) throw new ErroAcesso("O criador sempre tem acesso.");
  const t = TABELA[recurso];
  const [alvo] = await ex.consulta<{ id: string }>(`SELECT id FROM usuario WHERE id = $1 AND ativo`, [usuarioId]);
  if (!alvo) throw new ErroAcesso("Usuário não encontrado ou inativo.");
  await ex.transacao([
    nivel === null
      ? { sql: `DELETE FROM ${t.acesso} WHERE ${t.coluna} = $1 AND usuario_id = $2`, params: [id, usuarioId] }
      : {
          sql: `INSERT INTO ${t.acesso} (${t.coluna}, usuario_id, pode_editar, concedido_por_id) VALUES ($1, $2, $3, $4)
                ON CONFLICT (${t.coluna}, usuario_id) DO UPDATE SET pode_editar = EXCLUDED.pode_editar, concedido_por_id = EXCLUDED.concedido_por_id, concedido_em = now()`,
          params: [id, usuarioId, nivel === "EDITAR", autor.id],
        },
    comandoAuditoria({ usuarioId: autor.id, acao: nivel ? "ACESSO_CONCEDIDO" : "ACESSO_RETIRADO", entidade: recurso, entidadeId: id, depois: { usuarioId, nivel } }),
  ]);
}
