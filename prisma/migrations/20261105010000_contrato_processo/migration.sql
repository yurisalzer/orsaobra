-- Número do processo administrativo do contrato (os existentes herdam o da obra)
ALTER TABLE "contrato" ADD COLUMN "processo" TEXT;
UPDATE "contrato" c SET "processo" = o.processo FROM "obra" o WHERE o.id = c.obra_id AND o.processo IS NOT NULL;
