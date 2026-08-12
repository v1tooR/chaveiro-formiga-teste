-- =====================================================================
-- 20260729121000 — Auditoria
-- ---------------------------------------------------------------------
-- Quem fez o quê e quando. Cobre ações sensíveis e o módulo
-- administrativo. Append-only: nem o responsável edita ou apaga.
--
-- order_events é a timeline do NEGÓCIO (visível ao operador na comanda).
-- audit_logs é a trilha de SEGURANÇA (só o responsável vê).
-- =====================================================================

CREATE TABLE "public"."audit_logs" (
    "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "actor_id"       uuid REFERENCES "public"."profiles"("id") ON DELETE SET NULL,
    "actor_name"     text NOT NULL DEFAULT 'Sistema',
    "actor_role"     text,
    "action"         text NOT NULL,
    "resource_type"  text NOT NULL,
    "resource_id"    text,
    "before"         jsonb,
    "after"          jsonb,
    "metadata"       jsonb NOT NULL DEFAULT '{}'::jsonb,
    "created_at"     timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT "audit_logs_action_valid" CHECK ("action" IN ('insert', 'update', 'delete')),
    CONSTRAINT "audit_logs_resource_min" CHECK (char_length(btrim("resource_type")) > 0)
);

COMMENT ON TABLE  "public"."audit_logs" IS
  'Trilha de auditoria append-only. Visível apenas para quem tem `w` em settings.';
COMMENT ON COLUMN "public"."audit_logs"."before" IS 'Linha antes da mudança (NULL em insert).';
COMMENT ON COLUMN "public"."audit_logs"."after"  IS 'Linha depois da mudança (NULL em delete).';

CREATE INDEX "audit_logs_created_idx"  ON "public"."audit_logs" ("created_at" DESC);
CREATE INDEX "audit_logs_actor_idx"    ON "public"."audit_logs" ("actor_id", "created_at" DESC);
CREATE INDEX "audit_logs_resource_idx" ON "public"."audit_logs" ("resource_type", "resource_id", "created_at" DESC);


-- ---------------------------------------------------------------------
-- Trigger genérico de auditoria
-- ---------------------------------------------------------------------
-- Guarda o registro inteiro. As tabelas auditadas aqui não têm colunas
-- sensíveis (nenhuma senha, token ou chave passa por elas — segredos
-- ficam no Vault / secrets das Edge Functions).
CREATE OR REPLACE FUNCTION "public"."trg_audit"() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_before jsonb;
  v_after  jsonb;
  v_id     text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_after := to_jsonb(NEW);
  ELSIF TG_OP = 'UPDATE' THEN
    v_before := to_jsonb(OLD);
    v_after  := to_jsonb(NEW);
    -- Update sem mudança real (ex.: re-save de formulário) não vira linha.
    IF v_before = v_after THEN
      RETURN NEW;
    END IF;
  ELSE
    v_before := to_jsonb(OLD);
  END IF;

  v_id := coalesce(v_after->>'id', v_before->>'id');

  INSERT INTO public.audit_logs (
    "actor_id", "actor_name", "actor_role", "action",
    "resource_type", "resource_id", "before", "after"
  )
  VALUES (
    auth.uid(),
    public.current_actor_name(),
    public.current_role_key(),
    lower(TG_OP),
    TG_TABLE_NAME,
    v_id,
    v_before,
    v_after
  );

  RETURN coalesce(NEW, OLD);
END;
$$;

COMMENT ON FUNCTION "public"."trg_audit"() IS
  'Trigger AFTER genérico de auditoria. Ignora UPDATE que não alterou nada.';


-- ---------------------------------------------------------------------
-- Onde auditar
-- ---------------------------------------------------------------------
-- Critério: dado financeiro, configuração, permissão e catálogo de preço.
-- orders NÃO entra: já tem order_events (timeline completa e visível) e
-- auditar cada arrasto do Kanban encheria a tabela sem informação nova.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'app_settings',       -- numeração, dados da empresa, impressão
    'ledger_entries',     -- dinheiro
    'ledger_categories',
    'services',           -- tabela de preços
    'customers',          -- LGPD: quem alterou dado de cliente
    'staff',
    'profiles',           -- mudança de papel
    'role_modules'        -- mudança da matriz de permissões
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON public.%I
         FOR EACH ROW EXECUTE FUNCTION public.trg_audit()',
      'audit_' || t, t
    );
  END LOOP;
END
$$;


-- =====================================================================
-- RLS — leitura só para o responsável; escrita só via trigger
-- =====================================================================
ALTER TABLE "public"."audit_logs" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audit_logs_select" ON "public"."audit_logs"
    FOR SELECT TO "authenticated" USING ("public"."is_owner"());

-- Sem policy de INSERT/UPDATE/DELETE: RLS habilitada sem policy nega tudo.
-- A trigger é SECURITY DEFINER e escreve como owner da tabela.

CREATE TRIGGER "audit_logs_no_update"
    BEFORE UPDATE ON "public"."audit_logs"
    FOR EACH ROW EXECUTE FUNCTION "public"."prevent_mutation"();

CREATE TRIGGER "audit_logs_no_delete"
    BEFORE DELETE ON "public"."audit_logs"
    FOR EACH ROW EXECUTE FUNCTION "public"."prevent_mutation"();
