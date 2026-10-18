-- Autocadastro: dados do usuário, confirmação de e-mail e liberação pelo administrador.
ALTER TABLE "usuario" ADD COLUMN "cpf" TEXT;
ALTER TABLE "usuario" ADD COLUMN "telefone" TEXT;
ALTER TABLE "usuario" ADD COLUMN "email_confirmado_em" TIMESTAMPTZ;
ALTER TABLE "usuario" ADD COLUMN "aprovado_em" TIMESTAMPTZ;
ALTER TABLE "usuario" ADD COLUMN "origem" TEXT NOT NULL DEFAULT 'ADMINISTRADOR';
ALTER TABLE "usuario" ADD CONSTRAINT usuario_cpf_formato CHECK (cpf IS NULL OR cpf ~ '^\d{11}$');
ALTER TABLE "usuario" ADD CONSTRAINT usuario_origem_valida CHECK (origem IN ('ADMINISTRADOR', 'AUTOCADASTRO'));
CREATE UNIQUE INDEX "usuario_cpf_key" ON "usuario" ("cpf");
-- usuários já existentes foram criados pelo administrador: e-mail e acesso já valem
UPDATE "usuario" SET email_confirmado_em = criado_em, aprovado_em = criado_em;

-- Links de confirmação de e-mail (só o hash do código é guardado).
CREATE TABLE "confirmacao_email" (
  "token_hash" TEXT NOT NULL,
  "usuario_id" UUID NOT NULL,
  "expira_em" TIMESTAMPTZ NOT NULL,
  "usado_em" TIMESTAMPTZ,
  "criado_em" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "confirmacao_email_pkey" PRIMARY KEY ("token_hash"),
  CONSTRAINT "confirmacao_email_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "confirmacao_email_usuario_idx" ON "confirmacao_email" ("usuario_id");

-- Caixa de saída: todo e-mail do sistema fica registrado, com o resultado do envio.
CREATE TABLE "email_saida" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "para" TEXT NOT NULL,
  "assunto" TEXT NOT NULL,
  "texto" TEXT NOT NULL,
  "html" TEXT,
  "motivo" TEXT NOT NULL,
  "usuario_id" UUID,
  "status" TEXT NOT NULL,
  "erro" TEXT,
  "id_provedor" TEXT,
  "criado_em" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "email_saida_pkey" PRIMARY KEY ("id"),
  CONSTRAINT email_saida_status_valido CHECK (status IN ('ENVIADO', 'FALHOU', 'NAO_CONFIGURADO')),
  CONSTRAINT "email_saida_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "email_saida_criado_idx" ON "email_saida" ("criado_em" DESC);
