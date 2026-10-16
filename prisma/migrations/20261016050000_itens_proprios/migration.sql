-- CreateTable
CREATE TABLE "item_proprio" (
    "item_id" UUID NOT NULL,
    "item_versao_id" UUID NOT NULL,
    "composicao_versao_id" UUID,
    "versao" INTEGER NOT NULL DEFAULT 1,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criado_por_id" UUID,
    "atualizado_em" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "item_proprio_pkey" PRIMARY KEY ("item_id")
);

-- AddForeignKey
ALTER TABLE "item_proprio" ADD CONSTRAINT "item_proprio_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "item_referencia"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_proprio" ADD CONSTRAINT "item_proprio_item_versao_id_fkey" FOREIGN KEY ("item_versao_id") REFERENCES "item_versao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_proprio" ADD CONSTRAINT "item_proprio_composicao_versao_id_fkey" FOREIGN KEY ("composicao_versao_id") REFERENCES "composicao_versao"("id") ON DELETE SET NULL ON UPDATE CASCADE;

