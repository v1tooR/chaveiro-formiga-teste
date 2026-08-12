-- =====================================================================
-- 20260729121500 — Filtro de ruído na auditoria de app_settings
-- ---------------------------------------------------------------------
-- create_order incrementa app_settings.order_next_number a cada comanda.
-- Sem este filtro, uma loja com 40 atendimentos/dia gera 40 linhas de
-- auditoria por dia dizendo "o contador andou" — e a mudança que
-- realmente importa (alguém alterou o prefixo, o rodapé impresso ou os
-- dados da empresa) fica enterrada.
-- =====================================================================

-- A inserção é replicada em vez de delegada a trg_audit(): uma função de
-- trigger não pode ser invocada como função comum.
CREATE OR REPLACE FUNCTION "public"."trg_audit_app_settings"() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_before jsonb;
  v_after  jsonb;
  v_cmp_b  jsonb;
  v_cmp_a  jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_after := to_jsonb(NEW);
  ELSIF TG_OP = 'UPDATE' THEN
    v_before := to_jsonb(OLD);
    v_after  := to_jsonb(NEW);

    v_cmp_b := v_before - 'order_next_number' - 'updated_at';
    v_cmp_a := v_after  - 'order_next_number' - 'updated_at';

    -- Só o contador andou → não é mudança de configuração.
    IF v_cmp_b = v_cmp_a THEN
      RETURN NEW;
    END IF;
  ELSE
    v_before := to_jsonb(OLD);
  END IF;

  INSERT INTO public.audit_logs (
    "actor_id", "actor_name", "actor_role", "action",
    "resource_type", "resource_id", "before", "after"
  )
  VALUES (
    auth.uid(),
    public.current_actor_name(),
    public.current_role_key(),
    lower(TG_OP),
    'app_settings',
    'singleton',
    v_before,
    v_after
  );

  RETURN coalesce(NEW, OLD);
END;
$$;

COMMENT ON FUNCTION "public"."trg_audit_app_settings"() IS
  'Auditoria de app_settings ignorando o avanço de order_next_number (ruído de create_order).';

DROP TRIGGER IF EXISTS "audit_app_settings" ON "public"."app_settings";
CREATE TRIGGER "audit_app_settings"
    AFTER INSERT OR UPDATE OR DELETE ON "public"."app_settings"
    FOR EACH ROW EXECUTE FUNCTION "public"."trg_audit_app_settings"();
