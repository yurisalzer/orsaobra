-- Cronograma de desembolso do contrato: percentual PREVISTO de cada etapa
-- principal (grupo raiz da planilha contratual) em cada período de medição.
-- O realizado vem das medições fechadas; o previsto vale para os períodos seguintes.
CREATE TABLE "cronograma_desembolso" (
  "contrato_id" UUID NOT NULL,
  "grupo_id" UUID NOT NULL,
  "periodo" INTEGER NOT NULL,
  "percentual" DECIMAL(9,4) NOT NULL,
  CONSTRAINT "cronograma_desembolso_pkey" PRIMARY KEY ("grupo_id", "periodo"),
  CONSTRAINT "cronograma_desembolso_valores" CHECK ("periodo" >= 1 AND "percentual" BETWEEN 0 AND 100),
  CONSTRAINT "cronograma_desembolso_contrato_id_fkey" FOREIGN KEY ("contrato_id") REFERENCES "contrato"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "cronograma_desembolso_grupo_id_fkey" FOREIGN KEY ("grupo_id") REFERENCES "contrato_grupo"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "cronograma_desembolso_contrato_idx" ON "cronograma_desembolso" ("contrato_id");
