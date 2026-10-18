-- Item do orçamento com preço informado pelo orçamentista (sem item de referência),
-- ex.: serviço importado de outro orçamento que não existe nas bases.
ALTER TABLE "item_orcamento" ALTER COLUMN "item_referencia_id" DROP NOT NULL;
ALTER TABLE "item_orcamento" ADD CONSTRAINT item_orcamento_referencia_ou_informado
  CHECK (item_referencia_id IS NOT NULL OR (origem_preco = 'INFORMADO' AND base_revisao_id IS NULL));
