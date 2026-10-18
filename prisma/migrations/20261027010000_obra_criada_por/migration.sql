-- Quem cadastrou a obra (pode excluí-la enquanto não tiver orçamentos).
ALTER TABLE "obra" ADD COLUMN "criado_por_id" UUID;
ALTER TABLE "obra" ADD CONSTRAINT "obra_criado_por_id_fkey" FOREIGN KEY ("criado_por_id") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- obras existentes: o autor registrado na auditoria
UPDATE "obra" o SET criado_por_id = (
  SELECT a.usuario_id FROM auditoria a WHERE a.acao = 'OBRA_CRIADA' AND a.entidade = 'obra' AND a.entidade_id = o.id::text ORDER BY a.criado_em LIMIT 1);
