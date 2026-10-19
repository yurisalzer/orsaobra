-- Versão de um orçamento em outro regime (com/sem desoneração), para comparação.
ALTER TABLE "orcamento" ADD COLUMN "versao_de_id" UUID;
ALTER TABLE "orcamento" ADD COLUMN "regime_versao" TEXT;
ALTER TABLE "orcamento" ADD CONSTRAINT "orcamento_versao_de_id_fkey" FOREIGN KEY ("versao_de_id") REFERENCES "orcamento"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "orcamento_versao_de_idx" ON "orcamento" ("versao_de_id");
