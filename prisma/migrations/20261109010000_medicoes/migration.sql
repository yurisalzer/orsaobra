-- Medições do contrato: planejamento dos períodos e lançamento por item.

-- serviço contínuo (contrato anual): medições mensais "dia a dia" (10/10 a 09/11)
ALTER TABLE "contrato" ADD COLUMN "servico_continuo" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "medicao" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "contrato_id" UUID NOT NULL,
  "numero" INTEGER NOT NULL,
  "inicio" DATE NOT NULL,
  "fim" DATE NOT NULL,
  -- PREVISTA: só planejada; EM_ELABORACAO: lançando; FECHADA: encerrada (imutável)
  "situacao" TEXT NOT NULL DEFAULT 'PREVISTA',
  "versao" INTEGER NOT NULL DEFAULT 1,
  "observacao" TEXT,
  "fechada_em" TIMESTAMPTZ,
  "fechada_por_id" UUID,
  "criado_em" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "atualizado_em" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "medicao_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "medicao_situacao" CHECK ("situacao" IN ('PREVISTA', 'EM_ELABORACAO', 'FECHADA')),
  CONSTRAINT "medicao_periodo" CHECK ("fim" >= "inicio"),
  CONSTRAINT "medicao_contrato_id_fkey" FOREIGN KEY ("contrato_id") REFERENCES "contrato"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "medicao_fechada_por_id_fkey" FOREIGN KEY ("fechada_por_id") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "medicao_contrato_numero_key" ON "medicao" ("contrato_id", "numero");

CREATE TABLE "medicao_item" (
  "medicao_id" UUID NOT NULL,
  "contrato_item_id" UUID NOT NULL,
  -- preço unitário: quantidade medida; demais regimes: percentual do item (0–100)
  "quantidade" DECIMAL(18,4),
  "percentual" DECIMAL(9,4),
  "valor" DECIMAL(18,2) NOT NULL,
  CONSTRAINT "medicao_item_pkey" PRIMARY KEY ("medicao_id", "contrato_item_id"),
  CONSTRAINT "medicao_item_um_criterio" CHECK (("quantidade" IS NULL) <> ("percentual" IS NULL)),
  CONSTRAINT "medicao_item_valores" CHECK (coalesce("quantidade", 0) >= 0 AND coalesce("percentual", 0) BETWEEN 0 AND 100 AND "valor" >= 0),
  CONSTRAINT "medicao_item_medicao_id_fkey" FOREIGN KEY ("medicao_id") REFERENCES "medicao"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "medicao_item_contrato_item_id_fkey" FOREIGN KEY ("contrato_item_id") REFERENCES "contrato_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "medicao_item_contrato_item_idx" ON "medicao_item" ("contrato_item_id");

-- medição fechada não muda (nem os itens) — reabrir usa a liberação explícita
CREATE OR REPLACE FUNCTION trg_medicao_fechada() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  mid UUID;
BEGIN
  IF current_setting('medicao.liberar_fechada', true) = 'on' THEN RETURN COALESCE(NEW, OLD); END IF;
  IF TG_TABLE_NAME = 'medicao' THEN
    IF OLD.situacao = 'FECHADA' THEN RAISE EXCEPTION 'Medição fechada não pode ser alterada' USING ERRCODE = 'check_violation'; END IF;
    RETURN COALESCE(NEW, OLD);
  END IF;
  mid := COALESCE(NEW.medicao_id, OLD.medicao_id);
  IF EXISTS (SELECT 1 FROM medicao WHERE id = mid AND situacao = 'FECHADA') THEN
    RAISE EXCEPTION 'Medição fechada não pode ser alterada' USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER medicao_fechada BEFORE UPDATE OR DELETE ON medicao FOR EACH ROW EXECUTE FUNCTION trg_medicao_fechada();
CREATE TRIGGER medicao_item_fechada BEFORE INSERT OR UPDATE OR DELETE ON medicao_item FOR EACH ROW EXECUTE FUNCTION trg_medicao_fechada();
