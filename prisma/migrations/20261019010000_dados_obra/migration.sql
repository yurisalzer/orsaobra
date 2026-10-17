-- Dados cadastrais da obra: código, processo, descrição e órgão solicitante.
ALTER TABLE "obra" RENAME COLUMN "cliente" TO "orgao_solicitante";
ALTER TABLE "obra" ADD COLUMN "codigo" TEXT;
ALTER TABLE "obra" ADD COLUMN "processo" TEXT;
ALTER TABLE "obra" ADD COLUMN "descricao" TEXT;
ALTER TABLE "obra" ADD CONSTRAINT obra_descricao_tamanho CHECK (char_length(descricao) <= 4000);
