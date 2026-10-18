-- Permissões individuais por recurso (substituem os papéis fixos no controle de acesso).
CREATE TABLE "usuario_permissao" (
  "usuario_id" UUID NOT NULL,
  "permissao" TEXT NOT NULL,
  "concedida_em" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "usuario_permissao_pkey" PRIMARY KEY ("usuario_id", "permissao"),
  CONSTRAINT "usuario_permissao_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT usuario_permissao_valida CHECK (permissao IN
    ('CONSULTA', 'ORCAMENTOS_VER', 'ORCAMENTOS_EDITAR', 'RELATORIOS', 'COMPOSICOES', 'BDI', 'CABECALHOS', 'IMPORTACAO', 'USUARIOS'))
);

-- Conversão dos papéis atuais: cada usuário mantém exatamente o acesso que já tinha.
INSERT INTO usuario_permissao (usuario_id, permissao)
SELECT u.id, p.permissao FROM usuario u
  JOIN (VALUES
    ('LEITOR', 'CONSULTA'), ('LEITOR', 'ORCAMENTOS_VER'), ('LEITOR', 'RELATORIOS'),
    ('ORCAMENTISTA', 'CONSULTA'), ('ORCAMENTISTA', 'ORCAMENTOS_VER'), ('ORCAMENTISTA', 'RELATORIOS'), ('ORCAMENTISTA', 'ORCAMENTOS_EDITAR'),
    ('ORCAMENTISTA', 'COMPOSICOES'), ('ORCAMENTISTA', 'BDI'), ('ORCAMENTISTA', 'CABECALHOS'),
    ('ADMIN', 'CONSULTA'), ('ADMIN', 'ORCAMENTOS_VER'), ('ADMIN', 'RELATORIOS'), ('ADMIN', 'ORCAMENTOS_EDITAR'),
    ('ADMIN', 'COMPOSICOES'), ('ADMIN', 'BDI'), ('ADMIN', 'CABECALHOS'), ('ADMIN', 'IMPORTACAO'), ('ADMIN', 'USUARIOS')
  ) AS p(papel, permissao) ON p.papel = u.papel::text;
