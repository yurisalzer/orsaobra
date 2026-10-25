/**
 * Cadastro de empresas (contratadas) e dos seus responsáveis técnicos.
 *
 * CNPJ e CPF são guardados só com dígitos e conferidos pelos dígitos
 * verificadores. Toda empresa precisa de ao menos um responsável técnico
 * (nome, conselho e número de registro), e um deles é o principal — o que é
 * sugerido ao vincular a empresa a um contrato.
 */
import type { Executor } from "@/lib/banco/executor";
import { comandoAuditoria } from "@/lib/auditoria";
import { formatarCpf, normalizarCpf, normalizarTelefone } from "@/lib/auth/cadastro";

export class ErroEmpresa extends Error {}

export const CONSELHOS = [
  { codigo: "CREA", nome: "CREA — Conselho Regional de Engenharia e Agronomia" },
  { codigo: "CAU", nome: "CAU — Conselho de Arquitetura e Urbanismo" },
  { codigo: "CFT", nome: "CFT/CRT — Conselho dos Técnicos Industriais" },
  { codigo: "OUTRO", nome: "Outro conselho" },
] as const;
export type Conselho = (typeof CONSELHOS)[number]["codigo"];

export const UFS = ["AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"];

/** CNPJ só com dígitos, se válido (dígitos verificadores conferidos); senão null. */
export function normalizarCnpj(cnpj: string): string | null {
  const d = cnpj.replace(/\D/g, "");
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return null;
  const dv = (n: number) => {
    const pesos = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const s = pesos.reduce((a, p, i) => a + Number(d[i]) * p, 0);
    const r = s % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return dv(12) === Number(d[12]) && dv(13) === Number(d[13]) ? d : null;
}

export const formatarCnpj = (d: string) => d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
export const formatarCep = (d: string) => d.replace(/^(\d{5})(\d{3})$/, "$1-$2");

export interface ResponsavelTecnico {
  nome: string; titulo: string | null; conselho: Conselho; registro: string; ufRegistro: string | null;
  cpf: string | null; email: string | null; telefone: string | null; principal: boolean;
}

export interface DadosEmpresa {
  razaoSocial: string; nomeFantasia?: string | null; cnpj: string; inscricaoEstadual?: string | null; inscricaoMunicipal?: string | null;
  cep?: string | null; logradouro?: string | null; numero?: string | null; complemento?: string | null; bairro?: string | null; municipio?: string | null; uf?: string | null;
  telefone?: string | null; email?: string | null; representanteNome?: string | null; representanteCpf?: string | null; representanteCargo?: string | null;
  observacoes?: string | null; responsaveis: ResponsavelTecnico[];
}

const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const t = (s: string | null | undefined, max = 300) => {
  const v = (s ?? "").replace(/\s+/g, " ").trim();
  return v ? v.slice(0, max) : null;
};

function validar(d: DadosEmpresa) {
  const razaoSocial = t(d.razaoSocial, 300);
  if (!razaoSocial || razaoSocial.length < 3) throw new ErroEmpresa("Informe a razão social.");
  const cnpj = normalizarCnpj(d.cnpj ?? "");
  if (!cnpj) throw new ErroEmpresa("CNPJ inválido (confira os 14 dígitos).");
  const email = t(d.email, 200)?.toLowerCase() ?? null;
  if (email && !RE_EMAIL.test(email)) throw new ErroEmpresa("E-mail da empresa inválido.");
  const telefone = t(d.telefone) ? normalizarTelefone(t(d.telefone)!) : null;
  if (t(d.telefone) && !telefone) throw new ErroEmpresa("Telefone da empresa inválido (informe DDD e número).");
  const cep = t(d.cep)?.replace(/\D/g, "") || null;
  if (cep && cep.length !== 8) throw new ErroEmpresa("CEP deve ter 8 dígitos.");
  const uf = t(d.uf)?.toUpperCase() ?? null;
  if (uf && !UFS.includes(uf)) throw new ErroEmpresa("UF inválida.");
  const repCpf = t(d.representanteCpf) ? normalizarCpf(t(d.representanteCpf)!) : null;
  if (t(d.representanteCpf) && !repCpf) throw new ErroEmpresa("CPF do representante legal inválido.");

  const rts = (d.responsaveis ?? []).filter((r) => t(r.nome) || t(r.registro));
  if (!rts.length) throw new ErroEmpresa("Cadastre ao menos um responsável técnico (nome, conselho e registro).");
  if (rts.length > 30) throw new ErroEmpresa("Responsáveis técnicos demais (máximo 30).");
  const responsaveis = rts.map((r, i) => {
    const nome = t(r.nome, 200);
    const n = `responsável técnico ${i + 1}${nome ? ` (${nome})` : ""}`;
    if (!nome) throw new ErroEmpresa(`Informe o nome do ${n}.`);
    if (!CONSELHOS.some((c) => c.codigo === r.conselho)) throw new ErroEmpresa(`Escolha o conselho profissional do ${n}.`);
    const registro = t(r.registro, 40);
    if (!registro) throw new ErroEmpresa(`Informe o número de registro no conselho do ${n}.`);
    const ufRegistro = t(r.ufRegistro)?.toUpperCase() ?? null;
    if (ufRegistro && !UFS.includes(ufRegistro)) throw new ErroEmpresa(`UF do registro inválida no ${n}.`);
    const cpf = t(r.cpf) ? normalizarCpf(t(r.cpf)!) : null;
    if (t(r.cpf) && !cpf) throw new ErroEmpresa(`CPF inválido no ${n}.`);
    const em = t(r.email, 200)?.toLowerCase() ?? null;
    if (em && !RE_EMAIL.test(em)) throw new ErroEmpresa(`E-mail inválido no ${n}.`);
    const tel = t(r.telefone) ? normalizarTelefone(t(r.telefone)!) : null;
    if (t(r.telefone) && !tel) throw new ErroEmpresa(`Telefone inválido no ${n} (informe DDD e número).`);
    return { nome, titulo: t(r.titulo, 120), conselho: r.conselho, registro, ufRegistro, cpf, email: em, telefone: tel || null, principal: !!r.principal, ordem: i + 1 };
  });
  // exatamente um principal (o primeiro, se nenhum marcado)
  const principal = Math.max(0, responsaveis.findIndex((r) => r.principal));
  responsaveis.forEach((r, i) => { r.principal = i === principal; });
  return {
    razaoSocial, nomeFantasia: t(d.nomeFantasia, 300), cnpj, inscricaoEstadual: t(d.inscricaoEstadual, 40), inscricaoMunicipal: t(d.inscricaoMunicipal, 40),
    cep, logradouro: t(d.logradouro), numero: t(d.numero, 20), complemento: t(d.complemento, 120), bairro: t(d.bairro, 120), municipio: t(d.municipio, 120), uf,
    telefone: telefone || null, email, representanteNome: t(d.representanteNome, 200), representanteCpf: repCpf, representanteCargo: t(d.representanteCargo, 120),
    observacoes: t(d.observacoes, 2000), responsaveis,
  };
}

const COLUNAS = `razao_social = $2, nome_fantasia = $3, cnpj = $4, inscricao_estadual = $5, inscricao_municipal = $6, cep = $7, logradouro = $8, numero = $9,
  complemento = $10, bairro = $11, municipio = $12, uf = $13, telefone = $14, email = $15, representante_nome = $16, representante_cpf = $17,
  representante_cargo = $18, observacoes = $19`;
const valores = (id: string, v: ReturnType<typeof validar>) => [id, v.razaoSocial, v.nomeFantasia, v.cnpj, v.inscricaoEstadual, v.inscricaoMunicipal, v.cep, v.logradouro, v.numero,
  v.complemento, v.bairro, v.municipio, v.uf, v.telefone, v.email, v.representanteNome, v.representanteCpf, v.representanteCargo, v.observacoes];

const inserirResponsaveis = (id: string, v: ReturnType<typeof validar>) => ({
  sql: `INSERT INTO empresa_responsavel (empresa_id, ordem, nome, titulo, conselho, registro, uf_registro, cpf, email, telefone, principal)
        SELECT $1, x.ordem, x.nome, x.titulo, x.conselho, x.registro, x."ufRegistro", x.cpf, x.email, x.telefone, x.principal
          FROM jsonb_to_recordset($2::jsonb) AS x(ordem int, nome text, titulo text, conselho text, registro text, "ufRegistro" text, cpf text, email text, telefone text, principal boolean)`,
  params: [id, JSON.stringify(v.responsaveis)],
});

async function cnpjLivre(ex: Executor, cnpj: string, exceto: string | null) {
  const [r] = await ex.consulta<{ razao: string }>(`SELECT razao_social AS razao FROM empresa WHERE cnpj = $1 AND ($2::uuid IS NULL OR id <> $2)`, [cnpj, exceto]);
  if (r) throw new ErroEmpresa(`Já existe empresa cadastrada com o CNPJ ${formatarCnpj(cnpj)} (${r.razao}).`);
}

export async function criarEmpresa(ex: Executor, d: DadosEmpresa, usuarioId: string): Promise<string> {
  const v = validar(d);
  await cnpjLivre(ex, v.cnpj, null);
  const id = crypto.randomUUID();
  await ex.transacao([
    { sql: `INSERT INTO empresa (id, razao_social, cnpj, criado_por_id) VALUES ($1, $2, $3, $4)`, params: [id, v.razaoSocial, v.cnpj, usuarioId] },
    { sql: `UPDATE empresa SET ${COLUNAS} WHERE id = $1`, params: valores(id, v) },
    inserirResponsaveis(id, v),
    comandoAuditoria({ usuarioId, acao: "EMPRESA_CRIADA", entidade: "empresa", entidadeId: id, depois: { razaoSocial: v.razaoSocial, cnpj: v.cnpj, responsaveis: v.responsaveis.length } }),
  ]);
  return id;
}

export async function alterarEmpresa(ex: Executor, id: string, versao: number, d: DadosEmpresa, usuarioId: string) {
  const v = validar(d);
  const [atual] = await ex.consulta<{ versao: number }>(`SELECT versao FROM empresa WHERE id = $1`, [id]);
  if (!atual) throw new ErroEmpresa("Empresa não encontrada.");
  if (atual.versao !== versao) throw new ErroEmpresa("A empresa foi alterada por outra pessoa. Recarregue a página.");
  await cnpjLivre(ex, v.cnpj, id);
  await ex.transacao([
    { sql: `UPDATE empresa SET ${COLUNAS}, versao = versao + 1, atualizado_em = now() WHERE id = $1 AND versao = $20`, params: [...valores(id, v), versao] },
    { sql: `DELETE FROM empresa_responsavel WHERE empresa_id = $1`, params: [id] },
    inserirResponsaveis(id, v),
    comandoAuditoria({ usuarioId, acao: "EMPRESA_ALTERADA", entidade: "empresa", entidadeId: id, depois: { razaoSocial: v.razaoSocial, cnpj: v.cnpj, responsaveis: v.responsaveis.length } }),
  ]);
}

export async function definirEmpresaAtiva(ex: Executor, id: string, ativo: boolean, usuarioId: string) {
  await ex.transacao([
    { sql: `UPDATE empresa SET ativo = $2, versao = versao + 1, atualizado_em = now() WHERE id = $1`, params: [id, ativo] },
    comandoAuditoria({ usuarioId, acao: ativo ? "EMPRESA_REATIVADA" : "EMPRESA_DESATIVADA", entidade: "empresa", entidadeId: id }),
  ]);
}

export interface EmpresaResumo {
  id: string; razaoSocial: string; nomeFantasia: string | null; cnpj: string; municipio: string | null; uf: string | null; ativo: boolean;
  responsavel: string | null; responsaveis: number; contratos: number;
}

export async function listarEmpresas(ex: Executor, busca = "", incluirInativas = true): Promise<EmpresaResumo[]> {
  const termo = busca.trim();
  const digitos = termo.replace(/\D/g, "");
  const r = await ex.consulta<EmpresaResumo>(
    `SELECT e.id, e.razao_social AS "razaoSocial", e.nome_fantasia AS "nomeFantasia", e.cnpj, e.municipio, e.uf, e.ativo,
            (SELECT r.nome || ' — ' || r.conselho || ' ' || r.registro || coalesce('/' || r.uf_registro, '') FROM empresa_responsavel r WHERE r.empresa_id = e.id AND r.principal) AS responsavel,
            (SELECT count(*)::int FROM empresa_responsavel r WHERE r.empresa_id = e.id) AS responsaveis,
            (SELECT count(*)::int FROM contrato c WHERE c.empresa_id = e.id) AS contratos
       FROM empresa e
      WHERE ($2 OR e.ativo)
        AND ($1 = '' OR lower(f_unaccent(concat_ws(' ', e.razao_social, e.nome_fantasia, e.municipio))) LIKE '%' || lower(f_unaccent($1)) || '%'
             OR ($3 <> '' AND e.cnpj LIKE '%' || $3 || '%')
             OR EXISTS (SELECT 1 FROM empresa_responsavel r WHERE r.empresa_id = e.id AND lower(f_unaccent(r.nome || ' ' || r.registro)) LIKE '%' || lower(f_unaccent($1)) || '%'))
      ORDER BY e.ativo DESC, e.razao_social`,
    [termo, incluirInativas, digitos.length >= 3 ? digitos : ""],
  );
  return r;
}

export interface EmpresaCompleta extends Omit<DadosEmpresa, "responsaveis"> {
  id: string; ativo: boolean; versao: number; criadoPor: string | null; criadoEm: string; atualizadoEm: string; responsaveis: (ResponsavelTecnico & { id: string })[];
}

export async function carregarEmpresa(ex: Executor, id: string): Promise<EmpresaCompleta> {
  const [e] = await ex.consulta<Omit<EmpresaCompleta, "responsaveis">>(
    `SELECT e.id, e.razao_social AS "razaoSocial", e.nome_fantasia AS "nomeFantasia", e.cnpj, e.inscricao_estadual AS "inscricaoEstadual",
            e.inscricao_municipal AS "inscricaoMunicipal", e.cep, e.logradouro, e.numero, e.complemento, e.bairro, e.municipio, e.uf, e.telefone, e.email,
            e.representante_nome AS "representanteNome", e.representante_cpf AS "representanteCpf", e.representante_cargo AS "representanteCargo", e.observacoes,
            e.ativo, e.versao, u.nome AS "criadoPor",
            to_char(e.criado_em AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') AS "criadoEm",
            to_char(e.atualizado_em AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') AS "atualizadoEm"
       FROM empresa e LEFT JOIN usuario u ON u.id = e.criado_por_id WHERE e.id = $1`, [id],
  );
  if (!e) throw new ErroEmpresa("Empresa não encontrada.");
  const responsaveis = await ex.consulta<ResponsavelTecnico & { id: string }>(
    `SELECT id, nome, titulo, conselho, registro, uf_registro AS "ufRegistro", cpf, email, telefone, principal FROM empresa_responsavel WHERE empresa_id = $1 ORDER BY ordem`, [id],
  );
  return { ...e, responsaveis };
}

/** Para preencher o contrato: empresas ativas com o responsável técnico principal. */
export interface EmpresaParaContrato {
  id: string; razaoSocial: string; cnpj: string; endereco: string | null;
  responsaveis: { nome: string; registro: string; email: string | null; telefone: string | null; principal: boolean }[];
}

export async function empresasParaContrato(ex: Executor): Promise<EmpresaParaContrato[]> {
  return ex.consulta<EmpresaParaContrato>(
    `SELECT e.id, e.razao_social AS "razaoSocial", e.cnpj,
            nullif(concat_ws(', ', e.logradouro, e.numero, e.complemento, e.bairro, concat_ws('/', e.municipio, e.uf)), '') AS endereco,
            coalesce((SELECT jsonb_agg(jsonb_build_object('nome', r.nome, 'registro', r.conselho || ' ' || r.registro || coalesce('/' || r.uf_registro, ''),
                     'email', r.email, 'telefone', r.telefone, 'principal', r.principal) ORDER BY r.principal DESC, r.ordem)
                       FROM empresa_responsavel r WHERE r.empresa_id = e.id), '[]'::jsonb) AS responsaveis
       FROM empresa e WHERE e.ativo ORDER BY e.razao_social`,
  );
}

export { formatarCpf };
