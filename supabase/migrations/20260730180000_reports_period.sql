-- =====================================================================
-- 20260730180000 — Recorte de período nas RPCs de relatório
-- ---------------------------------------------------------------------
-- PROBLEMA
--
-- A tela /relatorios tem um seletor de Período (30 dias / 90 dias / ano /
-- tudo) que não chegava a lugar nenhum: nenhuma das oito `report_*`
-- aceitava data, e o rodapé continuava dizendo "121 comandas no recorte"
-- em qualquer opção. Categoria e Responsável funcionavam, o que fazia o
-- defeito parecer aleatório.
--
-- Todo fechamento mensal saía com a base inteira, sem o operador notar.
--
-- DROP + CREATE, NÃO "CREATE OR REPLACE ... DEFAULT NULL"
--
-- Acrescentar parâmetro com DEFAULT NÃO substitui a função de zero
-- argumentos — cria uma IRMÃ. A partir daí `report_by_category()` teria
-- dois candidatos e o Postgres levantaria `42725 ambiguous_function` na
-- CHAMADA, não no CREATE: a migration aplicaria limpa e a tela quebraria
-- em produção. `DROP` (sem CASCADE, para não levar dependente junto) na
-- mesma transação deixa uma função por nome.
--
-- DROP leva os GRANTs junto, então todos são reemitidos no fim.
--
-- CONVENÇÃO DO RECORTE
--
--   p_from / p_to são DATE, inclusivos nas duas pontas, NULL = sem limite.
--
-- Datas simples porque quem escolhe "últimos 30 dias" pensa em dia; a
-- conversão de fuso fica no banco, num lugar só. O padrão é sempre:
--
--   AND (p_from IS NULL OR col >= (p_from::timestamp AT TIME ZONE '<tz>'))
--   AND (p_to   IS NULL OR col <  ((p_to + 1)::timestamp AT TIME ZONE '<tz>'))
--
-- Sem `::date` na coluna (preserva o índice e evita o viés de UTC que o
-- código atual carrega em `o."created_at"::date`), e `p_to + 1` com `<`
-- para não perder o último dia.
--
-- `p_days` / `p_months` / `p_limit` continuam existindo e são IGNORADOS
-- quando p_from/p_to vêm preenchidos.
--
-- ⚠️ Este arquivo NÃO pode conter `dashboard_kpis`. Ela mora no mesmo
-- arquivo original que as `report_*` (20260729121300), e copiar o bloco
-- inteiro faria um CREATE OR REPLACE reverter em silêncio a correção de
-- vazamento da 20260730150000.
-- =====================================================================

DROP FUNCTION IF EXISTS "public"."report_by_category"();
DROP FUNCTION IF EXISTS "public"."report_by_staff"();
DROP FUNCTION IF EXISTS "public"."report_by_status"();
DROP FUNCTION IF EXISTS "public"."report_payment_methods"();
DROP FUNCTION IF EXISTS "public"."report_avg_lead_time"();
DROP FUNCTION IF EXISTS "public"."report_daily_intake"(integer);
DROP FUNCTION IF EXISTS "public"."report_monthly_finance"(integer);
DROP FUNCTION IF EXISTS "public"."report_top_services"(integer);


-- ---------------------------------------------------------------------
-- porCategoria()
-- ---------------------------------------------------------------------
-- O predicado de período vai no ON do LEFT JOIN, não no WHERE. No WHERE
-- o LEFT JOIN degeneraria em INNER e as categorias sem comanda na janela
-- sumiriam — mas o HAVING já cuida disso aqui, e manter no ON deixa as
-- três funções de agrupamento com a mesma forma.
CREATE FUNCTION "public"."report_by_category"(
  "p_from" date DEFAULT NULL,
  "p_to"   date DEFAULT NULL
)
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
   AND (p_from IS NULL OR o."created_at" >= (p_from::timestamp AT TIME ZONE 'America/Sao_Paulo'))
   AND (p_to   IS NULL OR o."created_at" <  ((p_to + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo'))
  GROUP BY sc."key", sc."label", sc."color", sc."sort_order"
  HAVING count(o."id") > 0
  ORDER BY count(o."id") DESC;
$$;


-- ---------------------------------------------------------------------
-- porStatus()
-- ---------------------------------------------------------------------
-- Aqui o ON é OBRIGATÓRIO: esta função alimenta os contadores por coluna
-- do Kanban, e no WHERE as colunas sem comanda no período sumiriam da
-- tela em vez de aparecer com zero.
CREATE FUNCTION "public"."report_by_status"(
  "p_from" date DEFAULT NULL,
  "p_to"   date DEFAULT NULL
)
    RETURNS TABLE ("status_key" text, "label" text, "orders" bigint, "amount" numeric)
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  SELECT
    ost."key", ost."label",
    count(o."id"),
    coalesce(sum(o."total_amount"), 0)
  FROM order_statuses ost
  LEFT JOIN orders o
    ON o."status_key" = ost."key"
   AND o."deleted_at" IS NULL
   AND (p_from IS NULL OR o."created_at" >= (p_from::timestamp AT TIME ZONE 'America/Sao_Paulo'))
   AND (p_to   IS NULL OR o."created_at" <  ((p_to + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo'))
  GROUP BY ost."key", ost."label", ost."sort_order"
  ORDER BY ost."sort_order";
$$;


-- ---------------------------------------------------------------------
-- porResponsavel()
-- ---------------------------------------------------------------------
CREATE FUNCTION "public"."report_by_staff"(
  "p_from" date DEFAULT NULL,
  "p_to"   date DEFAULT NULL
)
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
                              AND (p_from IS NULL OR o."created_at" >= (p_from::timestamp AT TIME ZONE 'America/Sao_Paulo'))
                              AND (p_to   IS NULL OR o."created_at" <  ((p_to + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo'))
  LEFT JOIN order_statuses ost ON ost."key" = o."status_key"
  WHERE st."deleted_at" IS NULL
  GROUP BY st."id", st."name"
  HAVING count(o."id") > 0
  ORDER BY count(o."id") DESC;
$$;


-- ---------------------------------------------------------------------
-- porFormaPagamento() — eixo é a data do LANÇAMENTO
-- ---------------------------------------------------------------------
CREATE FUNCTION "public"."report_payment_methods"(
  "p_from" date DEFAULT NULL,
  "p_to"   date DEFAULT NULL
)
    RETURNS TABLE ("method_key" text, "label" text, "color" text, "amount" numeric)
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  SELECT pm."key", pm."label", pm."color", coalesce(sum(le."amount"), 0)
  FROM payment_methods pm
  JOIN ledger_entries  le ON le."method_key" = pm."key" AND le."deleted_at" IS NULL AND le."kind" = 'income'
                         AND (p_from IS NULL OR le."entry_date" >= (p_from::timestamp AT TIME ZONE 'America/Sao_Paulo'))
                         AND (p_to   IS NULL OR le."entry_date" <  ((p_to + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo'))
  JOIN ledger_statuses s  ON s."key" = le."status_key" AND s."counts_as_received"
  GROUP BY pm."key", pm."label", pm."color", pm."sort_order"
  ORDER BY pm."sort_order";
$$;


-- ---------------------------------------------------------------------
-- tempoMedioExecucao() — eixo é `delivered_at`, NÃO `created_at`
-- ---------------------------------------------------------------------
-- É o único onde o eixo não é óbvio, e escolher `created_at` produziria
-- viés de sobrevivência: comandas abertas no fim da janela ainda não
-- foram entregues, o filtro pegaria só as rápidas e o "tempo médio"
-- cairia artificialmente todo fim de mês. Com `delivered_at` a resposta
-- é "o que a loja ENTREGOU neste período demorou quanto", que é a
-- pergunta real.
CREATE FUNCTION "public"."report_avg_lead_time"(
  "p_from" date DEFAULT NULL,
  "p_to"   date DEFAULT NULL
)
    RETURNS numeric
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
    AND o."delivered_at" IS NOT NULL
    AND (p_from IS NULL OR o."delivered_at" >= (p_from::timestamp AT TIME ZONE 'America/Sao_Paulo'))
    AND (p_to   IS NULL OR o."delivered_at" <  ((p_to + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo'));
$$;


-- ---------------------------------------------------------------------
-- serieAtendimentos()
-- ---------------------------------------------------------------------
-- Com p_from/p_to a série cobre a janela pedida; sem eles, os últimos
-- p_days dias. O teto de 180 pontos evita que "tudo" gere milhares de
-- linhas para um gráfico de largura fixa — antes a proteção estava no
-- lado errado (um `Math.min(dias, 60)` no front).
CREATE FUNCTION "public"."report_daily_intake"(
  "p_days" integer DEFAULT 14,
  "p_from" date DEFAULT NULL,
  "p_to"   date DEFAULT NULL
)
    RETURNS TABLE ("day" date, "orders" bigint, "amount" numeric)
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  WITH janela AS (
    SELECT
      coalesce(p_to, (now() AT TIME ZONE 'America/Sao_Paulo')::date) AS fim,
      coalesce(
        p_from,
        (now() AT TIME ZONE 'America/Sao_Paulo')::date - (greatest(p_days, 1) - 1)
      ) AS ini
  ),
  limitada AS (
    SELECT fim, greatest(ini, fim - 179) AS ini FROM janela
  )
  SELECT
    d::date                            AS "day",
    count(o."id")                      AS "orders",
    coalesce(sum(o."total_amount"), 0) AS "amount"
  FROM limitada,
       generate_series(limitada.ini, limitada.fim, interval '1 day') d
  LEFT JOIN orders o
    ON o."created_at"::date = d::date AND o."deleted_at" IS NULL
  GROUP BY d
  ORDER BY d;
$$;


-- ---------------------------------------------------------------------
-- serieFaturamento() — eixo é a data do LANÇAMENTO
-- ---------------------------------------------------------------------
CREATE FUNCTION "public"."report_monthly_finance"(
  "p_months" integer DEFAULT 12,
  "p_from"   date DEFAULT NULL,
  "p_to"     date DEFAULT NULL
)
    RETURNS TABLE ("month" date, "received" numeric, "expense" numeric, "pending" numeric)
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  WITH janela AS (
    SELECT
      date_trunc('month', coalesce(p_to::timestamp, now()))::date AS fim,
      coalesce(
        date_trunc('month', p_from::timestamp)::date,
        (date_trunc('month', now()) - ((greatest(p_months, 1) - 1) || ' months')::interval)::date
      ) AS ini
  ),
  months AS (
    SELECT d::date AS m
    FROM janela, generate_series(janela.ini, janela.fim, interval '1 month') d
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


-- ---------------------------------------------------------------------
-- topServicos()
-- ---------------------------------------------------------------------
CREATE FUNCTION "public"."report_top_services"(
  "p_limit" integer DEFAULT 8,
  "p_from"  date DEFAULT NULL,
  "p_to"    date DEFAULT NULL
)
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
    AND (p_from IS NULL OR o."created_at" >= (p_from::timestamp AT TIME ZONE 'America/Sao_Paulo'))
    AND (p_to   IS NULL OR o."created_at" <  ((p_to + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo'))
  GROUP BY o."service_name"
  ORDER BY sum(o."quantity") DESC
  LIMIT greatest(p_limit, 1);
$$;


-- ---------------------------------------------------------------------
-- Comentários e grants (DROP levou os anteriores junto)
-- ---------------------------------------------------------------------
COMMENT ON FUNCTION "public"."report_by_category"(date, date) IS
  'porCategoria(). p_from/p_to inclusivos sobre orders.created_at; NULL = sem limite.';
COMMENT ON FUNCTION "public"."report_by_status"(date, date) IS
  'porStatus(). Período no ON do LEFT JOIN: status sem comanda na janela aparece com zero.';
COMMENT ON FUNCTION "public"."report_by_staff"(date, date) IS
  'porResponsavel(). Período sobre orders.created_at.';
COMMENT ON FUNCTION "public"."report_payment_methods"(date, date) IS
  'porFormaPagamento(). Período sobre ledger_entries.entry_date.';
COMMENT ON FUNCTION "public"."report_avg_lead_time"(date, date) IS
  'tempoMedioExecucao(). Período sobre delivered_at — created_at daria viés de sobrevivência.';
COMMENT ON FUNCTION "public"."report_daily_intake"(integer, date, date) IS
  'serieAtendimentos(). p_days é ignorado quando p_from/p_to vêm preenchidos. Teto de 180 pontos.';
COMMENT ON FUNCTION "public"."report_monthly_finance"(integer, date, date) IS
  'serieFaturamento(). p_months é ignorado quando p_from/p_to vêm preenchidos.';
COMMENT ON FUNCTION "public"."report_top_services"(integer, date, date) IS
  'topServicos(). p_limit continua valendo; p_from/p_to recortam o período.';

DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'report_by_category(date, date)',
    'report_by_status(date, date)',
    'report_by_staff(date, date)',
    'report_payment_methods(date, date)',
    'report_avg_lead_time(date, date)',
    'report_daily_intake(integer, date, date)',
    'report_monthly_finance(integer, date, date)',
    'report_top_services(integer, date, date)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', fn);
  END LOOP;
END $$;

-- Se o pgrst_ddl_watch do self-hosted falhar, sem isto as RPCs voltam
-- PGRST202 até o container reiniciar.
NOTIFY pgrst, 'reload schema';
