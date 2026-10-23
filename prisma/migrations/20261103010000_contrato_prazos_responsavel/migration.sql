-- Prazo de execução (a partir da OS) e prazo contratual (vigência, a partir da assinatura); endereço e responsável técnico
ALTER TABLE "contrato" RENAME COLUMN "prazo_dias" TO "prazo_execucao_dias";
ALTER TABLE "contrato" RENAME CONSTRAINT "contrato_prazo_valido" TO "contrato_prazo_execucao_valido";
ALTER TABLE "contrato" ADD COLUMN "prazo_vigencia_dias" INTEGER,
  ADD COLUMN "endereco" TEXT,
  ADD COLUMN "responsavel_tecnico" TEXT,
  ADD COLUMN "art_rrt" TEXT,
  ADD COLUMN "email_contato" TEXT,
  ADD COLUMN "telefone_contato" TEXT,
  ADD CONSTRAINT "contrato_prazo_vigencia_valido" CHECK ("prazo_vigencia_dias" IS NULL OR "prazo_vigencia_dias" > 0);
