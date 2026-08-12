-- =====================================================================
-- 20260730140000 — Append-only sem bloquear o ON DELETE SET NULL das FKs
-- ---------------------------------------------------------------------
-- PROBLEMA (descoberto no teste do reset para produção)
--
-- audit_logs, order_events e order_payments referenciam profiles com
-- ON DELETE SET NULL. Quando um usuário é excluído (é o que o reset faz
-- com os logins de demonstração), o Postgres emite um UPDATE nessas
-- tabelas para anular a coluna — e o gatilho append-only rejeitava:
--
--   ERROR: UPDATE em public.audit_logs não é permitido: tabela append-only.
--   CONTEXT: SQL statement "UPDATE ONLY audit_logs SET actor_id = NULL ..."
--
-- Resultado: `DELETE FROM auth.users` falhava e o reset inteiro abortava.
--
-- SOLUÇÃO
--
-- O bloqueio passa a valer para o CONTEÚDO, não para a linha inteira.
-- Anular `actor_id`/`created_by` não reescreve história: `actor_name` é
-- congelado no INSERT justamente para o histórico continuar legível
-- depois de o usuário sair. Qualquer outra alteração continua proibida.
-- =====================================================================

CREATE OR REPLACE FUNCTION "public"."prevent_content_mutation"() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
DECLARE
  v_antes  jsonb;
  v_depois jsonb;
  v_col    text;
BEGIN
  v_antes  := to_jsonb(OLD);
  v_depois := to_jsonb(NEW);

  -- Colunas que a FK pode anular quando o perfil é excluído.
  FOREACH v_col IN ARRAY ARRAY['actor_id', 'created_by', 'received_by_staff_id', 'staff_id'] LOOP
    IF v_antes ? v_col THEN
      -- Só tolera a transição para NULL (é o que ON DELETE SET NULL faz).
      IF (v_depois->>v_col) IS NULL THEN
        v_antes  := v_antes  - v_col;
        v_depois := v_depois - v_col;
      END IF;
    END IF;
  END LOOP;

  IF v_antes <> v_depois THEN
    RAISE EXCEPTION
      'UPDATE em %.% não é permitido: tabela append-only (apenas a desvinculação de usuário excluído é tolerada).',
      TG_TABLE_SCHEMA, TG_TABLE_NAME
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION "public"."prevent_content_mutation"() IS
  'Append-only sobre o conteúdo: tolera apenas o SET NULL das FKs de autor quando o perfil é excluído.';

DROP TRIGGER IF EXISTS "audit_logs_no_update"     ON "public"."audit_logs";
DROP TRIGGER IF EXISTS "order_events_no_update"   ON "public"."order_events";
DROP TRIGGER IF EXISTS "order_payments_no_update" ON "public"."order_payments";

CREATE TRIGGER "audit_logs_no_update"
    BEFORE UPDATE ON "public"."audit_logs"
    FOR EACH ROW EXECUTE FUNCTION "public"."prevent_content_mutation"();

CREATE TRIGGER "order_events_no_update"
    BEFORE UPDATE ON "public"."order_events"
    FOR EACH ROW EXECUTE FUNCTION "public"."prevent_content_mutation"();

CREATE TRIGGER "order_payments_no_update"
    BEFORE UPDATE ON "public"."order_payments"
    FOR EACH ROW EXECUTE FUNCTION "public"."prevent_content_mutation"();

-- `prevent_mutation()` continua em uso para bloquear DELETE em audit_logs.
