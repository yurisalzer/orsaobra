-- Etapa 5 (relatórios)
-- Cópia dos dados da obra e dos perfis de BDI no fechamento da revisão: os
-- relatórios de uma revisão fechada mostram sempre os dados daquela data.
ALTER TABLE "orcamento_revisao" ADD COLUMN "obra_snapshot" JSONB;
ALTER TABLE "orcamento_revisao" ADD COLUMN "bdi_snapshot" JSONB;
-- Cronograma físico-financeiro: número de meses (períodos) da revisão.
ALTER TABLE "orcamento_revisao" ADD COLUMN "cronograma_meses" INTEGER;
ALTER TABLE "orcamento_revisao" ADD CONSTRAINT revisao_cronograma_meses_faixa CHECK (cronograma_meses IS NULL OR (cronograma_meses BETWEEN 1 AND 120));
ALTER TABLE "cronograma_parcela" ADD CONSTRAINT cronograma_periodo_positivo CHECK (periodo >= 1);
