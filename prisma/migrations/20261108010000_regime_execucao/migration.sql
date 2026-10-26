-- Regimes de execução do contrato (Lei 14.133/2021, art. 46) e o tipo de medição de cada um:
-- QUANTIDADE = mede a quantidade executada de cada item; PERCENTUAL = mede o percentual executado.
CREATE TABLE "regime_execucao" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "nome" TEXT NOT NULL,
  "medicao" TEXT NOT NULL,
  -- regimes da lei (não podem ser alterados nem desativados)
  "sistema" BOOLEAN NOT NULL DEFAULT false,
  "ordem" INTEGER NOT NULL DEFAULT 100,
  "ativo" BOOLEAN NOT NULL DEFAULT true,
  "criado_por_id" UUID,
  "criado_em" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "regime_execucao_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "regime_execucao_medicao" CHECK ("medicao" IN ('QUANTIDADE', 'PERCENTUAL')),
  CONSTRAINT "regime_execucao_criado_por_id_fkey" FOREIGN KEY ("criado_por_id") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "regime_execucao_nome_key" ON "regime_execucao" (lower("nome"));

INSERT INTO "regime_execucao" ("nome", "medicao", "sistema", "ordem") VALUES
  ('Empreitada por preço unitário', 'QUANTIDADE', true, 1),
  ('Empreitada por preço global', 'PERCENTUAL', true, 2),
  ('Empreitada integral (Turnkey)', 'PERCENTUAL', true, 3),
  ('Contratação por tarefa', 'PERCENTUAL', true, 4),
  ('Contratação integrada', 'PERCENTUAL', true, 5),
  ('Contratação semi-integrada', 'PERCENTUAL', true, 6),
  ('Fornecimento e prestação de serviço associado', 'PERCENTUAL', true, 7);

ALTER TABLE "contrato" ADD COLUMN "regime_id" UUID;
ALTER TABLE "contrato" ADD CONSTRAINT "contrato_regime_id_fkey" FOREIGN KEY ("regime_id") REFERENCES "regime_execucao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
