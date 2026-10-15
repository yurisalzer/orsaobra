-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "unaccent";

-- CreateEnum
CREATE TYPE "Papel" AS ENUM ('ADMIN', 'ORCAMENTISTA', 'LEITOR');

-- CreateEnum
CREATE TYPE "StatusBase" AS ENUM ('EM_IMPORTACAO', 'VALIDADA', 'PUBLICADA', 'SUBSTITUIDA', 'DESCARTADA');

-- CreateEnum
CREATE TYPE "StatusImportacao" AS ENUM ('RECEBIDA', 'ANALISADA', 'COM_ERROS', 'VALIDADA', 'CONFIRMADA', 'FALHOU', 'CANCELADA');

-- CreateEnum
CREATE TYPE "Severidade" AS ENUM ('ERRO', 'AVISO', 'INFO');

-- CreateEnum
CREATE TYPE "TipoItem" AS ENUM ('INSUMO', 'COMPOSICAO');

-- CreateEnum
CREATE TYPE "OrigemComposicao" AS ENUM ('OFICIAL', 'PROPRIA');

-- CreateEnum
CREATE TYPE "TipoParcelaBdi" AS ENUM ('AC', 'S', 'R', 'G', 'DF', 'L', 'I');

-- CreateEnum
CREATE TYPE "StatusRevisao" AS ENUM ('EM_ELABORACAO', 'FECHADA');

-- CreateEnum
CREATE TYPE "Arredondamento" AS ENUM ('ARREDONDAR', 'TRUNCAR');

-- CreateTable
CREATE TABLE "usuario" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "senha_hash" TEXT NOT NULL,
    "papel" "Papel" NOT NULL DEFAULT 'LEITOR',
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "bloqueado_ate" TIMESTAMPTZ,
    "criado_em" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "usuario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessao" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "usuario_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expira_em" TIMESTAMPTZ NOT NULL,
    "criado_em" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,
    "user_agent" TEXT,

    CONSTRAINT "sessao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auditoria" (
    "id" BIGSERIAL NOT NULL,
    "usuario_id" UUID,
    "acao" TEXT NOT NULL,
    "entidade" TEXT NOT NULL,
    "entidade_id" TEXT,
    "antes" JSONB,
    "depois" JSONB,
    "ip" TEXT,
    "criado_em" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auditoria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fonte" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "codigo" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "oficial" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "fonte_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "regime" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "fonte_id" UUID NOT NULL,
    "codigo" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,

    CONSTRAINT "regime_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "base_mensal" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "fonte_id" UUID NOT NULL,
    "uf" CHAR(2) NOT NULL,
    "competencia" DATE NOT NULL,
    "criado_em" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "base_mensal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "base_revisao" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "base_id" UUID NOT NULL,
    "numero" INTEGER NOT NULL,
    "status" "StatusBase" NOT NULL DEFAULT 'EM_IMPORTACAO',
    "motivo" TEXT,
    "validada_em" TIMESTAMPTZ,
    "publicada_em" TIMESTAMPTZ,
    "criado_em" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "base_revisao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "importacao" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "base_revisao_id" UUID NOT NULL,
    "regime_id" UUID,
    "usuario_id" UUID NOT NULL,
    "adaptador" TEXT NOT NULL,
    "adaptador_versao" TEXT NOT NULL,
    "status" "StatusImportacao" NOT NULL DEFAULT 'RECEBIDA',
    "duplicidade_autorizada" BOOLEAN NOT NULL DEFAULT false,
    "resumo" JSONB,
    "erro" TEXT,
    "iniciada_em" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "concluida_em" TIMESTAMPTZ,

    CONSTRAINT "importacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "arquivo_importacao" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "importacao_id" UUID NOT NULL,
    "nome_original" TEXT NOT NULL,
    "tamanho_bytes" BIGINT NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "tipo_mime" TEXT,
    "layout" TEXT,
    "armazenamento" TEXT,

    CONSTRAINT "arquivo_importacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verificacao_importacao" (
    "id" BIGSERIAL NOT NULL,
    "importacao_id" UUID NOT NULL,
    "regra" TEXT NOT NULL,
    "severidade" "Severidade" NOT NULL,
    "mensagem" TEXT NOT NULL,
    "arquivo" TEXT,
    "planilha" TEXT,
    "linha" INTEGER,
    "campo" TEXT,
    "valor" TEXT,

    CONSTRAINT "verificacao_importacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item_referencia" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "fonte_id" UUID NOT NULL,
    "tipo" "TipoItem" NOT NULL,
    "codigo" TEXT NOT NULL,
    "criado_em" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "item_referencia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item_versao" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "item_id" UUID NOT NULL,
    "descricao" TEXT NOT NULL,
    "unidade" TEXT NOT NULL,
    "grupo" TEXT,
    "atributos" JSONB,
    "hash" CHAR(64) NOT NULL,
    "primeira_base_revisao_id" UUID,

    CONSTRAINT "item_versao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "preco" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "base_revisao_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "item_versao_id" UUID NOT NULL,
    "regime_id" UUID NOT NULL,
    "valor" DECIMAL(18,4) NOT NULL,
    "origem_preco" TEXT,
    "observacao" TEXT,

    CONSTRAINT "preco_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "preco_proprio" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "item_id" UUID NOT NULL,
    "data_referencia" DATE NOT NULL,
    "valor" DECIMAL(18,4) NOT NULL,
    "fonte_cotacao" TEXT,
    "observacao" TEXT,

    CONSTRAINT "preco_proprio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "composicao_versao" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "item_id" UUID NOT NULL,
    "origem" "OrigemComposicao" NOT NULL,
    "hash" CHAR(64) NOT NULL,
    "observacao" TEXT,
    "criado_em" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "composicao_versao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "composicao_componente" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "composicao_versao_id" UUID NOT NULL,
    "componente_item_id" UUID NOT NULL,
    "coeficiente" DECIMAL(24,10) NOT NULL,
    "ordem" INTEGER NOT NULL,
    "tipo_original" TEXT,

    CONSTRAINT "composicao_componente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "base_composicao" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "base_revisao_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "regime_id" UUID,
    "composicao_versao_id" UUID NOT NULL,

    CONSTRAINT "base_composicao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bdi_perfil" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criado_em" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bdi_perfil_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bdi_parcela" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "perfil_id" UUID NOT NULL,
    "tipo" "TipoParcelaBdi" NOT NULL,
    "nome" TEXT NOT NULL,
    "percentual" DECIMAL(9,6) NOT NULL,
    "ordem" INTEGER NOT NULL,

    CONSTRAINT "bdi_parcela_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "obra" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "nome" TEXT NOT NULL,
    "cliente" TEXT,
    "endereco" TEXT,
    "municipio" TEXT,
    "uf" CHAR(2) NOT NULL DEFAULT 'RJ',
    "criado_em" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "obra_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "obra_membro" (
    "obra_id" UUID NOT NULL,
    "usuario_id" UUID NOT NULL,
    "papel" "Papel" NOT NULL,

    CONSTRAINT "obra_membro_pkey" PRIMARY KEY ("obra_id","usuario_id")
);

-- CreateTable
CREATE TABLE "orcamento" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "obra_id" UUID NOT NULL,
    "codigo" TEXT,
    "titulo" TEXT NOT NULL,
    "criado_em" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "orcamento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orcamento_revisao" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "orcamento_id" UUID NOT NULL,
    "numero" INTEGER NOT NULL,
    "descricao" TEXT,
    "status" "StatusRevisao" NOT NULL DEFAULT 'EM_ELABORACAO',
    "versao" INTEGER NOT NULL DEFAULT 1,
    "bdi_perfil_id" UUID,
    "bdi_percentual" DECIMAL(9,6),
    "arredondamento" "Arredondamento" NOT NULL DEFAULT 'ARREDONDAR',
    "revisao_origem_id" UUID,
    "fechada_em" TIMESTAMPTZ,
    "fechada_por_id" UUID,
    "total_custo_direto" DECIMAL(18,2),
    "total_geral" DECIMAL(18,2),
    "criado_em" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "orcamento_revisao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "revisao_base_padrao" (
    "revisao_id" UUID NOT NULL,
    "base_revisao_id" UUID NOT NULL,
    "regime_id" UUID NOT NULL,

    CONSTRAINT "revisao_base_padrao_pkey" PRIMARY KEY ("revisao_id","base_revisao_id")
);

-- CreateTable
CREATE TABLE "etapa" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "revisao_id" UUID NOT NULL,
    "pai_id" UUID,
    "ordem" INTEGER NOT NULL,
    "titulo" TEXT NOT NULL,

    CONSTRAINT "etapa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item_orcamento" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "revisao_id" UUID NOT NULL,
    "etapa_id" UUID NOT NULL,
    "ordem" INTEGER NOT NULL,
    "item_referencia_id" UUID NOT NULL,
    "base_revisao_id" UUID,
    "regime_id" UUID,
    "codigo" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "unidade" TEXT NOT NULL,
    "quantidade" DECIMAL(18,4) NOT NULL,
    "custo_unitario" DECIMAL(18,4) NOT NULL,
    "bdi_perfil_id" UUID,
    "bdi_percentual" DECIMAL(9,6) NOT NULL,
    "preco_unitario" DECIMAL(18,2) NOT NULL,
    "preco_total" DECIMAL(18,2) NOT NULL,
    "memoria_calculo" TEXT,
    "analitico" JSONB,

    CONSTRAINT "item_orcamento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cronograma_parcela" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "revisao_id" UUID NOT NULL,
    "etapa_id" UUID NOT NULL,
    "periodo" INTEGER NOT NULL,
    "percentual" DECIMAL(9,6) NOT NULL,

    CONSTRAINT "cronograma_parcela_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "usuario_email_key" ON "usuario"("email");

-- CreateIndex
CREATE UNIQUE INDEX "sessao_token_hash_key" ON "sessao"("token_hash");

-- CreateIndex
CREATE INDEX "sessao_usuario_id_idx" ON "sessao"("usuario_id");

-- CreateIndex
CREATE INDEX "auditoria_entidade_entidade_id_idx" ON "auditoria"("entidade", "entidade_id");

-- CreateIndex
CREATE INDEX "auditoria_usuario_id_criado_em_idx" ON "auditoria"("usuario_id", "criado_em");

-- CreateIndex
CREATE UNIQUE INDEX "fonte_codigo_key" ON "fonte"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "regime_fonte_id_codigo_key" ON "regime"("fonte_id", "codigo");

-- CreateIndex
CREATE INDEX "base_mensal_competencia_idx" ON "base_mensal"("competencia");

-- CreateIndex
CREATE UNIQUE INDEX "base_mensal_fonte_id_uf_competencia_key" ON "base_mensal"("fonte_id", "uf", "competencia");

-- CreateIndex
CREATE INDEX "base_revisao_status_idx" ON "base_revisao"("status");

-- CreateIndex
CREATE UNIQUE INDEX "base_revisao_base_id_numero_key" ON "base_revisao"("base_id", "numero");

-- CreateIndex
CREATE INDEX "importacao_base_revisao_id_idx" ON "importacao"("base_revisao_id");

-- CreateIndex
CREATE INDEX "importacao_status_idx" ON "importacao"("status");

-- CreateIndex
CREATE INDEX "arquivo_importacao_sha256_idx" ON "arquivo_importacao"("sha256");

-- CreateIndex
CREATE INDEX "verificacao_importacao_importacao_id_severidade_idx" ON "verificacao_importacao"("importacao_id", "severidade");

-- CreateIndex
CREATE INDEX "item_referencia_codigo_idx" ON "item_referencia"("codigo");

-- CreateIndex
CREATE INDEX "item_referencia_codigo_trgm" ON "item_referencia" USING GIN ("codigo" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "item_referencia_fonte_id_tipo_codigo_key" ON "item_referencia"("fonte_id", "tipo", "codigo");

-- CreateIndex
CREATE UNIQUE INDEX "item_versao_item_id_hash_key" ON "item_versao"("item_id", "hash");

-- CreateIndex
CREATE INDEX "preco_item_id_regime_id_idx" ON "preco"("item_id", "regime_id");

-- CreateIndex
CREATE INDEX "preco_base_regime" ON "preco"("base_revisao_id", "regime_id");

-- CreateIndex
CREATE UNIQUE INDEX "preco_base_revisao_id_item_id_regime_id_key" ON "preco"("base_revisao_id", "item_id", "regime_id");

-- CreateIndex
CREATE UNIQUE INDEX "preco_proprio_item_id_data_referencia_key" ON "preco_proprio"("item_id", "data_referencia");

-- CreateIndex
CREATE UNIQUE INDEX "composicao_versao_item_id_hash_key" ON "composicao_versao"("item_id", "hash");

-- CreateIndex
CREATE INDEX "composicao_componente_componente_item_id_idx" ON "composicao_componente"("componente_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "composicao_componente_composicao_versao_id_ordem_key" ON "composicao_componente"("composicao_versao_id", "ordem");

-- CreateIndex
CREATE UNIQUE INDEX "base_composicao_unica" ON "base_composicao"("base_revisao_id", "item_id", "regime_id");

-- CreateIndex
CREATE UNIQUE INDEX "bdi_perfil_nome_key" ON "bdi_perfil"("nome");

-- CreateIndex
CREATE UNIQUE INDEX "bdi_parcela_perfil_id_ordem_key" ON "bdi_parcela"("perfil_id", "ordem");

-- CreateIndex
CREATE INDEX "orcamento_obra_id_idx" ON "orcamento"("obra_id");

-- CreateIndex
CREATE UNIQUE INDEX "orcamento_revisao_orcamento_id_numero_key" ON "orcamento_revisao"("orcamento_id", "numero");

-- CreateIndex
CREATE INDEX "etapa_revisao_id_pai_id_ordem_idx" ON "etapa"("revisao_id", "pai_id", "ordem");

-- CreateIndex
CREATE INDEX "item_orcamento_revisao_id_etapa_id_ordem_idx" ON "item_orcamento"("revisao_id", "etapa_id", "ordem");

-- CreateIndex
CREATE UNIQUE INDEX "cronograma_parcela_etapa_id_periodo_key" ON "cronograma_parcela"("etapa_id", "periodo");

-- AddForeignKey
ALTER TABLE "sessao" ADD CONSTRAINT "sessao_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auditoria" ADD CONSTRAINT "auditoria_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "regime" ADD CONSTRAINT "regime_fonte_id_fkey" FOREIGN KEY ("fonte_id") REFERENCES "fonte"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "base_mensal" ADD CONSTRAINT "base_mensal_fonte_id_fkey" FOREIGN KEY ("fonte_id") REFERENCES "fonte"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "base_revisao" ADD CONSTRAINT "base_revisao_base_id_fkey" FOREIGN KEY ("base_id") REFERENCES "base_mensal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "importacao" ADD CONSTRAINT "importacao_base_revisao_id_fkey" FOREIGN KEY ("base_revisao_id") REFERENCES "base_revisao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "importacao" ADD CONSTRAINT "importacao_regime_id_fkey" FOREIGN KEY ("regime_id") REFERENCES "regime"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "importacao" ADD CONSTRAINT "importacao_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "arquivo_importacao" ADD CONSTRAINT "arquivo_importacao_importacao_id_fkey" FOREIGN KEY ("importacao_id") REFERENCES "importacao"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verificacao_importacao" ADD CONSTRAINT "verificacao_importacao_importacao_id_fkey" FOREIGN KEY ("importacao_id") REFERENCES "importacao"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_referencia" ADD CONSTRAINT "item_referencia_fonte_id_fkey" FOREIGN KEY ("fonte_id") REFERENCES "fonte"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_versao" ADD CONSTRAINT "item_versao_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "item_referencia"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_versao" ADD CONSTRAINT "item_versao_primeira_base_revisao_id_fkey" FOREIGN KEY ("primeira_base_revisao_id") REFERENCES "base_revisao"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "preco" ADD CONSTRAINT "preco_base_revisao_id_fkey" FOREIGN KEY ("base_revisao_id") REFERENCES "base_revisao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "preco" ADD CONSTRAINT "preco_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "item_referencia"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "preco" ADD CONSTRAINT "preco_item_versao_id_fkey" FOREIGN KEY ("item_versao_id") REFERENCES "item_versao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "preco" ADD CONSTRAINT "preco_regime_id_fkey" FOREIGN KEY ("regime_id") REFERENCES "regime"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "preco_proprio" ADD CONSTRAINT "preco_proprio_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "item_referencia"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "composicao_versao" ADD CONSTRAINT "composicao_versao_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "item_referencia"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "composicao_componente" ADD CONSTRAINT "composicao_componente_composicao_versao_id_fkey" FOREIGN KEY ("composicao_versao_id") REFERENCES "composicao_versao"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "composicao_componente" ADD CONSTRAINT "composicao_componente_componente_item_id_fkey" FOREIGN KEY ("componente_item_id") REFERENCES "item_referencia"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "base_composicao" ADD CONSTRAINT "base_composicao_base_revisao_id_fkey" FOREIGN KEY ("base_revisao_id") REFERENCES "base_revisao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "base_composicao" ADD CONSTRAINT "base_composicao_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "item_referencia"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "base_composicao" ADD CONSTRAINT "base_composicao_regime_id_fkey" FOREIGN KEY ("regime_id") REFERENCES "regime"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "base_composicao" ADD CONSTRAINT "base_composicao_composicao_versao_id_fkey" FOREIGN KEY ("composicao_versao_id") REFERENCES "composicao_versao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bdi_parcela" ADD CONSTRAINT "bdi_parcela_perfil_id_fkey" FOREIGN KEY ("perfil_id") REFERENCES "bdi_perfil"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "obra_membro" ADD CONSTRAINT "obra_membro_obra_id_fkey" FOREIGN KEY ("obra_id") REFERENCES "obra"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "obra_membro" ADD CONSTRAINT "obra_membro_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orcamento" ADD CONSTRAINT "orcamento_obra_id_fkey" FOREIGN KEY ("obra_id") REFERENCES "obra"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orcamento_revisao" ADD CONSTRAINT "orcamento_revisao_orcamento_id_fkey" FOREIGN KEY ("orcamento_id") REFERENCES "orcamento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orcamento_revisao" ADD CONSTRAINT "orcamento_revisao_bdi_perfil_id_fkey" FOREIGN KEY ("bdi_perfil_id") REFERENCES "bdi_perfil"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orcamento_revisao" ADD CONSTRAINT "orcamento_revisao_revisao_origem_id_fkey" FOREIGN KEY ("revisao_origem_id") REFERENCES "orcamento_revisao"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orcamento_revisao" ADD CONSTRAINT "orcamento_revisao_fechada_por_id_fkey" FOREIGN KEY ("fechada_por_id") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "revisao_base_padrao" ADD CONSTRAINT "revisao_base_padrao_revisao_id_fkey" FOREIGN KEY ("revisao_id") REFERENCES "orcamento_revisao"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "revisao_base_padrao" ADD CONSTRAINT "revisao_base_padrao_base_revisao_id_fkey" FOREIGN KEY ("base_revisao_id") REFERENCES "base_revisao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "revisao_base_padrao" ADD CONSTRAINT "revisao_base_padrao_regime_id_fkey" FOREIGN KEY ("regime_id") REFERENCES "regime"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "etapa" ADD CONSTRAINT "etapa_revisao_id_fkey" FOREIGN KEY ("revisao_id") REFERENCES "orcamento_revisao"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "etapa" ADD CONSTRAINT "etapa_pai_id_fkey" FOREIGN KEY ("pai_id") REFERENCES "etapa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_orcamento" ADD CONSTRAINT "item_orcamento_revisao_id_fkey" FOREIGN KEY ("revisao_id") REFERENCES "orcamento_revisao"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_orcamento" ADD CONSTRAINT "item_orcamento_etapa_id_fkey" FOREIGN KEY ("etapa_id") REFERENCES "etapa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_orcamento" ADD CONSTRAINT "item_orcamento_item_referencia_id_fkey" FOREIGN KEY ("item_referencia_id") REFERENCES "item_referencia"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_orcamento" ADD CONSTRAINT "item_orcamento_base_revisao_id_fkey" FOREIGN KEY ("base_revisao_id") REFERENCES "base_revisao"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_orcamento" ADD CONSTRAINT "item_orcamento_regime_id_fkey" FOREIGN KEY ("regime_id") REFERENCES "regime"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_orcamento" ADD CONSTRAINT "item_orcamento_bdi_perfil_id_fkey" FOREIGN KEY ("bdi_perfil_id") REFERENCES "bdi_perfil"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cronograma_parcela" ADD CONSTRAINT "cronograma_parcela_revisao_id_fkey" FOREIGN KEY ("revisao_id") REFERENCES "orcamento_revisao"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cronograma_parcela" ADD CONSTRAINT "cronograma_parcela_etapa_id_fkey" FOREIGN KEY ("etapa_id") REFERENCES "etapa"("id") ON DELETE CASCADE ON UPDATE CASCADE;
