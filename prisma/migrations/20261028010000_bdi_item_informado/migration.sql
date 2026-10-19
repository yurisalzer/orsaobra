-- BDI do item digitado pelo orçamentista (inclusive 0%), em vez do global ou de um perfil.
ALTER TABLE "item_orcamento" ADD COLUMN "bdi_informado" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "item_orcamento" ADD CONSTRAINT item_orcamento_bdi_informado_sem_perfil CHECK (NOT (bdi_informado AND bdi_perfil_id IS NOT NULL));
