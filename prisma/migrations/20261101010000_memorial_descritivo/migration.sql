-- Memorial descritivo da revisão fechada: texto sugerido pelo sistema e editado pelo usuário
CREATE TABLE "memorial_descritivo" (
    "revisao_id" UUID NOT NULL,
    "conteudo" JSONB NOT NULL,
    "atualizado_por_id" UUID,
    "atualizado_em" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "memorial_descritivo_pkey" PRIMARY KEY ("revisao_id")
);
ALTER TABLE "memorial_descritivo" ADD CONSTRAINT "memorial_descritivo_revisao_id_fkey" FOREIGN KEY ("revisao_id") REFERENCES "orcamento_revisao"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "memorial_descritivo" ADD CONSTRAINT "memorial_descritivo_atualizado_por_id_fkey" FOREIGN KEY ("atualizado_por_id") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
