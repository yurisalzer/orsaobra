-- Fonte SICRO (DNIT). As bases entram pela importação, como EMOP e SINAPI.
INSERT INTO fonte (codigo, nome, oficial)
VALUES ('SICRO', 'SICRO — Sistema de Custos Referenciais de Obras (DNIT)', true)
ON CONFLICT (codigo) DO NOTHING;
