-- Memória de cálculo do que foi medido em cada item (mesma regra da memória do
-- orçamento: cada linha é uma conta, as linhas são somadas).
ALTER TABLE "medicao_item" ADD COLUMN "memoria" TEXT;
ALTER TABLE "medicao_item" ADD CONSTRAINT "medicao_item_memoria_tamanho" CHECK (length("memoria") <= 4000);
