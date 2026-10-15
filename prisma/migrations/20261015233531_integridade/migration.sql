-- =============================================================================
-- Integridade, busca e staging — objetos que o Prisma não expressa.
-- =============================================================================

-- Busca sem acentos: unaccent() não é IMMUTABLE, então criamos um wrapper.
CREATE OR REPLACE FUNCTION f_unaccent(text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$;

CREATE INDEX item_versao_descricao_trgm ON item_versao
  USING gin (lower(f_unaccent(descricao)) gin_trgm_ops);

-- Competência sempre no dia 1; UF em maiúsculas.
ALTER TABLE base_mensal ADD CONSTRAINT base_mensal_competencia_dia1
  CHECK (extract(day FROM competencia) = 1);
ALTER TABLE base_mensal ADD CONSTRAINT base_mensal_uf_maiuscula
  CHECK (uf = upper(uf));

-- Valores não negativos.
ALTER TABLE preco ADD CONSTRAINT preco_valor_nao_negativo CHECK (valor >= 0);
ALTER TABLE preco_proprio ADD CONSTRAINT preco_proprio_valor_nao_negativo CHECK (valor >= 0);
ALTER TABLE composicao_componente ADD CONSTRAINT componente_coef_nao_negativo CHECK (coeficiente >= 0);
ALTER TABLE item_orcamento ADD CONSTRAINT item_quantidade_nao_negativa CHECK (quantidade >= 0);
ALTER TABLE cronograma_parcela ADD CONSTRAINT cronograma_percentual_faixa CHECK (percentual >= 0 AND percentual <= 100);

-- Composição não pode conter a si mesma diretamente (ciclos indiretos são
-- verificados na aplicação antes de gravar).
CREATE OR REPLACE FUNCTION trg_componente_sem_autorreferencia() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.componente_item_id = (SELECT item_id FROM composicao_versao WHERE id = NEW.composicao_versao_id) THEN
    RAISE EXCEPTION 'Composição não pode conter a si mesma' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER componente_sem_autorreferencia BEFORE INSERT OR UPDATE ON composicao_componente
  FOR EACH ROW EXECUTE FUNCTION trg_componente_sem_autorreferencia();

-- base_composicao: regime nulo também participa da unicidade.
DROP INDEX base_composicao_unica;
CREATE UNIQUE INDEX base_composicao_unica ON base_composicao (base_revisao_id, item_id, regime_id) NULLS NOT DISTINCT;

-- No máximo uma revisão PUBLICADA por base mensal.
CREATE UNIQUE INDEX base_revisao_uma_publicada ON base_revisao (base_id) WHERE status = 'PUBLICADA';

-- Preços e composições de bases publicadas/substituídas são imutáveis.
CREATE OR REPLACE FUNCTION trg_base_imutavel() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  st text;
BEGIN
  SELECT status INTO st FROM base_revisao
   WHERE id = COALESCE(NEW.base_revisao_id, OLD.base_revisao_id);
  IF st IN ('PUBLICADA', 'SUBSTITUIDA') THEN
    RAISE EXCEPTION 'Base de referência publicada não pode ser alterada (use uma retificação)'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER preco_base_imutavel BEFORE INSERT OR UPDATE OR DELETE ON preco
  FOR EACH ROW EXECUTE FUNCTION trg_base_imutavel();
CREATE TRIGGER base_composicao_imutavel BEFORE INSERT OR UPDATE OR DELETE ON base_composicao
  FOR EACH ROW EXECUTE FUNCTION trg_base_imutavel();

-- Versões de composição oficiais já gravadas não mudam (são compartilhadas
-- entre meses). Componentes só podem ser inseridos junto da versão.
CREATE OR REPLACE FUNCTION trg_componente_imutavel() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Componentes de uma versão de composição são imutáveis; crie nova versão'
    USING ERRCODE = 'integrity_constraint_violation';
END $$;
CREATE TRIGGER componente_imutavel BEFORE UPDATE ON composicao_componente
  FOR EACH ROW EXECUTE FUNCTION trg_componente_imutavel();

-- -----------------------------------------------------------------------------
-- Revisões de orçamento FECHADAS são imutáveis (proteção no próprio banco,
-- independente de falhas na aplicação).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_revisao_fechada_filhos() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  st text;
BEGIN
  SELECT status INTO st FROM orcamento_revisao
   WHERE id = COALESCE(NEW.revisao_id, OLD.revisao_id);
  IF st = 'FECHADA' THEN
    RAISE EXCEPTION 'Revisão de orçamento fechada não pode ser alterada'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

CREATE TRIGGER item_orcamento_revisao_fechada BEFORE INSERT OR UPDATE OR DELETE ON item_orcamento
  FOR EACH ROW EXECUTE FUNCTION trg_revisao_fechada_filhos();
CREATE TRIGGER etapa_revisao_fechada BEFORE INSERT OR UPDATE OR DELETE ON etapa
  FOR EACH ROW EXECUTE FUNCTION trg_revisao_fechada_filhos();
CREATE TRIGGER cronograma_revisao_fechada BEFORE INSERT OR UPDATE OR DELETE ON cronograma_parcela
  FOR EACH ROW EXECUTE FUNCTION trg_revisao_fechada_filhos();
CREATE TRIGGER base_padrao_revisao_fechada BEFORE INSERT OR UPDATE OR DELETE ON revisao_base_padrao
  FOR EACH ROW EXECUTE FUNCTION trg_revisao_fechada_filhos();

CREATE OR REPLACE FUNCTION trg_revisao_fechada_propria() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'FECHADA' THEN
    RAISE EXCEPTION 'Revisão de orçamento fechada não pode ser alterada nem excluída'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER orcamento_revisao_fechada BEFORE UPDATE OR DELETE ON orcamento_revisao
  FOR EACH ROW EXECUTE FUNCTION trg_revisao_fechada_propria();

-- Auditoria é somente inserção.
CREATE OR REPLACE FUNCTION trg_auditoria_somente_insercao() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Registros de auditoria não podem ser alterados ou excluídos';
END $$;
CREATE TRIGGER auditoria_somente_insercao BEFORE UPDATE OR DELETE ON auditoria
  FOR EACH ROW EXECUTE FUNCTION trg_auditoria_somente_insercao();

-- -----------------------------------------------------------------------------
-- Staging de importação (UNLOGGED: rápido, não ocupa WAL; descartável).
-- Os adaptadores gravam aqui em lotes; a confirmação move para as tabelas
-- definitivas com INSERT ... SELECT numa única transação.
-- Ficam no schema "staging", fora do controle do Prisma.
-- -----------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS staging;

CREATE UNLOGGED TABLE staging.stg_item (
  importacao_id uuid NOT NULL REFERENCES importacao(id) ON DELETE CASCADE,
  linha         int,
  arquivo       text,
  planilha      text,
  tipo          text NOT NULL,      -- INSUMO | COMPOSICAO
  codigo        text NOT NULL,
  descricao     text,
  unidade       text,
  grupo         text,
  atributos     jsonb
);
CREATE INDEX stg_item_imp ON staging.stg_item (importacao_id, tipo, codigo);

CREATE UNLOGGED TABLE staging.stg_preco (
  importacao_id uuid NOT NULL REFERENCES importacao(id) ON DELETE CASCADE,
  linha         int,
  arquivo       text,
  planilha      text,
  tipo          text NOT NULL,
  codigo        text NOT NULL,
  regime_codigo text NOT NULL,
  valor_texto   text,               -- valor bruto como lido (auditoria)
  valor         numeric(18,4),      -- NULL = ausente
  origem_preco  text
);
CREATE INDEX stg_preco_imp ON staging.stg_preco (importacao_id, tipo, codigo);

CREATE UNLOGGED TABLE staging.stg_componente (
  importacao_id     uuid NOT NULL REFERENCES importacao(id) ON DELETE CASCADE,
  linha             int,
  arquivo           text,
  planilha          text,
  composicao_codigo text NOT NULL,
  regime_codigo     text,           -- NULL quando a analítica independe do regime
  ordem             int NOT NULL,
  componente_tipo   text NOT NULL,
  componente_codigo text NOT NULL,
  coeficiente_texto text,
  coeficiente       numeric(24,10)
);
CREATE INDEX stg_componente_imp ON staging.stg_componente (importacao_id, composicao_codigo);
