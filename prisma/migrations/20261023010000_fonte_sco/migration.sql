-- Fonte SCO-Rio (Prefeitura do Rio de Janeiro / FGV).
INSERT INTO fonte (codigo, nome, oficial)
VALUES ('SCO', 'SCO-Rio — Sistema de Custos de Obras e Serviços de Engenharia (Prefeitura do Rio de Janeiro)', true)
ON CONFLICT (codigo) DO NOTHING;
