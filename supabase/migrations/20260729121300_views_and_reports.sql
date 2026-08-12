-- =====================================================================
-- 20260729121300 — Views de listagem e RPCs de relatório
-- ---------------------------------------------------------------------
-- Substituem src/lib/metricas.ts. Motivo de estarem no banco e não no
-- front: hoje os KPIs são calculados sobre o array COMPLETO em memória.
-- Com paginação real, um cálculo no cliente veria apenas a página atual
-- e daria número errado. Agregação é trabalho do banco.
--
-- Todas as views usam `security_invoker = true`: a RLS das tabelas-base
-- continua valendo para quem consulta.
-- =====================================================================

-- ---------------------------------------------------------------------
-- order_list_view — a listagem padrão de comandas
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW "public"."order_list_view"
    WITH (security_invoker = true)
    AS
SELECT
  o."id",
  o."number",
  o."customer_id",
  c."name"     AS "customer_name",
  c."phone"    AS "customer_phone",
  c."whatsapp" AS "customer_whatsapp",
  o."category_key",
  o."service_id",
  o."service_name",
  o."description",
  o."quantity",
  o."notes",
  o."due_date",
  o."assigned_staff_id",
  st."name" AS "assigned_staff_name",
  o."status_key",
  o."total_amount",
  o."down_payment",
  o."down_payment_method_key",
  o."amount_paid",
  o."balance",
  o."is_settled",
  o."label_printed",
  o."order_printed",
  o."delivered_at",
  o."created_at",
  o."updated_at",

  -- Regra 21: atrasada = não finalizada E prazo < hoje
  -- (estaAtrasada(), src/lib/utils.ts:82). Comparação por DIA, igual ao
  -- front (dia() zera o horário) — senão uma comanda que vence hoje às
  -- 18h apareceria atrasada às 8h da manhã.
  (
    NOT ost."is_final"
    AND o."due_date"::date < (now() AT TIME ZONE 'America/Sao_Paulo')::date
  ) AS "is_overdue",

  (o."due_date"::date - (now() AT TIME ZONE 'America/Sao_Paulo')::date) AS "days_remaining",

  coalesce(ph."photo_count", 0) AS "photo_count",
  ph."first_photo_id",
  ph."first_photo_kind",
  ph."first_photo_caption",
  ph."first_photo_path",
  ph."first_photo_seed"
FROM "public"."orders" o
JOIN "public"."customers"      c   ON c."id"   = o."customer_id"
JOIN "public"."order_statuses" ost ON ost."key" = o."status_key"
LEFT JOIN "public"."staff"     st  ON st."id"  = o."assigned_staff_id"
LEFT JOIN LATERAL (
  SELECT
    count(*)                                     AS "photo_count",
    (array_agg(p."id"            ORDER BY p."created_at"))[1] AS "first_photo_id",
    (array_agg(p."kind"          ORDER BY p."created_at"))[1] AS "first_photo_kind",
    (array_agg(p."caption"       ORDER BY p."created_at"))[1] AS "first_photo_caption",
    (array_agg(p."storage_path"  ORDER BY p."created_at"))[1] AS "first_photo_path",
    (array_agg(p."gradient_seed" ORDER BY p."created_at"))[1] AS "first_photo_seed"
  FROM "public"."order_photos" p
  WHERE p."order_id" = o."id"
) ph ON true
WHERE o."deleted_at" IS NULL;

COMMENT ON VIEW "public"."order_list_view" IS
  'Listagem de comandas com cliente, responsável, atraso e primeira foto. Base de Comandas, Produção, Etiquetas e Atendimento.';


-- ---------------------------------------------------------------------
-- customer_summary_view — resumoCliente() (src/store/useApp.ts:433)
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW "public"."customer_summary_view"
    WITH (security_invoker = true)
    AS
SELECT
  c."id",
  c."name",
  c."phone",
  c."whatsapp",
  c."email",
  c."city",
  c."status_key",
  c."notes",
  c."created_at",
  c."updated_at",
  coalesce(agg."order_count", 0)  AS "order_count",
  coalesce(agg."total_spent", 0)  AS "total_spent",
  coalesce(agg."pending", 0)      AS "pending_amount",
  agg."last_order_at",
  agg."last_service_name"
FROM "public"."customers" c
LEFT JOIN LATERAL (
  SELECT
    count(*)                     AS "order_count",
    -- totalGasto = soma do EFETIVAMENTE PAGO (totalPago), não do valor
    -- da comanda (useApp.ts:436).
    sum(o."amount_paid")         AS "total_spent",
    sum(o."balance")             AS "pending",
    max(o."created_at")          AS "last_order_at",
    (array_agg(o."service_name" ORDER BY o."created_at" DESC))[1] AS "last_service_name"
  FROM "public"."orders" o
  WHERE o."customer_id" = c."id"
    AND o."deleted_at" IS NULL
    AND o."status_key" <> 'cancelada'
) agg ON true
WHERE c."deleted_at" IS NULL;

COMMENT ON VIEW "public"."customer_summary_view" IS
  'Cliente + agregados (qtd, total pago, pendente, último serviço). Exclui comandas canceladas, como resumoCliente().';


-- ---------------------------------------------------------------------
-- ledger_list_view — listagem do Financeiro
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW "public"."ledger_list_view"
    WITH (security_invoker = true)
    AS
SELECT
  le."id",
  le."kind",
  le."description",
  le."category_id",
  cat."name" AS "category_name",
  le."amount",
  le."entry_date",
  le."status_key",
  le."method_key",
  le."order_id",
  o."number" AS "order_number",
  le."customer_id",
  cus."name" AS "customer_name",
  le."staff_id",
  stf."name" AS "staff_name",
  le."note",
  le."auto_generated",
  le."auto_role",
  le."created_at"
FROM "public"."ledger_entries" le
JOIN "public"."ledger_categories" cat ON cat."id" = le."category_id"
LEFT JOIN "public"."orders"    o   ON o."id"   = le."order_id"   AND o."deleted_at" IS NULL
LEFT JOIN "public"."customers" cus ON cus."id" = le."customer_id"
LEFT JOIN "public"."staff"     stf ON stf."id" = le."staff_id"
WHERE le."deleted_at" IS NULL;

COMMENT ON VIEW "public"."ledger_list_view" IS
  'Lançamentos com categoria, comanda, cliente e responsável resolvidos (Financeiro.tsx).';


-- =====================================================================
-- RPCs de relatório
-- ---------------------------------------------------------------------
-- Ports diretos de src/lib/metricas.ts, agora sobre o dataset inteiro.
-- STABLE + SECURITY INVOKER: a RLS de cada tabela continua valendo.
-- =====================================================================

-- calcularKpis() (metricas.ts:26)
CREATE OR REPLACE FUNCTION "public"."dashboard_kpis"() RETURNS jsonb
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
WITH
  today AS (SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date AS d),
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
  'received_today',     (SELECT coalesce(sum(l."amount"), 0) FROM l
                          WHERE l."kind" = 'income' AND l."counts_as_received"
                            AND l."entry_date"::date = (SELECT d FROM today)),
  'received_month',     (SELECT coalesce(sum(l."amount"), 0) FROM l
                          WHERE l."kind" = 'income' AND l."counts_as_received"
                            AND date_trunc('month', l."entry_date") = date_trunc('month', now())),
  -- pendente soma o SALDO das comandas não canceladas (metricas.ts:57),
  -- não os lançamentos: é a fonte que o front usa.
  'pending_amount',     (SELECT coalesce(sum(o."balance"), 0) FROM o WHERE o."status_key" <> 'cancelada'),
  'average_ticket',     (SELECT coalesce(avg(o."total_amount"), 0) FROM o WHERE o."status_key" <> 'cancelada'),
  'delivered_unpaid',   (SELECT count(*) FROM o WHERE o."status_key" = 'entregue' AND o."balance" > 0.01)
);
$$;

COMMENT ON FUNCTION "public"."dashboard_kpis"() IS 'Port de calcularKpis() (src/lib/metricas.ts:26).';


-- serieAtendimentos() (metricas.ts:85)
CREATE OR REPLACE FUNCTION "public"."report_daily_intake"("p_days" integer DEFAULT 14)
    RETURNS TABLE ("day" date, "orders" bigint, "amount" numeric)
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  SELECT
    d::date                                  AS "day",
    count(o."id")                            AS "orders",
    coalesce(sum(o."total_amount"), 0)       AS "amount"
  FROM generate_series(
         (now() AT TIME ZONE 'America/Sao_Paulo')::date - (greatest(p_days, 1) - 1),
         (now() AT TIME ZONE 'America/Sao_Paulo')::date,
         interval '1 day'
       ) d
  LEFT JOIN orders o
    ON o."created_at"::date = d::date AND o."deleted_at" IS NULL
  GROUP BY d
  ORDER BY d;
$$;


-- porCategoria() (metricas.ts:101)
CREATE OR REPLACE FUNCTION "public"."report_by_category"()
    RETURNS TABLE ("category_key" text, "label" text, "color" text, "orders" bigint, "amount" numeric)
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  SELECT
    sc."key", sc."label", sc."color",
    count(o."id"),
    coalesce(sum(o."total_amount"), 0)
  FROM service_categories sc
  LEFT JOIN orders o
    ON o."category_key" = sc."key"
   AND o."deleted_at" IS NULL
   AND o."status_key" <> 'cancelada'
  GROUP BY sc."key", sc."label", sc."color", sc."sort_order"
  HAVING count(o."id") > 0
  ORDER BY count(o."id") DESC;
$$;


-- serieFaturamento() (metricas.ts:120)
CREATE OR REPLACE FUNCTION "public"."report_monthly_finance"("p_months" integer DEFAULT 12)
    RETURNS TABLE ("month" date, "received" numeric, "expense" numeric, "pending" numeric)
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  WITH months AS (
    SELECT date_trunc('month', d)::date AS m
    FROM generate_series(
           date_trunc('month', now()) - ((greatest(p_months, 1) - 1) || ' months')::interval,
           date_trunc('month', now()),
           interval '1 month'
         ) d
  ),
  entries AS (
    SELECT
      date_trunc('month', le."entry_date")::date AS m,
      le."kind", le."amount",
      s."counts_as_received", s."counts_as_open"
    FROM ledger_entries le
    JOIN ledger_statuses s ON s."key" = le."status_key"
    WHERE le."deleted_at" IS NULL
  )
  SELECT
    months.m,
    coalesce(sum(e."amount") FILTER (WHERE e."kind" = 'income'  AND e."counts_as_received"), 0),
    coalesce(sum(e."amount") FILTER (WHERE e."kind" = 'expense'), 0),
    coalesce(sum(e."amount") FILTER (WHERE e."kind" = 'income'  AND e."counts_as_open"), 0)
  FROM months
  LEFT JOIN entries e ON e.m = months.m
  GROUP BY months.m
  ORDER BY months.m;
$$;


-- topServicos() (metricas.ts:153)
CREATE OR REPLACE FUNCTION "public"."report_top_services"("p_limit" integer DEFAULT 8)
    RETURNS TABLE ("service_name" text, "category_key" text, "quantity" bigint, "amount" numeric)
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  SELECT
    o."service_name",
    -- Um mesmo nome de serviço pode ter mudado de categoria; usa a predominante.
    (mode() WITHIN GROUP (ORDER BY o."category_key")) AS "category_key",
    sum(o."quantity")::bigint,
    sum(o."total_amount")
  FROM orders o
  WHERE o."deleted_at" IS NULL AND o."status_key" <> 'cancelada'
  GROUP BY o."service_name"
  ORDER BY sum(o."quantity") DESC
  LIMIT greatest(p_limit, 1);
$$;


-- tempoMedioExecucao() (metricas.ts:167)
CREATE OR REPLACE FUNCTION "public"."report_avg_lead_time"() RETURNS numeric
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  SELECT coalesce(
    avg(greatest(0, extract(epoch FROM (o."delivered_at" - o."created_at")) / 86400.0)),
    0
  )
  FROM orders o
  WHERE o."deleted_at" IS NULL
    AND o."status_key" = 'entregue'
    AND o."delivered_at" IS NOT NULL;
$$;


-- porFormaPagamento() (metricas.ts:178)
CREATE OR REPLACE FUNCTION "public"."report_payment_methods"()
    RETURNS TABLE ("method_key" text, "label" text, "color" text, "amount" numeric)
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  SELECT pm."key", pm."label", pm."color", coalesce(sum(le."amount"), 0)
  FROM payment_methods pm
  JOIN ledger_entries  le ON le."method_key" = pm."key" AND le."deleted_at" IS NULL AND le."kind" = 'income'
  JOIN ledger_statuses s  ON s."key" = le."status_key" AND s."counts_as_received"
  GROUP BY pm."key", pm."label", pm."color", pm."sort_order"
  ORDER BY pm."sort_order";
$$;


-- porResponsavel() (metricas.ts:188)
CREATE OR REPLACE FUNCTION "public"."report_by_staff"()
    RETURNS TABLE ("staff_id" uuid, "staff_name" text, "orders" bigint, "amount" numeric, "overdue" bigint)
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  SELECT
    st."id", st."name",
    count(o."id"),
    coalesce(sum(o."total_amount"), 0),
    count(o."id") FILTER (
      WHERE NOT ost."is_final"
        AND o."due_date"::date < (now() AT TIME ZONE 'America/Sao_Paulo')::date
    )
  FROM staff st
  LEFT JOIN orders         o   ON o."assigned_staff_id" = st."id"
                              AND o."deleted_at" IS NULL
                              AND o."status_key" <> 'cancelada'
  LEFT JOIN order_statuses ost ON ost."key" = o."status_key"
  WHERE st."deleted_at" IS NULL
  GROUP BY st."id", st."name"
  HAVING count(o."id") > 0
  ORDER BY count(o."id") DESC;
$$;


-- porStatus() (metricas.ts:146) — contadores das colunas do Kanban
CREATE OR REPLACE FUNCTION "public"."report_by_status"()
    RETURNS TABLE ("status_key" text, "label" text, "orders" bigint, "amount" numeric)
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  SELECT
    ost."key", ost."label",
    count(o."id"),
    coalesce(sum(o."total_amount"), 0)
  FROM order_statuses ost
  LEFT JOIN orders o ON o."status_key" = ost."key" AND o."deleted_at" IS NULL
  GROUP BY ost."key", ost."label", ost."sort_order"
  ORDER BY ost."sort_order";
$$;


-- gerarAlertas() (metricas.ts:221) — os 8 alertas do dashboard e do sino
CREATE OR REPLACE FUNCTION "public"."dashboard_alerts"() RETURNS jsonb
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
WITH
  today AS (SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date AS d),
  o AS (
    SELECT
      orders."id", orders."number", orders."status_key", orders."due_date",
      orders."balance", orders."label_printed", orders."customer_id", orders."service_name",
      ost."is_final",
      (orders."due_date"::date - (SELECT d FROM today)) AS "days_left",
      coalesce((SELECT count(*) FROM order_photos p WHERE p."order_id" = orders."id"), 0) AS "photos"
    FROM orders
    JOIN order_statuses ost ON ost."key" = orders."status_key"
    WHERE orders."deleted_at" IS NULL
  ),
  named AS (
    SELECT o.*, c."name" AS "customer_name"
    FROM o JOIN customers c ON c."id" = o."customer_id"
  )
SELECT jsonb_build_object(
  'overdue', jsonb_build_object(
    'count',  (SELECT count(*) FROM named WHERE NOT "is_final" AND "days_left" < 0),
    'sample', coalesce((SELECT jsonb_agg(x) FROM (
                 SELECT "id", "number", "customer_name", "service_name"
                 FROM named WHERE NOT "is_final" AND "days_left" < 0
                 ORDER BY "due_date" LIMIT 6
               ) x), '[]'::jsonb)
  ),
  'to_notify', jsonb_build_object(
    'count',  (SELECT count(*) FROM named WHERE "status_key" = 'pronta'),
    'sample', coalesce((SELECT jsonb_agg(x) FROM (
                 SELECT "id", "number", "customer_name", "service_name"
                 FROM named WHERE "status_key" = 'pronta'
                 ORDER BY "due_date" LIMIT 4
               ) x), '[]'::jsonb)
  ),
  'without_photo', jsonb_build_object(
    'count',  (SELECT count(*) FROM named WHERE "photos" = 0 AND NOT "is_final"),
    'sample', coalesce((SELECT jsonb_agg(x) FROM (
                 SELECT "id", "number", "customer_name", "service_name"
                 FROM named WHERE "photos" = 0 AND NOT "is_final"
                 ORDER BY "due_date" LIMIT 3
               ) x), '[]'::jsonb)
  ),
  'due_soon',       (SELECT count(*) FROM named WHERE NOT "is_final" AND "days_left" BETWEEN 0 AND 1),
  'awaiting_payment', jsonb_build_object(
    'count',  (SELECT count(*) FROM named
                WHERE "status_key" IN ('pronta', 'avisado', 'entregue') AND "balance" > 0.01),
    'amount', (SELECT coalesce(sum("balance"), 0) FROM named
                WHERE "status_key" IN ('pronta', 'avisado', 'entregue') AND "balance" > 0.01)
  ),
  'ready',          (SELECT count(*) FROM named WHERE "status_key" IN ('pronta', 'avisado')),
  'missing_label',  (SELECT count(*) FROM named WHERE NOT "label_printed" AND NOT "is_final"),
  -- "sem prazo definido": prazo absurdamente longo (metricas.ts:341)
  'no_due_date',    (SELECT count(*) FROM named WHERE NOT "is_final" AND "days_left" > 60)
);
$$;

COMMENT ON FUNCTION "public"."dashboard_alerts"() IS 'Port de gerarAlertas() (src/lib/metricas.ts:221).';


-- =====================================================================
-- Grants
-- =====================================================================
GRANT SELECT ON "public"."order_list_view"       TO "authenticated";
GRANT SELECT ON "public"."customer_summary_view" TO "authenticated";
GRANT SELECT ON "public"."ledger_list_view"      TO "authenticated";

DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'dashboard_kpis()', 'dashboard_alerts()', 'report_avg_lead_time()',
    'report_by_category()', 'report_payment_methods()', 'report_by_staff()',
    'report_by_status()', 'report_daily_intake(integer)',
    'report_monthly_finance(integer)', 'report_top_services(integer)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', fn);
  END LOOP;
END
$$;
