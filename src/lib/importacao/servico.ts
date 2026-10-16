/**
 * Serviço de importação: staging → validação → confirmação transacional →
 * validação humana → publicação. Independente de interface (usado pelo
 * assistente web e pelo importador de linha de comando).
 *
 * Regras centrais:
 *  - Nada vai para as tabelas definitivas antes da confirmação.
 *  - A confirmação é UMA transação: ou tudo é gravado, ou nada.
 *  - Arquivo (SHA-256) já importado com sucesso é bloqueado, salvo autorização.
 *  - Competência já publicada só recebe nova carga como retificação explícita.
 *  - Só bases PUBLICADAS ficam disponíveis para novos orçamentos.
 */
import type { Comando, Executor } from "../banco/executor";
import type { Identificacao, Ocorrencia, RegComponente, RegItem, RegPreco } from "./tipos";

export class ErroImportacao extends Error {
  constructor(message: string, readonly codigo: string) {
    super(message);
  }
}

export interface ArquivoInformado {
  nome: string;
  tamanho: number;
  sha256: string;
  papel?: string | null;
}

export interface Lote {
  itens?: RegItem[];
  precos?: RegPreco[];
  componentes?: RegComponente[];
  ocorrencias?: Ocorrencia[];
}

const json = (v: unknown) => JSON.stringify(v);

// ---------------------------------------------------------------------------
// 1. Início
// ---------------------------------------------------------------------------

export async function iniciarImportacao(
  ex: Executor,
  p: {
    ident: Identificacao;
    arquivos: ArquivoInformado[];
    usuarioId: string;
    autorizarDuplicidade?: boolean;
    retificacao?: { motivo: string } | null;
  },
): Promise<{ importacaoId: string; baseRevisaoId: string; numeroRevisao: number }> {
  const { ident } = p;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(ident.competencia)) throw new ErroImportacao("Competência inválida.", "COMPETENCIA");
  const [fonte] = await ex.consulta<{ id: string }>(`SELECT id FROM fonte WHERE codigo = $1`, [ident.fonte]);
  if (!fonte) throw new ErroImportacao(`Fonte ${ident.fonte} não cadastrada.`, "FONTE");

  const shas = p.arquivos.map((a) => a.sha256.toLowerCase());
  if (shas.some((s) => !/^[0-9a-f]{64}$/.test(s))) throw new ErroImportacao("Hash SHA-256 inválido.", "HASH");
  const repetidos = await ex.consulta<{ nome_original: string; competencia: string }>(
    `SELECT a.nome_original, to_char(b.competencia, 'MM/YYYY') AS competencia
       FROM arquivo_importacao a
       JOIN importacao i ON i.id = a.importacao_id
       JOIN base_revisao r ON r.id = i.base_revisao_id
       JOIN base_mensal b ON b.id = r.base_id
      WHERE a.sha256 = ANY($1) AND i.status = 'CONFIRMADA'`,
    [shas],
  );
  if (repetidos.length && !p.autorizarDuplicidade) {
    throw new ErroImportacao(
      `Arquivo já importado anteriormente: ${repetidos.map((r) => `${r.nome_original} (${r.competencia})`).join(", ")}. ` +
        "Para importar novamente é necessária autorização explícita de um administrador.",
      "DUPLICADO",
    );
  }

  const competencia = `${ident.competencia}-01`;
  const revisoes = await ex.consulta<{ id: string; numero: number; status: string; confirmadas: number }>(
    `SELECT r.id, r.numero, r.status,
            (SELECT count(*)::int FROM importacao i WHERE i.base_revisao_id = r.id AND i.status = 'CONFIRMADA') AS confirmadas
       FROM base_revisao r JOIN base_mensal b ON b.id = r.base_id
      WHERE b.fonte_id = $1 AND b.uf = $2 AND b.competencia = $3
      ORDER BY r.numero DESC`,
    [fonte.id, ident.uf, competencia],
  );
  const ultima = revisoes[0];
  const publicada = revisoes.find((r) => r.status === "PUBLICADA");
  let reaproveitar: string | null = null;
  let numero = 0;
  if (ultima) {
    if (ultima.status === "EM_IMPORTACAO" && ultima.confirmadas === 0) {
      reaproveitar = ultima.id;
      numero = ultima.numero;
    } else if (ultima.status === "EM_IMPORTACAO" || ultima.status === "VALIDADA") {
      throw new ErroImportacao(
        `Já existe a revisão ${ultima.numero} desta competência aguardando validação/publicação. Publique-a ou descarte-a antes.`,
        "REVISAO_PENDENTE",
      );
    } else {
      numero = ultima.numero + 1;
    }
  }
  if (publicada && !reaproveitar && !p.retificacao) {
    throw new ErroImportacao(
      `A competência ${ident.competencia.split("-").reverse().join("/")} de ${ident.fonte}-${ident.uf} já está publicada. ` +
        "Para carregar uma retificação, marque a importação como retificação e informe o motivo.",
      "COMPETENCIA_PUBLICADA",
    );
  }

  const [ids] = await ex.consulta<{ importacao_id: string; revisao_id: string }>(
    `SELECT gen_random_uuid() AS importacao_id, COALESCE($1::uuid, gen_random_uuid()) AS revisao_id`,
    [reaproveitar],
  );
  const cmds: Comando[] = [];
  if (reaproveitar) {
    // tentativas anteriores não confirmadas nesta revisão são canceladas
    cmds.push(
      { sql: `DELETE FROM staging.stg_componente WHERE importacao_id IN (SELECT id FROM importacao WHERE base_revisao_id = $1 AND status IN ('RECEBIDA', 'ANALISADA', 'COM_ERROS', 'VALIDADA'))`, params: [reaproveitar] },
      { sql: `DELETE FROM staging.stg_preco WHERE importacao_id IN (SELECT id FROM importacao WHERE base_revisao_id = $1 AND status IN ('RECEBIDA', 'ANALISADA', 'COM_ERROS', 'VALIDADA'))`, params: [reaproveitar] },
      { sql: `DELETE FROM staging.stg_item WHERE importacao_id IN (SELECT id FROM importacao WHERE base_revisao_id = $1 AND status IN ('RECEBIDA', 'ANALISADA', 'COM_ERROS', 'VALIDADA'))`, params: [reaproveitar] },
      { sql: `UPDATE importacao SET status = 'CANCELADA', concluida_em = now(), erro = 'Substituída por nova tentativa de importação' WHERE base_revisao_id = $1 AND status IN ('RECEBIDA', 'ANALISADA', 'COM_ERROS', 'VALIDADA')`, params: [reaproveitar] },
    );
  }
  cmds.push(
    {
      sql: `INSERT INTO base_mensal (fonte_id, uf, competencia) VALUES ($1, $2, $3)
            ON CONFLICT (fonte_id, uf, competencia) DO NOTHING`,
      params: [fonte.id, ident.uf, competencia],
    },
  );
  if (!reaproveitar) {
    cmds.push({
      sql: `INSERT INTO base_revisao (id, base_id, numero, motivo)
            SELECT $1, id, $2, $3 FROM base_mensal WHERE fonte_id = $4 AND uf = $5 AND competencia = $6`,
      params: [ids.revisao_id, numero, p.retificacao?.motivo ?? null, fonte.id, ident.uf, competencia],
    });
  }
  cmds.push(
    {
      sql: `INSERT INTO importacao (id, base_revisao_id, usuario_id, adaptador, adaptador_versao, duplicidade_autorizada, resumo)
            VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
      params: [ids.importacao_id, ids.revisao_id, p.usuarioId, ident.adaptador, ident.versao, !!(repetidos.length && p.autorizarDuplicidade), json({ identificacao: ident })],
    },
    {
      sql: `INSERT INTO arquivo_importacao (importacao_id, nome_original, tamanho_bytes, sha256, layout)
            SELECT $1, x.nome, x.tamanho, x.sha256, x.papel FROM jsonb_to_recordset($2::jsonb) AS x(nome text, tamanho bigint, sha256 text, papel text)`,
      params: [ids.importacao_id, json(p.arquivos.map((a) => ({ ...a, sha256: a.sha256.toLowerCase(), papel: a.papel ?? ident.layout })))],
    },
    {
      sql: `INSERT INTO auditoria (usuario_id, acao, entidade, entidade_id, depois)
            VALUES ($1, 'IMPORTACAO_INICIADA', 'importacao', $2, $3::jsonb)`,
      params: [p.usuarioId, ids.importacao_id, json({ fonte: ident.fonte, uf: ident.uf, competencia: ident.competencia, revisao: numero, duplicidadeAutorizada: !!(repetidos.length && p.autorizarDuplicidade) })],
    },
  );
  await ex.transacao(cmds);
  return { importacaoId: ids.importacao_id, baseRevisaoId: ids.revisao_id, numeroRevisao: numero };
}

// ---------------------------------------------------------------------------
// 2. Lotes para o staging
// ---------------------------------------------------------------------------

export async function gravarLote(ex: Executor, importacaoId: string, lote: Lote): Promise<void> {
  const cmds: Comando[] = [
    { sql: `SELECT imp_exigir(EXISTS (SELECT 1 FROM importacao WHERE id = $1 AND status = 'RECEBIDA'), 'Importação não está recebendo dados.')`, params: [importacaoId] },
  ];
  if (lote.itens?.length) {
    cmds.push({
      sql: `INSERT INTO staging.stg_item (importacao_id, linha, arquivo, planilha, tipo, codigo, descricao, unidade, grupo, atributos, prioridade)
            SELECT $1, x.linha, x.arquivo, x.planilha, x.tipo, x.codigo, x.descricao, x.unidade, x.grupo, x.atributos, x.prioridade
              FROM jsonb_to_recordset($2::jsonb) AS x(linha int, arquivo text, planilha text, tipo text, codigo text, descricao text, unidade text, grupo text, atributos jsonb, prioridade int)`,
      params: [importacaoId, json(lote.itens)],
    });
  }
  if (lote.precos?.length) {
    cmds.push({
      sql: `INSERT INTO staging.stg_preco (importacao_id, linha, arquivo, planilha, tipo, codigo, regime_codigo, valor_texto, valor, origem_preco, atributos)
            SELECT $1, x.linha, x.arquivo, x.planilha, x.tipo, x.codigo, x.regime, x."valorTexto", x.valor::numeric, x."origemPreco", x.atributos
              FROM jsonb_to_recordset($2::jsonb) AS x(linha int, arquivo text, planilha text, tipo text, codigo text, regime text, "valorTexto" text, valor text, "origemPreco" text, atributos jsonb)`,
      params: [importacaoId, json(lote.precos)],
    });
  }
  if (lote.componentes?.length) {
    cmds.push({
      sql: `INSERT INTO staging.stg_componente (importacao_id, linha, arquivo, planilha, composicao_codigo, regime_codigo, ordem, componente_tipo, componente_codigo,
                                                coeficiente_texto, coeficiente, percentual_texto, percentual, situacao)
            SELECT $1, x.linha, x.arquivo, x.planilha, x.composicao, x.regime, x.ordem, x."componenteTipo", x."componenteCodigo",
                   x."coeficienteTexto", x.coeficiente::numeric, x."percentualTexto", x.percentual::numeric, x.situacao
              FROM jsonb_to_recordset($2::jsonb) AS x(linha int, arquivo text, planilha text, composicao text, regime text, ordem int, "componenteTipo" text, "componenteCodigo" text,
                                                     "coeficienteTexto" text, coeficiente text, "percentualTexto" text, percentual text, situacao text)`,
      params: [importacaoId, json(lote.componentes)],
    });
  }
  if (lote.ocorrencias?.length) {
    cmds.push({
      sql: `INSERT INTO verificacao_importacao (importacao_id, regra, severidade, mensagem, arquivo, planilha, linha, campo, valor)
            SELECT $1, x.regra, x.severidade::"Severidade", left(x.mensagem, 2000), x.arquivo, x.planilha, x.linha, x.campo, left(x.valor, 500)
              FROM jsonb_to_recordset($2::jsonb) AS x(regra text, severidade text, mensagem text, arquivo text, planilha text, linha int, campo text, valor text)`,
      params: [importacaoId, json(lote.ocorrencias)],
    });
  }
  if (cmds.length > 1) await ex.transacao(cmds);
}

// ---------------------------------------------------------------------------
// 3. Validação (regras sobre o staging)
// ---------------------------------------------------------------------------

/** Regras geradas pela validação (reexecutar a validação substitui estas). */
const REGRAS_VALIDACAO = [
  "ITEM_DUPLICADO", "PRECO_DUPLICADO", "PRECO_SEM_ITEM", "REGIME_NAO_DECLARADO", "PRECO_NEGATIVO",
  "PRECO_AUSENTE", "PRECO_ZERADO", "ITEM_SEM_DESCRICAO", "ITEM_SEM_UNIDADE", "COMPOSICAO_INEXISTENTE",
  "COMPONENTE_INEXISTENTE", "COEFICIENTE_INVALIDO", "ORDEM_DUPLICADA", "REFERENCIA_CIRCULAR", "STAGING_VAZIO",
  "COMPARATIVO_ANTERIOR",
];
const LIMITE_EXEMPLOS = 50;

export interface ResumoValidacao {
  status: "VALIDADA" | "COM_ERROS";
  erros: number;
  avisos: number;
  contagens: Record<string, number>;
}

export async function validarImportacao(ex: Executor, importacaoId: string): Promise<ResumoValidacao> {
  const [imp] = await ex.consulta<{ status: string; resumo: { identificacao: Identificacao } }>(
    `SELECT status, resumo FROM importacao WHERE id = $1`, [importacaoId],
  );
  if (!imp) throw new ErroImportacao("Importação não encontrada.", "NAO_ENCONTRADA");
  if (!["RECEBIDA", "COM_ERROS", "VALIDADA"].includes(imp.status)) throw new ErroImportacao(`Importação em situação ${imp.status} não pode ser validada.`, "SITUACAO");
  const regimes = imp.resumo.identificacao.regimes.map((r) => r.codigo);

  // Cada regra: INSERT ... SELECT de exemplos (limitado) + resumo. Executa em transação única.
  const regra = (nome: string, severidade: "ERRO" | "AVISO" | "INFO", from: string, mensagem: string): Comando => ({
    sql: `WITH achados AS (${from}),
          ex AS (SELECT * FROM achados LIMIT ${LIMITE_EXEMPLOS})
          INSERT INTO verificacao_importacao (importacao_id, regra, severidade, mensagem, arquivo, planilha, linha, campo, valor)
          SELECT $1, '${nome}', '${severidade}'::"Severidade", msg, arquivo, planilha, linha, campo, valor FROM ex
          UNION ALL
          SELECT $1, '${nome}', '${severidade}'::"Severidade", '${mensagem.replace(/'/g, "''")} — total: ' || (SELECT count(*) FROM achados) || ' (exemplos acima, até ${LIMITE_EXEMPLOS})',
                 NULL, NULL, NULL, NULL, NULL
           WHERE (SELECT count(*) FROM achados) > ${LIMITE_EXEMPLOS}`,
    params: [importacaoId, ...(from.includes("$2") ? [regimes] : [])],
  });

  // estatísticas atualizadas do staging: sem elas o planejador escolhe planos ruins (minutos em vez de segundos)
  await ex.consulta(`ANALYZE staging.stg_item, staging.stg_preco, staging.stg_componente`);
  const cmds: Comando[] = [
    { sql: `DELETE FROM verificacao_importacao WHERE importacao_id = $1 AND regra = ANY($2)`, params: [importacaoId, REGRAS_VALIDACAO] },
    {
      sql: `INSERT INTO verificacao_importacao (importacao_id, regra, severidade, mensagem)
            SELECT $1, 'STAGING_VAZIO', 'ERRO', 'Nenhum dado foi lido dos arquivos.'
             WHERE NOT EXISTS (SELECT 1 FROM staging.stg_item WHERE importacao_id = $1)`,
      params: [importacaoId],
    },
    regra("ITEM_DUPLICADO", "ERRO",
      `SELECT format('Código %s (%s) repetido na mesma planilha (%s vezes).', codigo, tipo, count(*)) AS msg, min(arquivo) AS arquivo, planilha, min(linha) AS linha, 'codigo' AS campo, codigo AS valor
         FROM staging.stg_item WHERE importacao_id = $1 GROUP BY tipo, codigo, planilha, arquivo, prioridade HAVING count(*) > 1 AND prioridade < 30`,
      "Códigos repetidos"),
    regra("PRECO_DUPLICADO", "ERRO",
      `SELECT format('Preço do código %s (%s, regime %s) aparece %s vezes.', codigo, tipo, coalesce(regime_codigo, 'único'), count(*)) AS msg, min(arquivo) AS arquivo, min(planilha) AS planilha, min(linha) AS linha, 'codigo' AS campo, codigo AS valor
         FROM staging.stg_preco WHERE importacao_id = $1 GROUP BY tipo, codigo, regime_codigo HAVING count(*) > 1`,
      "Preços repetidos"),
    regra("PRECO_SEM_ITEM", "ERRO",
      `SELECT format('Preço para o código %s (%s) sem cadastro do item.', p.codigo, p.tipo) AS msg, p.arquivo, p.planilha, p.linha, 'codigo' AS campo, p.codigo AS valor
         FROM staging.stg_preco p WHERE p.importacao_id = $1
          AND NOT EXISTS (SELECT 1 FROM staging.stg_item i WHERE i.importacao_id = $1 AND i.tipo = p.tipo AND i.codigo = p.codigo)`,
      "Preços sem item"),
    regra("REGIME_NAO_DECLARADO", "ERRO",
      `SELECT format('Regime %s não declarado pelo adaptador.', regime_codigo) AS msg, min(arquivo) AS arquivo, min(planilha) AS planilha, min(linha) AS linha, 'regime' AS campo, regime_codigo AS valor
         FROM staging.stg_preco WHERE importacao_id = $1 AND regime_codigo IS NOT NULL AND NOT (regime_codigo = ANY($2)) GROUP BY regime_codigo`,
      "Regimes não declarados"),
    regra("PRECO_NEGATIVO", "ERRO",
      `SELECT format('Preço negativo (%s) para %s.', valor_texto, codigo) AS msg, arquivo, planilha, linha, 'valor' AS campo, valor_texto AS valor
         FROM staging.stg_preco WHERE importacao_id = $1 AND valor < 0`,
      "Preços negativos"),
    regra("PRECO_AUSENTE", "AVISO",
      `SELECT format('Sem preço publicado para %s %s (regime %s)%s.', lower(tipo), codigo, coalesce(regime_codigo, 'único'),
                     CASE WHEN atributos ? 'sem_custo' THEN ' — custo zerado na publicação' ELSE '' END) AS msg, arquivo, planilha, linha, 'valor' AS campo, valor_texto AS valor
         FROM staging.stg_preco WHERE importacao_id = $1 AND valor IS NULL ORDER BY tipo, codigo, regime_codigo`,
      "Itens sem preço publicado (ficam sem preço; nunca são tratados como zero)"),
    regra("PRECO_ZERADO", "AVISO",
      `SELECT format('Preço publicado igual a zero para %s %s.', lower(tipo), codigo) AS msg, arquivo, planilha, linha, 'valor' AS campo, valor_texto AS valor
         FROM staging.stg_preco WHERE importacao_id = $1 AND valor = 0`,
      "Preços iguais a zero"),
    regra("ITEM_SEM_DESCRICAO", "ERRO",
      `SELECT format('Item %s (%s) sem descrição.', codigo, tipo) AS msg, min(arquivo) AS arquivo, min(planilha) AS planilha, min(linha) AS linha, 'descricao' AS campo, codigo AS valor
         FROM staging.stg_item WHERE importacao_id = $1 GROUP BY tipo, codigo HAVING bool_and(descricao IS NULL)`,
      "Itens sem descrição"),
    regra("ITEM_SEM_UNIDADE", "AVISO",
      `SELECT format('Item %s (%s) publicado sem unidade.', codigo, tipo) AS msg, min(arquivo) AS arquivo, min(planilha) AS planilha, min(linha) AS linha, 'unidade' AS campo, codigo AS valor
         FROM staging.stg_item WHERE importacao_id = $1 GROUP BY tipo, codigo HAVING bool_and(unidade IS NULL)`,
      "Itens sem unidade publicada (gravados sem unidade; nenhuma unidade é presumida)"),
    regra("COMPOSICAO_INEXISTENTE", "ERRO",
      `SELECT format('Analítica da composição %s sem cadastro da composição.', c.composicao_codigo) AS msg, min(c.arquivo) AS arquivo, min(c.planilha) AS planilha, min(c.linha) AS linha, 'composicao' AS campo, c.composicao_codigo AS valor
         FROM staging.stg_componente c WHERE c.importacao_id = $1
          AND NOT EXISTS (SELECT 1 FROM staging.stg_item i WHERE i.importacao_id = $1 AND i.tipo = 'COMPOSICAO' AND i.codigo = c.composicao_codigo)
        GROUP BY c.composicao_codigo`,
      "Analíticas sem composição"),
    regra("COMPONENTE_INEXISTENTE", "ERRO",
      `SELECT format('Componente %s (%s) da composição %s não existe no cadastro.', c.componente_codigo, c.componente_tipo, c.composicao_codigo) AS msg, c.arquivo, c.planilha, c.linha, 'componente' AS campo, c.componente_codigo AS valor
         FROM staging.stg_componente c WHERE c.importacao_id = $1
          AND NOT EXISTS (SELECT 1 FROM staging.stg_item i WHERE i.importacao_id = $1 AND i.tipo = c.componente_tipo AND i.codigo = c.componente_codigo)`,
      "Componentes inexistentes"),
    regra("COEFICIENTE_INVALIDO", "ERRO",
      `SELECT format('Coeficiente inválido (%s) do componente %s na composição %s.', coalesce(coeficiente_texto, 'vazio'), componente_codigo, composicao_codigo) AS msg, arquivo, planilha, linha, 'coeficiente' AS campo, coeficiente_texto AS valor
         FROM staging.stg_componente WHERE importacao_id = $1 AND (coeficiente IS NULL OR coeficiente < 0 OR (percentual_texto IS NOT NULL AND percentual IS NULL))`,
      "Coeficientes inválidos"),
    regra("ORDEM_DUPLICADA", "ERRO",
      `SELECT format('Ordem %s repetida na composição %s.', ordem, composicao_codigo) AS msg, min(arquivo) AS arquivo, min(planilha) AS planilha, min(linha) AS linha, 'ordem' AS campo, ordem::text AS valor
         FROM staging.stg_componente WHERE importacao_id = $1 GROUP BY composicao_codigo, regime_codigo, ordem HAVING count(*) > 1`,
      "Ordens repetidas"),
    regra("REFERENCIA_CIRCULAR", "ERRO",
      `WITH RECURSIVE arestas AS (
         SELECT DISTINCT composicao_codigo AS de, componente_codigo AS para FROM staging.stg_componente
          WHERE importacao_id = $1 AND componente_tipo = 'COMPOSICAO'),
       busca(origem, atual, caminho, ciclo) AS (
         SELECT de, para, ARRAY[de, para], de = para FROM arestas
         UNION ALL
         SELECT b.origem, a.para, b.caminho || a.para, a.para = b.origem
           FROM busca b JOIN arestas a ON a.de = b.atual
          WHERE NOT b.ciclo AND NOT (a.para = ANY(b.caminho[2:])) AND cardinality(b.caminho) < 50)
       SELECT DISTINCT ON (origem) format('Referência circular: %s', array_to_string(caminho, ' → ')) AS msg,
              NULL::text AS arquivo, NULL::text AS planilha, NULL::int AS linha, 'composicao' AS campo, origem AS valor
         FROM busca WHERE ciclo`,
      "Referências circulares"),
  ];
  await ex.transacao(cmds);

  // Comparativo com a última base publicada da mesma fonte/UF (informativo)
  const [comp] = await ex.consulta<{ novos: number; removidos: number; anterior: string | null }>(
    `WITH anterior AS (
       SELECT r.id, to_char(b.competencia, 'MM/YYYY') AS comp FROM base_revisao r JOIN base_mensal b ON b.id = r.base_id
        WHERE r.status = 'PUBLICADA' AND b.fonte_id = (SELECT b2.fonte_id FROM importacao i JOIN base_revisao r2 ON r2.id = i.base_revisao_id JOIN base_mensal b2 ON b2.id = r2.base_id WHERE i.id = $1)
          AND b.uf = $2 AND b.competencia < $3::date
        ORDER BY b.competencia DESC LIMIT 1),
     antigos AS (SELECT DISTINCT ir.tipo::text AS tipo, ir.codigo FROM preco p JOIN item_referencia ir ON ir.id = p.item_id WHERE p.base_revisao_id = (SELECT id FROM anterior)),
     atuais AS (SELECT DISTINCT tipo, codigo FROM staging.stg_preco WHERE importacao_id = $1 AND valor IS NOT NULL)
     SELECT (SELECT count(*)::int FROM atuais a WHERE NOT EXISTS (SELECT 1 FROM antigos o WHERE o.tipo = a.tipo AND o.codigo = a.codigo)) AS novos,
            (SELECT count(*)::int FROM antigos o WHERE NOT EXISTS (SELECT 1 FROM atuais a WHERE o.tipo = a.tipo AND o.codigo = a.codigo)) AS removidos,
            (SELECT comp FROM anterior) AS anterior`,
    [importacaoId, imp.resumo.identificacao.uf, `${imp.resumo.identificacao.competencia}-01`],
  );
  if (comp?.anterior) {
    await ex.consulta(
      `INSERT INTO verificacao_importacao (importacao_id, regra, severidade, mensagem) VALUES ($1, 'COMPARATIVO_ANTERIOR', 'INFO', $2)`,
      [importacaoId, `Em relação à base publicada de ${comp.anterior}: ${comp.novos} itens com preço novos e ${comp.removidos} que deixaram de ter preço.`],
    );
  }

  const [tot] = await ex.consulta<{ erros: number; avisos: number; itens: number; precos: number; precos_ausentes: number; componentes: number; composicoes: number }>(
    `SELECT (SELECT count(*)::int FROM verificacao_importacao WHERE importacao_id = $1 AND severidade = 'ERRO') AS erros,
            (SELECT count(*)::int FROM verificacao_importacao WHERE importacao_id = $1 AND severidade = 'AVISO') AS avisos,
            (SELECT count(*)::int FROM (SELECT DISTINCT tipo, codigo FROM staging.stg_item WHERE importacao_id = $1) x) AS itens,
            (SELECT count(*)::int FROM staging.stg_preco WHERE importacao_id = $1 AND valor IS NOT NULL) AS precos,
            (SELECT count(*)::int FROM staging.stg_preco WHERE importacao_id = $1 AND valor IS NULL) AS precos_ausentes,
            (SELECT count(*)::int FROM staging.stg_componente WHERE importacao_id = $1) AS componentes,
            (SELECT count(*)::int FROM (SELECT DISTINCT composicao_codigo, regime_codigo FROM staging.stg_componente WHERE importacao_id = $1) x) AS composicoes`,
    [importacaoId],
  );
  const status = tot.erros > 0 ? "COM_ERROS" : "VALIDADA";
  const contagens = { itens: tot.itens, precos: tot.precos, precosAusentes: tot.precos_ausentes, componentes: tot.componentes, composicoes: tot.composicoes };
  await ex.consulta(
    `UPDATE importacao SET status = $2::"StatusImportacao", resumo = resumo || jsonb_build_object('contagens', $3::jsonb, 'erros', $4::int, 'avisos', $5::int) WHERE id = $1`,
    [importacaoId, status, json(contagens), tot.erros, tot.avisos],
  );
  return { status, erros: tot.erros, avisos: tot.avisos, contagens };
}

// ---------------------------------------------------------------------------
// 4. Confirmação (uma única transação)
// ---------------------------------------------------------------------------

export async function confirmarImportacao(
  ex: Executor,
  importacaoId: string,
  p: { usuarioId: string; cienteAvisos: boolean },
): Promise<void> {
  const [imp] = await ex.consulta<{ status: string; avisos: number; base_revisao_id: string; fonte_id: string }>(
    `SELECT i.status, i.base_revisao_id, b.fonte_id,
            (SELECT count(*)::int FROM verificacao_importacao v WHERE v.importacao_id = i.id AND v.severidade = 'AVISO') AS avisos
       FROM importacao i JOIN base_revisao r ON r.id = i.base_revisao_id JOIN base_mensal b ON b.id = r.base_id WHERE i.id = $1`,
    [importacaoId],
  );
  if (!imp) throw new ErroImportacao("Importação não encontrada.", "NAO_ENCONTRADA");
  if (imp.status !== "VALIDADA") throw new ErroImportacao(`Somente importações validadas podem ser confirmadas (situação atual: ${imp.status}).`, "SITUACAO");
  if (imp.avisos > 0 && !p.cienteAvisos) throw new ErroImportacao(`Há ${imp.avisos} avisos. Confirme que tomou ciência deles.`, "AVISOS");

  const I = importacaoId;
  const cmds: Comando[] = [
    // trava e reconfere a situação dentro da transação
    { sql: `SELECT imp_exigir((SELECT status = 'VALIDADA' FROM importacao WHERE id = $1 FOR UPDATE), 'A importação mudou de situação; recarregue a página.')`, params: [I] },
    { sql: `SELECT imp_exigir((SELECT r.status = 'EM_IMPORTACAO' FROM importacao i JOIN base_revisao r ON r.id = i.base_revisao_id WHERE i.id = $1 FOR UPDATE OF r), 'A revisão da base não está em importação.')`, params: [I] },
    // regimes declarados pelo adaptador (cadastro idempotente)
    {
      sql: `INSERT INTO regime (fonte_id, codigo, nome, descricao)
            SELECT $2, x.codigo, x.nome, x.descricao FROM importacao i,
                   jsonb_to_recordset(i.resumo->'identificacao'->'regimes') AS x(codigo text, nome text, descricao text)
             WHERE i.id = $1
            ON CONFLICT (fonte_id, codigo) DO UPDATE SET nome = EXCLUDED.nome, descricao = EXCLUDED.descricao`,
      params: [I, imp.fonte_id],
    },
    // itens (identidade)
    {
      sql: `INSERT INTO item_referencia (fonte_id, tipo, codigo)
            SELECT DISTINCT $2::uuid, tipo::"TipoItem", codigo FROM staging.stg_item WHERE importacao_id = $1
            ON CONFLICT (fonte_id, tipo, codigo) DO NOTHING`,
      params: [I, imp.fonte_id],
    },
    // versão escolhida de cada item: linha de menor prioridade; atributos mesclados
    {
      sql: `CREATE TEMP TABLE tmp_item ON COMMIT DROP AS
            WITH escolhido AS (
              SELECT DISTINCT ON (tipo, codigo) tipo, codigo, descricao, unidade, grupo
                FROM staging.stg_item WHERE importacao_id = $1
               ORDER BY tipo, codigo, prioridade, linha),
            attrs AS (
              SELECT s.tipo, s.codigo, jsonb_object_agg(k.key, k.value) AS atributos
                FROM staging.stg_item s, jsonb_each(coalesce(s.atributos, '{}'::jsonb)) k
               WHERE s.importacao_id = $1 GROUP BY s.tipo, s.codigo)
            SELECT ir.id AS item_id, e.tipo, e.codigo, e.descricao, e.unidade, e.grupo, a.atributos,
                   encode(sha256(convert_to(concat_ws(chr(31), e.descricao, e.unidade, e.grupo, coalesce(a.atributos::text, '')), 'UTF8')), 'hex') AS hash
              FROM escolhido e
              LEFT JOIN attrs a ON a.tipo = e.tipo AND a.codigo = e.codigo
              JOIN item_referencia ir ON ir.fonte_id = $2 AND ir.tipo = e.tipo::"TipoItem" AND ir.codigo = e.codigo`,
      params: [I, imp.fonte_id],
    },
    { sql: `ANALYZE tmp_item` },
    {
      sql: `INSERT INTO item_versao (item_id, descricao, unidade, grupo, atributos, hash, primeira_base_revisao_id)
            SELECT item_id, descricao, unidade, grupo, atributos, hash, $1 FROM tmp_item
            ON CONFLICT (item_id, hash) DO NOTHING`,
      params: [imp.base_revisao_id],
    },
    // preços publicados (ausentes não geram linha)
    {
      sql: `INSERT INTO preco (base_revisao_id, item_id, item_versao_id, regime_id, valor, origem_preco, atributos)
            SELECT $2, t.item_id, v.id, rg.id, p.valor, p.origem_preco, p.atributos
              FROM staging.stg_preco p
              JOIN tmp_item t ON t.tipo = p.tipo AND t.codigo = p.codigo
              JOIN item_versao v ON v.item_id = t.item_id AND v.hash = t.hash
              LEFT JOIN regime rg ON rg.fonte_id = $3 AND rg.codigo = p.regime_codigo
             WHERE p.importacao_id = $1 AND p.valor IS NOT NULL`,
      params: [I, imp.base_revisao_id, imp.fonte_id],
    },
    { sql: `SELECT imp_exigir(NOT EXISTS (SELECT 1 FROM staging.stg_preco p WHERE p.importacao_id = $1 AND p.regime_codigo IS NOT NULL AND NOT EXISTS (SELECT 1 FROM regime r WHERE r.fonte_id = $2 AND r.codigo = p.regime_codigo)), 'Regime não cadastrado.')`, params: [I, imp.fonte_id] },
    // composições: estrutura deduplicada por hash
    {
      sql: `CREATE TEMP TABLE tmp_comp ON COMMIT DROP AS
            SELECT ir.id AS item_id, c.composicao_codigo, c.regime_codigo,
                   encode(sha256(convert_to(string_agg(concat_ws(chr(31), c.ordem, c.componente_tipo, c.componente_codigo, c.coeficiente::text, coalesce(c.percentual::text, '')), chr(30) ORDER BY c.ordem), 'UTF8')), 'hex') AS hash
              FROM staging.stg_componente c
              JOIN item_referencia ir ON ir.fonte_id = $2 AND ir.tipo = 'COMPOSICAO' AND ir.codigo = c.composicao_codigo
             WHERE c.importacao_id = $1
             GROUP BY ir.id, c.composicao_codigo, c.regime_codigo`,
      params: [I, imp.fonte_id],
    },
    { sql: `ANALYZE tmp_comp` },
    {
      sql: `INSERT INTO composicao_versao (item_id, origem, hash)
            SELECT DISTINCT item_id, 'OFICIAL'::"OrigemComposicao", hash FROM tmp_comp
            ON CONFLICT (item_id, hash) DO NOTHING`,
    },
    // versões recém-criadas = as que ainda não têm componentes
    {
      sql: `CREATE TEMP TABLE tmp_versao_nova ON COMMIT DROP AS
            SELECT DISTINCT v.id, v.item_id, v.hash FROM tmp_comp t
              JOIN composicao_versao v ON v.item_id = t.item_id AND v.hash = t.hash
             WHERE NOT EXISTS (SELECT 1 FROM composicao_componente cc WHERE cc.composicao_versao_id = v.id)`,
    },
    { sql: `ANALYZE tmp_versao_nova` },
    {
      sql: `INSERT INTO composicao_componente (composicao_versao_id, componente_item_id, coeficiente, percentual, ordem, tipo_original, situacao)
            SELECT DISTINCT ON (nv.id, c.ordem) nv.id, comp_item.id, c.coeficiente, c.percentual, c.ordem, c.componente_tipo, c.situacao
              FROM tmp_versao_nova nv
              JOIN tmp_comp t ON t.item_id = nv.item_id AND t.hash = nv.hash
              JOIN staging.stg_componente c ON c.importacao_id = $1 AND c.composicao_codigo = t.composicao_codigo
                   AND coalesce(c.regime_codigo, '') = coalesce(t.regime_codigo, '')
              JOIN item_referencia comp_item ON comp_item.fonte_id = $2 AND comp_item.tipo = c.componente_tipo::"TipoItem" AND comp_item.codigo = c.componente_codigo
             ORDER BY nv.id, c.ordem`,
      params: [I, imp.fonte_id],
    },
    {
      sql: `INSERT INTO base_composicao (base_revisao_id, item_id, regime_id, composicao_versao_id)
            SELECT $1, t.item_id, rg.id, v.id
              FROM tmp_comp t
              JOIN composicao_versao v ON v.item_id = t.item_id AND v.hash = t.hash
              LEFT JOIN regime rg ON rg.fonte_id = $2 AND rg.codigo = t.regime_codigo`,
      params: [imp.base_revisao_id, imp.fonte_id],
    },
    // conferências finais de integridade da carga
    {
      sql: `SELECT imp_exigir(
              (SELECT count(*) FROM preco WHERE base_revisao_id = $2) >= (SELECT count(*) FROM staging.stg_preco WHERE importacao_id = $1 AND valor IS NOT NULL),
              'Contagem de preços gravados não confere com o staging.')`,
      params: [I, imp.base_revisao_id],
    },
    {
      sql: `SELECT imp_exigir(NOT EXISTS (
              SELECT 1 FROM tmp_comp t JOIN composicao_versao v ON v.item_id = t.item_id AND v.hash = t.hash
               WHERE (SELECT count(*) FROM composicao_componente cc WHERE cc.composicao_versao_id = v.id)
                  <> (SELECT count(*) FROM staging.stg_componente c WHERE c.importacao_id = $1 AND c.composicao_codigo = t.composicao_codigo AND coalesce(c.regime_codigo, '') = coalesce(t.regime_codigo, ''))),
              'Componentes gravados não conferem com a analítica do arquivo.')`,
      params: [I],
    },
    {
      sql: `UPDATE importacao SET status = 'CONFIRMADA', concluida_em = now(),
                   resumo = resumo || jsonb_build_object('gravado', jsonb_build_object(
                     'precos', (SELECT count(*) FROM preco WHERE base_revisao_id = $2),
                     'composicoes', (SELECT count(*) FROM base_composicao WHERE base_revisao_id = $2),
                     'versoesComposicaoNovas', (SELECT count(*) FROM tmp_versao_nova)))
             WHERE id = $1`,
      params: [I, imp.base_revisao_id],
    },
    { sql: `INSERT INTO auditoria (usuario_id, acao, entidade, entidade_id, depois) VALUES ($1, 'IMPORTACAO_CONFIRMADA', 'importacao', $2, jsonb_build_object('ciente_avisos', $3::boolean))`, params: [p.usuarioId, I, p.cienteAvisos] },
    { sql: `DELETE FROM staging.stg_componente WHERE importacao_id = $1`, params: [I] },
    { sql: `DELETE FROM staging.stg_preco WHERE importacao_id = $1`, params: [I] },
    { sql: `DELETE FROM staging.stg_item WHERE importacao_id = $1`, params: [I] },
    { sql: `SELECT imp_limpar_staging()` },
  ];
  try {
    await ex.transacao(cmds);
  } catch (e) {
    // a transação foi desfeita por inteiro; registra a falha (fora dela)
    await registrarFalha(ex, importacaoId, p.usuarioId, (e as Error).message);
    throw new ErroImportacao(`A gravação falhou e nada foi gravado (transação desfeita): ${(e as Error).message}`, "FALHA_GRAVACAO");
  }
}

export async function registrarFalha(ex: Executor, importacaoId: string, usuarioId: string | null, mensagem: string) {
  await ex.transacao([
    { sql: `UPDATE importacao SET status = 'FALHOU', erro = left($2, 4000), concluida_em = now() WHERE id = $1 AND status <> 'CONFIRMADA'`, params: [importacaoId, mensagem] },
    { sql: `INSERT INTO auditoria (usuario_id, acao, entidade, entidade_id, depois) VALUES ($1, 'IMPORTACAO_FALHOU', 'importacao', $2, jsonb_build_object('erro', left($3, 2000)))`, params: [usuarioId, importacaoId, mensagem] },
    { sql: `DELETE FROM staging.stg_componente WHERE importacao_id = $1`, params: [importacaoId] },
    { sql: `DELETE FROM staging.stg_preco WHERE importacao_id = $1`, params: [importacaoId] },
    { sql: `DELETE FROM staging.stg_item WHERE importacao_id = $1`, params: [importacaoId] },
    { sql: `SELECT imp_limpar_staging()` },
  ]);
}

export async function cancelarImportacao(ex: Executor, importacaoId: string, usuarioId: string) {
  await ex.transacao([
    { sql: `SELECT imp_exigir((SELECT status IN ('RECEBIDA', 'ANALISADA', 'COM_ERROS', 'VALIDADA') FROM importacao WHERE id = $1), 'Esta importação não pode mais ser cancelada.')`, params: [importacaoId] },
    { sql: `UPDATE importacao SET status = 'CANCELADA', concluida_em = now() WHERE id = $1`, params: [importacaoId] },
    { sql: `INSERT INTO auditoria (usuario_id, acao, entidade, entidade_id) VALUES ($1, 'IMPORTACAO_CANCELADA', 'importacao', $2)`, params: [usuarioId, importacaoId] },
    { sql: `DELETE FROM staging.stg_componente WHERE importacao_id = $1`, params: [importacaoId] },
    { sql: `DELETE FROM staging.stg_preco WHERE importacao_id = $1`, params: [importacaoId] },
    { sql: `DELETE FROM staging.stg_item WHERE importacao_id = $1`, params: [importacaoId] },
    { sql: `SELECT imp_limpar_staging()` },
  ]);
}

// ---------------------------------------------------------------------------
// 5. Ciclo de vida da base: validação humana, publicação, descarte
// ---------------------------------------------------------------------------

export async function validarBase(ex: Executor, baseRevisaoId: string, usuarioId: string) {
  await ex.transacao([
    { sql: `SELECT imp_exigir((SELECT status = 'EM_IMPORTACAO' FROM base_revisao WHERE id = $1 FOR UPDATE), 'A base não está em importação.')`, params: [baseRevisaoId] },
    { sql: `SELECT imp_exigir(EXISTS (SELECT 1 FROM importacao WHERE base_revisao_id = $1 AND status = 'CONFIRMADA'), 'A base não tem nenhuma importação confirmada.')`, params: [baseRevisaoId] },
    { sql: `SELECT imp_exigir(NOT EXISTS (SELECT 1 FROM importacao WHERE base_revisao_id = $1 AND status IN ('RECEBIDA', 'ANALISADA', 'COM_ERROS', 'VALIDADA')), 'Há importação em andamento nesta base.')`, params: [baseRevisaoId] },
    { sql: `UPDATE base_revisao SET status = 'VALIDADA', validada_em = now() WHERE id = $1`, params: [baseRevisaoId] },
    { sql: `INSERT INTO auditoria (usuario_id, acao, entidade, entidade_id) VALUES ($1, 'BASE_VALIDADA', 'base_revisao', $2)`, params: [usuarioId, baseRevisaoId] },
  ]);
}

export async function publicarBase(ex: Executor, baseRevisaoId: string, usuarioId: string) {
  await ex.transacao([
    { sql: `SELECT imp_exigir((SELECT status = 'VALIDADA' FROM base_revisao WHERE id = $1 FOR UPDATE), 'Somente bases validadas podem ser publicadas.')`, params: [baseRevisaoId] },
    // a revisão anteriormente publicada (se houver) passa a SUBSTITUIDA — continua intacta para os orçamentos que a usam
    { sql: `UPDATE base_revisao SET status = 'SUBSTITUIDA' WHERE base_id = (SELECT base_id FROM base_revisao WHERE id = $1) AND status = 'PUBLICADA'`, params: [baseRevisaoId] },
    { sql: `UPDATE base_revisao SET status = 'PUBLICADA', publicada_em = now() WHERE id = $1`, params: [baseRevisaoId] },
    { sql: `INSERT INTO auditoria (usuario_id, acao, entidade, entidade_id) VALUES ($1, 'BASE_PUBLICADA', 'base_revisao', $2)`, params: [usuarioId, baseRevisaoId] },
  ]);
}

export async function descartarBase(ex: Executor, baseRevisaoId: string, usuarioId: string, motivo: string) {
  await ex.transacao([
    { sql: `SELECT imp_exigir((SELECT status IN ('EM_IMPORTACAO', 'VALIDADA') FROM base_revisao WHERE id = $1 FOR UPDATE), 'Somente bases não publicadas podem ser descartadas.')`, params: [baseRevisaoId] },
    { sql: `SELECT imp_exigir(NOT EXISTS (SELECT 1 FROM item_orcamento WHERE base_revisao_id = $1), 'Base usada em orçamento não pode ser descartada.')`, params: [baseRevisaoId] },
    { sql: `DELETE FROM base_composicao WHERE base_revisao_id = $1`, params: [baseRevisaoId] },
    { sql: `DELETE FROM preco WHERE base_revisao_id = $1`, params: [baseRevisaoId] },
    { sql: `UPDATE item_versao SET primeira_base_revisao_id = NULL WHERE primeira_base_revisao_id = $1`, params: [baseRevisaoId] },
    { sql: `UPDATE base_revisao SET status = 'DESCARTADA', motivo = coalesce(motivo || ' | ', '') || 'Descartada: ' || $2 WHERE id = $1`, params: [baseRevisaoId, motivo] },
    { sql: `INSERT INTO auditoria (usuario_id, acao, entidade, entidade_id, depois) VALUES ($1, 'BASE_DESCARTADA', 'base_revisao', $2, jsonb_build_object('motivo', $3::text))`, params: [usuarioId, baseRevisaoId, motivo] },
  ]);
}
