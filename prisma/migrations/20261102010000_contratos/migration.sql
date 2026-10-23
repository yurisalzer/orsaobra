-- Módulo de medições — fase 1: contrato e planilha contratual.

-- Permissões do módulo (quem já vê/edita orçamentos recebe o equivalente; o administrador ajusta depois)
ALTER TABLE "usuario_permissao" DROP CONSTRAINT usuario_permissao_valida;
ALTER TABLE "usuario_permissao" ADD CONSTRAINT usuario_permissao_valida CHECK (permissao IN
  ('CONSULTA', 'ORCAMENTOS_VER', 'ORCAMENTOS_EDITAR', 'RELATORIOS', 'COMPOSICOES', 'BDI', 'CABECALHOS', 'IMPORTACAO', 'USUARIOS', 'MEDICOES_VER', 'MEDICOES_EDITAR'));
INSERT INTO usuario_permissao (usuario_id, permissao)
  SELECT usuario_id, 'MEDICOES_VER' FROM usuario_permissao WHERE permissao = 'ORCAMENTOS_VER' ON CONFLICT DO NOTHING;
INSERT INTO usuario_permissao (usuario_id, permissao)
  SELECT usuario_id, 'MEDICOES_EDITAR' FROM usuario_permissao WHERE permissao = 'ORCAMENTOS_EDITAR' ON CONFLICT DO NOTHING;

CREATE TABLE "contrato" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "obra_id" UUID NOT NULL,
  "numero" TEXT NOT NULL,
  "objeto" TEXT NOT NULL,
  "empresa" TEXT,
  "cnpj" TEXT,
  "data_assinatura" DATE,
  "data_os" DATE,
  "prazo_dias" INTEGER,
  -- ORCAMENTO: gerado de uma revisão do orçamento; PLANILHA: importado da proposta vencedora
  "origem" TEXT NOT NULL,
  "revisao_id" UUID,
  "arquivo_origem" TEXT,
  "referencia" TEXT,
  "bdi_percentual" DECIMAL(9,4),
  -- arredondamento do valor total dos itens (quantidade × preço contratado)
  "arredondamento" TEXT NOT NULL DEFAULT 'ARREDONDAR',
  -- EM_CADASTRO: planilha editável; VIGENTE: planilha contratual travada (medições, aditivos e reajustes partem dela)
  "situacao" TEXT NOT NULL DEFAULT 'EM_CADASTRO',
  "versao" INTEGER NOT NULL DEFAULT 1,
  "criado_por_id" UUID,
  "criado_em" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "atualizado_em" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "confirmado_em" TIMESTAMPTZ,
  "confirmado_por_id" UUID,
  CONSTRAINT "contrato_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "contrato_origem_valida" CHECK ("origem" IN ('ORCAMENTO', 'PLANILHA')),
  CONSTRAINT "contrato_situacao_valida" CHECK ("situacao" IN ('EM_CADASTRO', 'VIGENTE')),
  CONSTRAINT "contrato_arredondamento_valido" CHECK ("arredondamento" IN ('ARREDONDAR', 'TRUNCAR')),
  CONSTRAINT "contrato_prazo_valido" CHECK ("prazo_dias" IS NULL OR "prazo_dias" > 0),
  CONSTRAINT "contrato_obra_id_fkey" FOREIGN KEY ("obra_id") REFERENCES "obra"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "contrato_revisao_id_fkey" FOREIGN KEY ("revisao_id") REFERENCES "orcamento_revisao"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "contrato_criado_por_id_fkey" FOREIGN KEY ("criado_por_id") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "contrato_confirmado_por_id_fkey" FOREIGN KEY ("confirmado_por_id") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "contrato_numero_key" ON "contrato" (lower("numero"));
CREATE INDEX "contrato_obra_idx" ON "contrato" ("obra_id");

CREATE TABLE "contrato_grupo" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "contrato_id" UUID NOT NULL,
  "pai_id" UUID,
  "ordem" INTEGER NOT NULL,
  "titulo" TEXT NOT NULL,
  CONSTRAINT "contrato_grupo_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "contrato_grupo_contrato_id_fkey" FOREIGN KEY ("contrato_id") REFERENCES "contrato"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "contrato_grupo_pai_id_fkey" FOREIGN KEY ("pai_id") REFERENCES "contrato_grupo"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "contrato_grupo_contrato_idx" ON "contrato_grupo" ("contrato_id");

CREATE TABLE "contrato_item" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "contrato_id" UUID NOT NULL,
  "grupo_id" UUID NOT NULL,
  "ordem" INTEGER NOT NULL,
  -- numeração do item na planilha de origem (ex.: "1.2" ou "37")
  "numero" TEXT,
  "codigo" TEXT,
  "fonte" TEXT,
  "descricao" TEXT NOT NULL,
  "unidade" TEXT,
  "quantidade" DECIMAL(18,4) NOT NULL,
  -- preço unitário contratado (com BDI)
  "preco_unitario" DECIMAL(18,4) NOT NULL,
  "valor_total" DECIMAL(18,2) NOT NULL,
  -- características do orçamento de origem (referência)
  "item_orcamento_id" UUID,
  "item_referencia_id" UUID,
  "preco_orcado" DECIMAL(18,4),
  "custo_unitario" DECIMAL(18,4),
  "bdi_percentual" DECIMAL(9,4),
  "base_rotulo" TEXT,
  "regime" TEXT,
  "referencia_preco" TEXT,
  "memoria_quantitativo" TEXT,
  "memoria_calculo" TEXT,
  -- valor total lido do arquivo (proposta), quando havia a coluna
  "valor_total_arquivo" DECIMAL(18,2),
  CONSTRAINT "contrato_item_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "contrato_item_valores" CHECK ("quantidade" >= 0 AND "preco_unitario" >= 0 AND "valor_total" >= 0),
  CONSTRAINT "contrato_item_contrato_id_fkey" FOREIGN KEY ("contrato_id") REFERENCES "contrato"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "contrato_item_grupo_id_fkey" FOREIGN KEY ("grupo_id") REFERENCES "contrato_grupo"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "contrato_item_item_referencia_id_fkey" FOREIGN KEY ("item_referencia_id") REFERENCES "item_referencia"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "contrato_item_contrato_idx" ON "contrato_item" ("contrato_id", "ordem");

-- Planilha contratual vigente não muda por edição direta (só por aditivo, em fase futura).
CREATE OR REPLACE FUNCTION trg_contrato_vigente_planilha() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  cid UUID := COALESCE(NEW.contrato_id, OLD.contrato_id);
BEGIN
  IF current_setting('contrato.liberar_vigente', true) = 'on' THEN RETURN COALESCE(NEW, OLD); END IF;
  IF EXISTS (SELECT 1 FROM contrato WHERE id = cid AND situacao = 'VIGENTE') THEN
    RAISE EXCEPTION 'Planilha de contrato vigente não pode ser alterada' USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER contrato_item_vigente BEFORE INSERT OR UPDATE OR DELETE ON contrato_item
  FOR EACH ROW EXECUTE FUNCTION trg_contrato_vigente_planilha();
CREATE TRIGGER contrato_grupo_vigente BEFORE INSERT OR UPDATE OR DELETE ON contrato_grupo
  FOR EACH ROW EXECUTE FUNCTION trg_contrato_vigente_planilha();
