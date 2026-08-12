-- =====================================================================
-- 20260730130000 — KPIs financeiros: NULL em vez de zero para quem não vê
-- ---------------------------------------------------------------------
-- PROBLEMA
--
-- `dashboard_kpis` é SECURITY INVOKER, então a RLS de `ledger_entries`
-- vale — o que está certo: atendimento e produção não têm o módulo
-- financeiro. Mas `sum()` sobre zero linhas devolve 0, e o Dashboard
-- mostrava "Recebido hoje: R$ 0,00" para esses papéis.
--
-- Zero é uma AFIRMAÇÃO ("não entrou nada hoje"), não uma ausência. O
-- operador do balcão via um número errado e não tinha como saber.
--
-- Agora os campos de dinheiro vêm NULL quando o papel não pode lê-los, e
-- o front esconde o indicador em vez de exibir zero.
--
-- `pending_amount` continua visível para todos: ele é somado de
-- `orders.balance`, que atendimento e produção já veem na própria
-- comanda — esconder ali seria inconsistente com a tela de Comandas.
-- =====================================================================

CREATE OR REPLACE FUNCTION "public"."dashboard_kpis"() RETURNS jsonb
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
WITH
  today AS (SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date AS d),
  perm AS (SELECT public.can_read('finance') AS ve_financeiro),
  o AS (
    SELECT
      orders.*,
      ost."is_final",
      (NOT ost."is_final" AND orders."due_date"::date < (SELECT d FROM today)) AS "overdue"
    FROM orders
    JOIN order_statuses ost ON ost."key" = orders."status_key"
    WHERE orders."deleted_at" IS NULL
  ),
  l AS (
    SELECT le.*, s."counts_as_received"
    FROM ledger_entries le
    JOIN ledger_statuses s ON s."key" = le."status_key"
    WHERE le."deleted_at" IS NULL
  )
SELECT jsonb_build_object(
  'orders_today',       (SELECT count(*) FROM o WHERE o."created_at"::date = (SELECT d FROM today)),
  'open_orders',        (SELECT count(*) FROM o WHERE NOT o."is_final"),
  'in_progress',        (SELECT count(*) FROM o WHERE o."status_key" = 'execucao'),
  'ready',              (SELECT count(*) FROM o WHERE o."status_key" IN ('pronta', 'avisado')),
  'overdue',            (SELECT count(*) FROM o WHERE o."overdue"),

  -- NULL = "sem permissão para ver", não "zero".
  'received_today',
    CASE WHEN (SELECT ve_financeiro FROM perm)
      THEN (SELECT coalesce(sum(l."amount"), 0) FROM l
             WHERE l."kind" = 'income' AND l."counts_as_received"
               AND l."entry_date"::date = (SELECT d FROM today))
      ELSE NULL END,
  'received_month',
    CASE WHEN (SELECT ve_financeiro FROM perm)
      THEN (SELECT coalesce(sum(l."amount"), 0) FROM l
             WHERE l."kind" = 'income' AND l."counts_as_received"
               AND date_trunc('month', l."entry_date") = date_trunc('month', now()))
      ELSE NULL END,

  -- Vem de orders.balance: quem lê comanda já vê esse valor na tela.
  'pending_amount',     (SELECT coalesce(sum(o."balance"), 0) FROM o WHERE o."status_key" <> 'cancelada'),
  'average_ticket',     (SELECT coalesce(avg(o."total_amount"), 0) FROM o WHERE o."status_key" <> 'cancelada'),
  'delivered_unpaid',   (SELECT count(*) FROM o WHERE o."status_key" = 'entregue' AND o."balance" > 0.01),

  -- O front usa isto para decidir entre esconder o indicador e mostrar 0.
  'can_read_finance',   (SELECT ve_financeiro FROM perm)
);
$$;

COMMENT ON FUNCTION "public"."dashboard_kpis"() IS
  'Port de calcularKpis(). Campos de dinheiro vêm NULL quando o papel não lê o módulo financeiro.';

REVOKE ALL ON FUNCTION "public"."dashboard_kpis"() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."dashboard_kpis"() TO "authenticated";
