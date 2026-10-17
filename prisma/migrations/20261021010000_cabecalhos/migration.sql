-- Cabeçalhos dos relatórios (timbre: logo + linhas de texto).
CREATE TABLE "cabecalho_relatorio" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "nome" TEXT NOT NULL,
  "linhas" TEXT[] NOT NULL DEFAULT '{}',
  "logo_tipo" TEXT,
  "logo_base64" TEXT,
  "padrao" BOOLEAN NOT NULL DEFAULT false,
  "ativo" BOOLEAN NOT NULL DEFAULT true,
  "criado_em" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "atualizado_em" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "cabecalho_relatorio_pkey" PRIMARY KEY ("id"),
  CONSTRAINT cabecalho_logo_tipo CHECK (logo_tipo IS NULL OR logo_tipo IN ('image/png', 'image/jpeg')),
  CONSTRAINT cabecalho_logo_coerente CHECK ((logo_tipo IS NULL) = (logo_base64 IS NULL)),
  -- até 512 KB de imagem (base64 ≈ 4/3 do tamanho)
  CONSTRAINT cabecalho_logo_tamanho CHECK (logo_base64 IS NULL OR char_length(logo_base64) <= 700000),
  CONSTRAINT cabecalho_linhas_qtd CHECK (coalesce(array_length(linhas, 1), 0) <= 6)
);
CREATE UNIQUE INDEX "cabecalho_relatorio_nome_key" ON "cabecalho_relatorio" (lower("nome"));
-- no máximo um cabeçalho padrão
CREATE UNIQUE INDEX "cabecalho_relatorio_um_padrao" ON "cabecalho_relatorio" ("padrao") WHERE "padrao";

ALTER TABLE "obra" ADD COLUMN "cabecalho_id" UUID;
ALTER TABLE "obra" ADD CONSTRAINT "obra_cabecalho_id_fkey" FOREIGN KEY ("cabecalho_id") REFERENCES "cabecalho_relatorio"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- cabeçalho usado pela revisão, gravado no fechamento
ALTER TABLE "orcamento_revisao" ADD COLUMN "cabecalho_snapshot" JSONB;
