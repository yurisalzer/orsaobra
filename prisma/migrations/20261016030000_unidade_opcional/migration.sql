-- Unidade pode não ser publicada pela fonte (ex.: 6 elementares do REUT da EMOP 09/2026).
-- Nesses casos o campo fica nulo: o sistema nunca presume unidades.
ALTER TABLE "item_versao" ALTER COLUMN "unidade" DROP NOT NULL;
