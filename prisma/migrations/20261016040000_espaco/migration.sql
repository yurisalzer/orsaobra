-- Economia de espaço (plano gratuito do Neon).

-- Redundante: o índice único preco_unico já começa por base_revisao_id.
DROP INDEX IF EXISTS "preco_base_regime";

-- Staging é UNLOGGED e esvaziado a cada importação; DELETE não devolve o
-- espaço dos índices. Quando não há outra importação usando o staging,
-- TRUNCATE devolve todo o espaço.
CREATE OR REPLACE FUNCTION imp_limpar_staging() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM staging.stg_item)
     AND NOT EXISTS (SELECT 1 FROM staging.stg_preco)
     AND NOT EXISTS (SELECT 1 FROM staging.stg_componente) THEN
    TRUNCATE staging.stg_item, staging.stg_preco, staging.stg_componente;
  END IF;
END $$;
