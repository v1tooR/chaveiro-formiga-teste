-- =====================================================================
-- 20260730150000 — Fecha o vazamento de `pending_amount` e `average_ticket`
-- ---------------------------------------------------------------------
-- PROBLEMA
--
-- A 20260730130000 protegeu `received_today` e `received_month` com o
-- CASE de permissão, mas deixou `pending_amount` e `average_ticket` de
-- fora. Os dois somam de `orders`, não de `ledger_entries`, então a RLS
-- também não os esconde: qualquer papel autenticado recebia o valor.
--
-- Medido antes desta migration, como Diego (papel `production`):
--   pending_amount  = 9313.40
--   average_ticket  =  142.66
--   received_month  = null   (correto)
--
-- A migration anterior justificou `pending_amount` alegando que
-- atendimento e produção "já veem o saldo na própria comanda". A
-- justificativa não se sustenta: ver o saldo de UMA comanda que você
-- está atendendo é diferente de ver o passivo consolidado da loja. O
-- primeiro é operação; o segundo é informação financeira, e o módulo
-- `finance` existe exatamente para delimitar isso. `average_ticket`
-- sequer chegou a ser justificado — ficou de fora por omissão.
--
-- Continuam FORA do CASE, de propósito:
--   • `delivered_unpaid` — é CONTAGEM de comandas a cobrar, não valor. O
--     balcão precisa saber que há 4 pessoas para chamar; quanto elas
--     devem é outra pergunta.
--   • `can_read_finance` — é a própria flag que o front usa para decidir
--     entre esconder o indicador e mostrar zero.
--
-- EFEITO COLATERAL ACEITO
--
-- `viewer` tem o módulo `reports` mas não `finance`, então passa a ver
-- "—" em pendente e ticket médio também na tela de Relatórios. É o
-- comportamento correto: consulta acompanha a operação, não o caixa.
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
  'pending_amount',
    CASE WHEN (SELECT ve_financeiro FROM perm)
      THEN (SELECT coalesce(sum(o."balance"), 0) FROM o WHERE o."status_key" <> 'cancelada')
      ELSE NULL END,
  'average_ticket',
    CASE WHEN (SELECT ve_financeiro FROM perm)
      THEN (SELECT coalesce(avg(o."total_amount"), 0) FROM o WHERE o."status_key" <> 'cancelada')
      ELSE NULL END,

  -- Contagem, não valor: o balcão precisa saber quantos clientes chamar.
  'delivered_unpaid',   (SELECT count(*) FROM o WHERE o."status_key" = 'entregue' AND o."balance" > 0.01),

  -- O front usa isto para decidir entre esconder o indicador e mostrar 0.
  'can_read_finance',   (SELECT ve_financeiro FROM perm)
);
$$;

COMMENT ON FUNCTION "public"."dashboard_kpis"() IS
  'Port de calcularKpis(). TODO campo de dinheiro vem NULL quando o papel não lê o módulo financeiro; contagens de comanda são visíveis a todos.';

REVOKE ALL ON FUNCTION "public"."dashboard_kpis"() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."dashboard_kpis"() TO "authenticated";
