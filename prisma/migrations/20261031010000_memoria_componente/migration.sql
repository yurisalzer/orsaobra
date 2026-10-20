-- Memória de cálculo do coeficiente de cada componente das composições próprias
-- (ex.: "01 funcionário * 2 dias/semana * 8 h/dia * 4 semanas / 176 h/mês * 12 meses").
ALTER TABLE "composicao_componente" ADD COLUMN "memoria_calculo" TEXT;
