/**
 * Cabeçalhos (timbres) dos relatórios: logo + até 6 linhas de texto
 * (ex.: "Estado do Rio de Janeiro / Prefeitura Municipal de ...").
 * Cada obra pode escolher um; sem escolha, vale o cabeçalho padrão.
 * No fechamento da revisão o cabeçalho usado é gravado junto.
 */
import type { Executor } from "../banco/executor";
import { comandoAuditoria } from "../auditoria";

export class ErroCabecalho extends Error {}

export const MAX_LINHAS = 6;
export const MAX_LOGO_BYTES = 512 * 1024;

export interface Cabecalho {
  id: string;
  nome: string;
  linhas: string[];
  logoTipo: string | null;
  logoBase64: string | null;
  padrao: boolean;
  ativo: boolean;
  obras: number;
}

/** O que vai no relatório. */
export interface CabecalhoDocumento {
  linhas: string[];
  /** data URL (image/png ou image/jpeg) */
  logo: string | null;
}

export async function listarCabecalhos(ex: Executor, apenasAtivos = false): Promise<Cabecalho[]> {
  return ex.consulta<Cabecalho>(
    `SELECT c.id, c.nome, c.linhas, c.logo_tipo AS "logoTipo", c.logo_base64 AS "logoBase64", c.padrao, c.ativo,
            (SELECT count(*)::int FROM obra o WHERE o.cabecalho_id = c.id) AS obras
       FROM cabecalho_relatorio c WHERE ($1::boolean = false OR c.ativo) ORDER BY c.padrao DESC, c.nome`,
    [apenasAtivos],
  );
}

/** Confere que o arquivo é mesmo PNG ou JPEG (pelos primeiros bytes) e o tamanho. */
export function validarLogo(tipo: string, base64: string): { tipo: "image/png" | "image/jpeg"; base64: string } {
  const limpo = base64.replace(/^data:[^,]*,/, "").replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(limpo)) throw new ErroCabecalho("Imagem inválida.");
  const bytes = Math.floor((limpo.length * 3) / 4) - (limpo.endsWith("==") ? 2 : limpo.endsWith("=") ? 1 : 0);
  if (bytes > MAX_LOGO_BYTES) throw new ErroCabecalho("A imagem do logo deve ter no máximo 512 KB.");
  const inicio = Uint8Array.from(atob(limpo.slice(0, 16)), (c) => c.charCodeAt(0));
  const png = inicio[0] === 0x89 && inicio[1] === 0x50 && inicio[2] === 0x4e && inicio[3] === 0x47;
  const jpeg = inicio[0] === 0xff && inicio[1] === 0xd8 && inicio[2] === 0xff;
  if (!png && !jpeg) throw new ErroCabecalho("O logo deve ser uma imagem PNG ou JPEG.");
  const real = png ? "image/png" : "image/jpeg";
  if (tipo && tipo !== real && !(tipo === "image/jpg" && real === "image/jpeg")) throw new ErroCabecalho("O conteúdo da imagem não corresponde ao tipo do arquivo.");
  return { tipo: real, base64: limpo };
}

export async function salvarCabecalho(
  ex: Executor,
  d: { id?: string | null; nome: string; linhas: string[]; logo?: { tipo: string; base64: string } | null; padrao: boolean },
  usuarioId: string,
): Promise<string> {
  const nome = d.nome.trim();
  if (nome.length < 2) throw new ErroCabecalho("Informe um nome para o cabeçalho.");
  const linhas = d.linhas.map((l) => l.trim()).filter(Boolean);
  if (linhas.length > MAX_LINHAS) throw new ErroCabecalho(`Use no máximo ${MAX_LINHAS} linhas.`);
  if (linhas.some((l) => l.length > 150)) throw new ErroCabecalho("Cada linha pode ter no máximo 150 caracteres.");
  if (!linhas.length && !d.logo) {
    if (!d.id) throw new ErroCabecalho("Informe ao menos uma linha de texto ou o logo.");
  }
  const logo = d.logo ? validarLogo(d.logo.tipo, d.logo.base64) : d.logo;
  const [dup] = await ex.consulta<{ id: string }>(`SELECT id FROM cabecalho_relatorio WHERE lower(nome) = lower($1) AND id IS DISTINCT FROM $2::uuid`, [nome, d.id ?? null]);
  if (dup) throw new ErroCabecalho("Já existe um cabeçalho com esse nome.");
  const id = d.id ?? crypto.randomUUID();
  const cmds = [];
  if (d.padrao) cmds.push({ sql: `UPDATE cabecalho_relatorio SET padrao = false WHERE padrao AND id <> $1`, params: [id] });
  if (d.id) {
    cmds.push({ sql: `SELECT imp_exigir(EXISTS (SELECT 1 FROM cabecalho_relatorio WHERE id = $1), 'Cabeçalho não encontrado.')`, params: [id] });
    cmds.push({
      sql: `UPDATE cabecalho_relatorio SET nome = $2, linhas = $3::text[], padrao = $4, atualizado_em = now()
              ${logo === undefined ? "" : ", logo_tipo = $5, logo_base64 = $6"} WHERE id = $1`,
      params: logo === undefined ? [id, nome, linhas, d.padrao] : [id, nome, linhas, d.padrao, logo?.tipo ?? null, logo?.base64 ?? null],
    });
  } else {
    cmds.push({
      sql: `INSERT INTO cabecalho_relatorio (id, nome, linhas, padrao, logo_tipo, logo_base64) VALUES ($1, $2, $3::text[], $4, $5, $6)`,
      params: [id, nome, linhas, d.padrao, logo?.tipo ?? null, logo?.base64 ?? null],
    });
  }
  // a auditoria registra o texto e se há logo (não a imagem)
  cmds.push(comandoAuditoria({ usuarioId, acao: d.id ? "CABECALHO_ALTERADO" : "CABECALHO_CRIADO", entidade: "cabecalho_relatorio", entidadeId: id, depois: { nome, linhas, padrao: d.padrao, logo: logo === undefined ? "mantido" : logo ? `${logo.tipo}, ${logo.base64.length} caracteres` : "removido" } }));
  await ex.transacao(cmds);
  return id;
}

export async function arquivarCabecalho(ex: Executor, id: string, ativo: boolean, usuarioId: string) {
  await ex.transacao([
    { sql: `SELECT imp_exigir(EXISTS (SELECT 1 FROM cabecalho_relatorio WHERE id = $1), 'Cabeçalho não encontrado.')`, params: [id] },
    { sql: `UPDATE cabecalho_relatorio SET ativo = $2, padrao = padrao AND $2, atualizado_em = now() WHERE id = $1`, params: [id, ativo] },
    comandoAuditoria({ usuarioId, acao: ativo ? "CABECALHO_REATIVADO" : "CABECALHO_ARQUIVADO", entidade: "cabecalho_relatorio", entidadeId: id }),
  ]);
}

const paraDocumento = (c: { linhas: string[]; logoTipo: string | null; logoBase64: string | null }): CabecalhoDocumento => ({
  linhas: c.linhas,
  logo: c.logoTipo && c.logoBase64 ? `data:${c.logoTipo};base64,${c.logoBase64}` : null,
});

/** Cabeçalho atual de uma obra: o escolhido (se ativo) ou o padrão. */
export async function cabecalhoDaObra(ex: Executor, obraId: string): Promise<CabecalhoDocumento | null> {
  const [c] = await ex.consulta<{ linhas: string[]; logoTipo: string | null; logoBase64: string | null }>(
    `SELECT c.linhas, c.logo_tipo AS "logoTipo", c.logo_base64 AS "logoBase64" FROM cabecalho_relatorio c
      WHERE c.ativo AND (c.id = (SELECT cabecalho_id FROM obra WHERE id = $1) OR c.padrao)
      ORDER BY (c.id = (SELECT cabecalho_id FROM obra WHERE id = $1)) DESC NULLS LAST LIMIT 1`,
    [obraId],
  );
  return c ? paraDocumento(c) : null;
}

/** Cabeçalho de uma revisão: o gravado no fechamento ou o atual da obra. */
export async function cabecalhoDaRevisao(ex: Executor, revisaoId: string): Promise<CabecalhoDocumento | null> {
  const [r] = await ex.consulta<{ snap: CabecalhoDocumento | null; status: string; obra: string }>(
    `SELECT r.cabecalho_snapshot AS snap, r.status::text AS status, oc.obra_id AS obra
       FROM orcamento_revisao r JOIN orcamento oc ON oc.id = r.orcamento_id WHERE r.id = $1`,
    [revisaoId],
  );
  if (!r) return null;
  if (r.snap) return r.snap.linhas.length || r.snap.logo ? r.snap : null;
  return cabecalhoDaObra(ex, r.obra);
}
