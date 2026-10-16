-- DropForeignKey
ALTER TABLE "base_composicao" DROP CONSTRAINT "base_composicao_regime_id_fkey";

-- AlterTable
ALTER TABLE "composicao_componente" ADD COLUMN     "percentual" DECIMAL(24,10),
ADD COLUMN     "situacao" TEXT;

-- AlterTable
ALTER TABLE "preco" ADD COLUMN     "atributos" JSONB,
ALTER COLUMN "regime_id" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "base_composicao" ADD CONSTRAINT "base_composicao_regime_id_fkey" FOREIGN KEY ("regime_id") REFERENCES "regime"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "preco_base_revisao_id_item_id_regime_id_key" RENAME TO "preco_unico";


-- =============================================================================
-- Ajustes manuais (não expressáveis no Prisma)
-- =============================================================================

-- Preço sem regime (regime nulo) também é único por base/item.
DROP INDEX "preco_unico";
CREATE UNIQUE INDEX "preco_unico" ON "preco" ("base_revisao_id", "item_id", "regime_id") NULLS NOT DISTINCT;

-- Staging: campos adicionais exigidos pelos layouts reais.
ALTER TABLE staging.stg_item ADD COLUMN prioridade int NOT NULL DEFAULT 0; -- menor = fonte preferida p/ descrição
ALTER TABLE staging.stg_preco ALTER COLUMN regime_codigo DROP NOT NULL;
ALTER TABLE staging.stg_preco ADD COLUMN atributos jsonb;
ALTER TABLE staging.stg_componente ADD COLUMN percentual_texto text;
ALTER TABLE staging.stg_componente ADD COLUMN percentual numeric(24,10);
ALTER TABLE staging.stg_componente ADD COLUMN situacao text;
ALTER TABLE staging.stg_componente ADD COLUMN componente_descricao text;
ALTER TABLE staging.stg_componente ADD COLUMN componente_unidade text;
CREATE INDEX stg_preco_imp_regime ON staging.stg_preco (importacao_id, regime_codigo);
