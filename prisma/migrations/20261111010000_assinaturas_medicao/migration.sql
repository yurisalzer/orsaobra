-- Assinaturas dos documentos de medição (boletim e cronograma de desembolso):
-- 2 ou 3 fiscais e o bloco da empresa (nome, CNPJ, responsável técnico e registro).
ALTER TABLE "contrato" ADD COLUMN "assinaturas_medicao" JSONB;
