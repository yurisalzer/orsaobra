import type { Executor } from "../banco/executor";

export interface LinhaBase {
  revisao_id: string;
  fonte: string;
  uf: string;
  competencia: string; // MM/AAAA
  numero: number;
  status: string;
  motivo: string | null;
  publicada_em: string | null;
  precos: number;
  composicoes: number;
  importacoes_confirmadas: number;
}

export function listarBases(ex: Executor) {
  return ex.consulta<LinhaBase>(
    `SELECT r.id AS revisao_id, f.codigo AS fonte, b.uf, to_char(b.competencia, 'MM/YYYY') AS competencia, r.numero, r.status::text, r.motivo,
            to_char(r.publicada_em AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') AS publicada_em,
            (SELECT count(*)::int FROM preco p WHERE p.base_revisao_id = r.id) AS precos,
            (SELECT count(*)::int FROM base_composicao c WHERE c.base_revisao_id = r.id) AS composicoes,
            (SELECT count(*)::int FROM importacao i WHERE i.base_revisao_id = r.id AND i.status = 'CONFIRMADA') AS importacoes_confirmadas
       FROM base_revisao r JOIN base_mensal b ON b.id = r.base_id JOIN fonte f ON f.id = b.fonte_id
      WHERE r.status <> 'DESCARTADA'
      ORDER BY b.competencia DESC, f.codigo, r.numero DESC`,
  );
}

export interface LinhaImportacao {
  id: string;
  fonte: string;
  competencia: string;
  numero: number;
  status: string;
  adaptador: string;
  adaptador_versao: string;
  usuario: string;
  iniciada_em: string;
  arquivos: string;
  erros: number;
  avisos: number;
}

export function listarImportacoes(ex: Executor, limite = 30) {
  return ex.consulta<LinhaImportacao>(
    `SELECT i.id, f.codigo AS fonte, to_char(b.competencia, 'MM/YYYY') AS competencia, r.numero, i.status::text, i.adaptador, i.adaptador_versao,
            u.nome AS usuario, to_char(i.iniciada_em AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') AS iniciada_em,
            (SELECT string_agg(a.nome_original, ', ') FROM arquivo_importacao a WHERE a.importacao_id = i.id) AS arquivos,
            (SELECT count(*)::int FROM verificacao_importacao v WHERE v.importacao_id = i.id AND v.severidade = 'ERRO') AS erros,
            (SELECT count(*)::int FROM verificacao_importacao v WHERE v.importacao_id = i.id AND v.severidade = 'AVISO') AS avisos
       FROM importacao i JOIN base_revisao r ON r.id = i.base_revisao_id JOIN base_mensal b ON b.id = r.base_id
       JOIN fonte f ON f.id = b.fonte_id JOIN usuario u ON u.id = i.usuario_id
      ORDER BY i.iniciada_em DESC LIMIT $1`,
    [limite],
  );
}

export interface DetalheImportacao {
  id: string;
  status: string;
  resumo: Record<string, unknown>;
  erro: string | null;
  base_revisao_id: string;
  base_status: string;
  numero: number;
  iniciada_em: string;
  concluida_em: string | null;
  usuario: string;
  duplicidade_autorizada: boolean;
  adaptador: string;
  adaptador_versao: string;
}

export async function detalheImportacao(ex: Executor, id: string) {
  const [d] = await ex.consulta<DetalheImportacao>(
    `SELECT i.id, i.status::text, i.resumo, i.erro, i.base_revisao_id, r.status::text AS base_status, r.numero, i.duplicidade_autorizada, i.adaptador, i.adaptador_versao,
            to_char(i.iniciada_em AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI:SS') AS iniciada_em,
            to_char(i.concluida_em AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI:SS') AS concluida_em, u.nome AS usuario
       FROM importacao i JOIN base_revisao r ON r.id = i.base_revisao_id JOIN usuario u ON u.id = i.usuario_id WHERE i.id = $1`,
    [id],
  );
  if (!d) return null;
  const arquivos = await ex.consulta<{ nome_original: string; tamanho_bytes: string; sha256: string; layout: string | null }>(
    `SELECT nome_original, tamanho_bytes::text, sha256, layout FROM arquivo_importacao WHERE importacao_id = $1 ORDER BY nome_original`, [id],
  );
  const grupos = await ex.consulta<{ severidade: string; regra: string; total: number }>(
    `SELECT severidade::text AS severidade, regra, count(*)::int AS total FROM verificacao_importacao WHERE importacao_id = $1
      GROUP BY severidade, regra ORDER BY CASE severidade WHEN 'ERRO' THEN 0 WHEN 'AVISO' THEN 1 ELSE 2 END, regra`, [id],
  );
  return { ...d, arquivos, grupos };
}

export interface Verificacao {
  severidade: string;
  regra: string;
  mensagem: string;
  arquivo: string | null;
  planilha: string | null;
  linha: number | null;
  campo: string | null;
  valor: string | null;
}

export function verificacoes(ex: Executor, id: string, limite = 5000) {
  return ex.consulta<Verificacao>(
    `SELECT severidade::text, regra, mensagem, arquivo, planilha, linha, campo, valor FROM verificacao_importacao
      WHERE importacao_id = $1
      ORDER BY CASE severidade WHEN 'ERRO' THEN 0 WHEN 'AVISO' THEN 1 ELSE 2 END, regra, id LIMIT $2`, [id, limite],
  );
}

/** Amostra do que será gravado (a partir do staging), para a pré-visualização. */
export function amostraStaging(ex: Executor, id: string, limite = 25) {
  return ex.consulta<{ tipo: string; codigo: string; descricao: string | null; unidade: string | null; precos: Record<string, string | null> }>(
    `WITH itens AS (
       SELECT DISTINCT ON (tipo, codigo) tipo, codigo, descricao, unidade FROM staging.stg_item
        WHERE importacao_id = $1 ORDER BY tipo, codigo, prioridade, linha)
     SELECT i.tipo, i.codigo, i.descricao, i.unidade,
            (SELECT jsonb_object_agg(coalesce(p.regime_codigo, 'ÚNICO'), p.valor::text) FROM staging.stg_preco p
              WHERE p.importacao_id = $1 AND p.tipo = i.tipo AND p.codigo = i.codigo) AS precos
       FROM (SELECT * FROM itens ORDER BY random() LIMIT $2) i ORDER BY i.tipo, i.codigo`,
    [id, limite],
  );
}
