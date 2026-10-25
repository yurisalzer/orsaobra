-- Cadastro de empresas (contratadas) e seus responsáveis técnicos
CREATE TABLE "empresa" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "razao_social" TEXT NOT NULL,
  "nome_fantasia" TEXT,
  -- só dígitos (14), dígitos verificadores conferidos pela aplicação
  "cnpj" TEXT NOT NULL,
  "inscricao_estadual" TEXT,
  "inscricao_municipal" TEXT,
  "cep" TEXT,
  "logradouro" TEXT,
  "numero" TEXT,
  "complemento" TEXT,
  "bairro" TEXT,
  "municipio" TEXT,
  "uf" CHAR(2),
  "telefone" TEXT,
  "email" TEXT,
  "representante_nome" TEXT,
  "representante_cpf" TEXT,
  "representante_cargo" TEXT,
  "observacoes" TEXT,
  "ativo" BOOLEAN NOT NULL DEFAULT true,
  "criado_por_id" UUID,
  "criado_em" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "atualizado_em" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "versao" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "empresa_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "empresa_cnpj_formato" CHECK ("cnpj" ~ '^\d{14}$'),
  CONSTRAINT "empresa_criado_por_id_fkey" FOREIGN KEY ("criado_por_id") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "empresa_cnpj_key" ON "empresa" ("cnpj");

CREATE TABLE "empresa_responsavel" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "empresa_id" UUID NOT NULL,
  "ordem" INTEGER NOT NULL,
  "nome" TEXT NOT NULL,
  -- formação / título profissional (ex.: Engenheiro Civil, Arquiteto e Urbanista)
  "titulo" TEXT,
  -- conselho profissional: CREA, CAU, CFT ou outro
  "conselho" TEXT NOT NULL,
  "registro" TEXT NOT NULL,
  "uf_registro" CHAR(2),
  "cpf" TEXT,
  "email" TEXT,
  "telefone" TEXT,
  "principal" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "empresa_responsavel_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "empresa_responsavel_conselho" CHECK ("conselho" IN ('CREA', 'CAU', 'CFT', 'OUTRO')),
  CONSTRAINT "empresa_responsavel_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "empresa_responsavel_empresa_idx" ON "empresa_responsavel" ("empresa_id", "ordem");
CREATE UNIQUE INDEX "empresa_responsavel_um_principal" ON "empresa_responsavel" ("empresa_id") WHERE "principal";

-- contrato pode apontar para a empresa cadastrada (os dados copiados no contrato continuam valendo)
ALTER TABLE "contrato" ADD COLUMN "empresa_id" UUID;
ALTER TABLE "contrato" ADD CONSTRAINT "contrato_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id") ON DELETE SET NULL ON UPDATE CASCADE;
