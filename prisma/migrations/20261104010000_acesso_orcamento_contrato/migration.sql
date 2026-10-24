-- Acesso individual: além do criador e do administrador, só os usuários escolhidos entram no orçamento/contrato.
-- pode_editar: além de ver, editar (se o usuário também tiver a permissão geral de edição).
CREATE TABLE "orcamento_acesso" (
  "orcamento_id" UUID NOT NULL,
  "usuario_id" UUID NOT NULL,
  "pode_editar" BOOLEAN NOT NULL DEFAULT false,
  "concedido_por_id" UUID,
  "concedido_em" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "orcamento_acesso_pkey" PRIMARY KEY ("orcamento_id", "usuario_id"),
  CONSTRAINT "orcamento_acesso_orcamento_id_fkey" FOREIGN KEY ("orcamento_id") REFERENCES "orcamento"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "orcamento_acesso_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "orcamento_acesso_concedido_por_id_fkey" FOREIGN KEY ("concedido_por_id") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "orcamento_acesso_usuario_idx" ON "orcamento_acesso" ("usuario_id");

CREATE TABLE "contrato_acesso" (
  "contrato_id" UUID NOT NULL,
  "usuario_id" UUID NOT NULL,
  "pode_editar" BOOLEAN NOT NULL DEFAULT false,
  "concedido_por_id" UUID,
  "concedido_em" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "contrato_acesso_pkey" PRIMARY KEY ("contrato_id", "usuario_id"),
  CONSTRAINT "contrato_acesso_contrato_id_fkey" FOREIGN KEY ("contrato_id") REFERENCES "contrato"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "contrato_acesso_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "contrato_acesso_concedido_por_id_fkey" FOREIGN KEY ("concedido_por_id") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "contrato_acesso_usuario_idx" ON "contrato_acesso" ("usuario_id");
