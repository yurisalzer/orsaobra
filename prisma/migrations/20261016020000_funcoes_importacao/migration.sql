-- Interrompe a transação com mensagem clara quando uma condição não é atendida.
-- Usada nas confirmações de importação, que rodam como lote não interativo
-- (endpoint HTTP do Neon): a verificação acontece dentro da própria transação.
CREATE OR REPLACE FUNCTION imp_exigir(condicao boolean, mensagem text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF condicao IS NOT TRUE THEN
    RAISE EXCEPTION '%', mensagem USING ERRCODE = 'check_violation';
  END IF;
END $$;
