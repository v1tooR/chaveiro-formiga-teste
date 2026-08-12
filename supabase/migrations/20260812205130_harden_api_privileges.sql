-- =====================================================================
-- 20260812205130 — privilégios mínimos na Data API
-- ---------------------------------------------------------------------
-- Projetos hospedados concedem EXECUTE de novas funções a anon e
-- authenticated por default. Em funções SECURITY DEFINER isso transforma
-- helpers, triggers e rotinas de manutenção em RPCs públicas.
-- =====================================================================

-- Novas funções precisam declarar explicitamente quem pode executá-las.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, "anon", "authenticated";

-- Fecha todas as funções atuais para chamadas anônimas. Grants diretos já
-- versionados para authenticated (RPCs do app) permanecem intactos.
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, "anon";

-- Rotinas internas não são endpoints. Triggers e outras funções
-- SECURITY DEFINER continuam conseguindo chamá-las como owner.
REVOKE EXECUTE ON FUNCTION public.backfill_order_items() FROM "authenticated";
REVOKE EXECUTE ON FUNCTION public.backfill_ready_at() FROM "authenticated";
REVOKE EXECUTE ON FUNCTION public.ensure_order_photos_bucket() FROM "authenticated";
REVOKE EXECUTE ON FUNCTION public.log_order_event(uuid, text, text) FROM "authenticated";
REVOKE EXECUTE ON FUNCTION public.recalc_customer_status(uuid) FROM "authenticated";
REVOKE EXECUTE ON FUNCTION public.recalc_order_amount_paid(uuid) FROM "authenticated";
REVOKE EXECUTE ON FUNCTION public.recalc_order_from_items(uuid) FROM "authenticated";
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM "authenticated";
REVOKE EXECUTE ON FUNCTION public.trg_audit() FROM "authenticated";
REVOKE EXECUTE ON FUNCTION public.trg_audit_app_settings() FROM "authenticated";
REVOKE EXECUTE ON FUNCTION public.trg_order_items_sync_order() FROM "authenticated";
REVOKE EXECUTE ON FUNCTION public.trg_order_items_warranty() FROM "authenticated";
REVOKE EXECUTE ON FUNCTION public.trg_order_payments_recalc() FROM "authenticated";
REVOKE EXECUTE ON FUNCTION public.trg_order_photo_cleanup_storage() FROM "authenticated";
REVOKE EXECUTE ON FUNCTION public.trg_orders_after_status_change() FROM "authenticated";
REVOKE EXECUTE ON FUNCTION public.trg_orders_recalc_customer() FROM "authenticated";


-- A view antiga contornava RLS como owner. Esta função privilegiada expõe
-- deliberadamente só as seis colunas não sensíveis e exige uma sessão.
CREATE OR REPLACE FUNCTION public.integration_status_rows()
RETURNS TABLE (
  "key" text,
  "name" text,
  "kind" text,
  "enabled" boolean,
  "last_status" text,
  "last_checked_at" timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT i."key", i."name", i."kind", i."enabled", i."last_status", i."last_checked_at"
  FROM public.integrations i
  WHERE (SELECT auth.uid()) IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION public.integration_status_rows() FROM PUBLIC, "anon";
GRANT EXECUTE ON FUNCTION public.integration_status_rows() TO "authenticated";

CREATE OR REPLACE VIEW public.integration_status
  WITH (security_invoker = true)
AS
SELECT * FROM public.integration_status_rows();

REVOKE ALL ON public.integration_status FROM PUBLIC, "anon";
GRANT SELECT ON public.integration_status TO "authenticated";
