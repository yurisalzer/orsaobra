-- CreateTable
CREATE TABLE "base_item" (
    "base_revisao_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,

    CONSTRAINT "base_item_pkey" PRIMARY KEY ("base_revisao_id","item_id")
);

-- CreateIndex
CREATE INDEX "base_item_item_id_idx" ON "base_item"("item_id");

-- AddForeignKey
ALTER TABLE "base_item" ADD CONSTRAINT "base_item_base_revisao_id_fkey" FOREIGN KEY ("base_revisao_id") REFERENCES "base_revisao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "base_item" ADD CONSTRAINT "base_item_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "item_referencia"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Bases publicadas são imutáveis também quanto aos itens que contêm.
CREATE TRIGGER base_item_imutavel BEFORE INSERT OR UPDATE OR DELETE ON base_item
  FOR EACH ROW EXECUTE FUNCTION trg_base_imutavel();

-- Preenchimento para as bases já importadas: itens vistos pela primeira vez
-- na revisão + itens com preço, analítica ou usados como componente nela.
-- (Em revisões publicadas o gatilho bloquearia a inserção: é desativado só aqui.)
ALTER TABLE base_item DISABLE TRIGGER base_item_imutavel;
INSERT INTO base_item (base_revisao_id, item_id)
SELECT primeira_base_revisao_id, item_id FROM item_versao WHERE primeira_base_revisao_id IS NOT NULL
UNION SELECT base_revisao_id, item_id FROM preco
UNION SELECT base_revisao_id, item_id FROM base_composicao
UNION SELECT bc.base_revisao_id, cc.componente_item_id FROM composicao_componente cc JOIN base_composicao bc ON bc.composicao_versao_id = cc.composicao_versao_id
ON CONFLICT DO NOTHING;
ALTER TABLE base_item ENABLE TRIGGER base_item_imutavel;
