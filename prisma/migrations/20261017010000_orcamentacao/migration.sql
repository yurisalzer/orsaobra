-- AlterTable
ALTER TABLE "bdi_perfil" ADD COLUMN     "percentual_informado" DECIMAL(9,6);

-- AlterTable
ALTER TABLE "item_orcamento" ADD COLUMN     "custo_total" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "origem_preco" TEXT,
ADD COLUMN     "pendencia" TEXT,
ADD COLUMN     "referencia_preco" TEXT;

-- AlterTable
ALTER TABLE "orcamento_revisao" ADD COLUMN     "criado_por_id" UUID,
ADD COLUMN     "data_referencia" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
ALTER COLUMN "atualizado_em" SET DEFAULT CURRENT_TIMESTAMP;


-- =============================================================================
-- Somente bases PUBLICADAS (ou já substituídas, para revisões antigas) podem
-- ser usadas em orçamentos. Bases em conferência nunca entram em orçamento.
-- =============================================================================
CREATE OR REPLACE FUNCTION trg_orcamento_base_publicada() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  st text;
BEGIN
  IF NEW.base_revisao_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.base_revisao_id IS NOT DISTINCT FROM OLD.base_revisao_id THEN
    RETURN NEW;
  END IF;
  SELECT status INTO st FROM base_revisao WHERE id = NEW.base_revisao_id;
  IF st NOT IN ('PUBLICADA', 'SUBSTITUIDA') THEN
    RAISE EXCEPTION 'Base de referência não publicada não pode ser usada em orçamento'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER item_orcamento_base_publicada BEFORE INSERT OR UPDATE ON item_orcamento
  FOR EACH ROW EXECUTE FUNCTION trg_orcamento_base_publicada();
CREATE TRIGGER revisao_base_padrao_publicada BEFORE INSERT OR UPDATE ON revisao_base_padrao
  FOR EACH ROW EXECUTE FUNCTION trg_orcamento_base_publicada();

-- Quantidades/valores coerentes
ALTER TABLE item_orcamento ADD CONSTRAINT item_custo_nao_negativo CHECK (custo_unitario >= 0);
ALTER TABLE bdi_parcela ADD CONSTRAINT bdi_parcela_nao_negativa CHECK (percentual >= 0);
ALTER TABLE bdi_perfil ADD CONSTRAINT bdi_informado_faixa CHECK (percentual_informado IS NULL OR (percentual_informado >= 0 AND percentual_informado < 1000));
