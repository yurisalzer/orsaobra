-- Memória de cálculo do quantitativo (informada pelo orçamentista), por item.
ALTER TABLE "item_orcamento" ADD COLUMN "memoria_quantitativo" TEXT;
ALTER TABLE "item_orcamento" ADD CONSTRAINT item_memoria_quantitativo_tamanho CHECK (char_length(memoria_quantitativo) <= 4000);
