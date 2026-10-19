-- Revisões fechadas continuam imutáveis, exceto por duas operações explícitas
-- da aplicação (desbloquear para edição e excluir o orçamento), feitas pelo
-- criador ou pelo administrador e registradas na auditoria. Essas operações
-- ligam, só dentro da própria transação, o indicador "orcamento.liberar_fechada".
CREATE OR REPLACE FUNCTION trg_revisao_fechada_filhos() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  st text;
BEGIN
  IF current_setting('orcamento.liberar_fechada', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  SELECT status INTO st FROM orcamento_revisao
   WHERE id = COALESCE(NEW.revisao_id, OLD.revisao_id);
  IF st = 'FECHADA' THEN
    RAISE EXCEPTION 'Revisão de orçamento fechada não pode ser alterada'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

CREATE OR REPLACE FUNCTION trg_revisao_fechada_propria() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'FECHADA' AND coalesce(current_setting('orcamento.liberar_fechada', true), '') <> 'on' THEN
    RAISE EXCEPTION 'Revisão de orçamento fechada não pode ser alterada nem excluída'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
