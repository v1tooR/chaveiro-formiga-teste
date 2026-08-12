-- =====================================================================
-- 20260807170000 — garantia e retrabalho
-- ---------------------------------------------------------------------
-- Bloco 5 de docs/06-fluxo-do-usuario.md.
--
-- O PROBLEMA
--
-- O conceito não existia em coluna, status ou vínculo. Cliente que volta
-- com o mesmo problema abria comanda nova, desligada da original. Não
-- dava para honrar garantia com rastro nem medir retrabalho — que é o
-- indicador que diz se a oficina está indo bem.
--
-- ⚠️ COMO NO BLOCO 4, O CHECKLIST ENVELHECEU
--
-- docs/06 falava em `orders.parent_order_id`. O bloco 3 moveu status e
-- entrega para o ITEM, e é o item que tem garantia: a garantia começa
-- quando AQUELA peça foi entregue, e o retrabalho é daquela peça. Numa
-- comanda de três itens, dois podem estar na garantia e um não.
--
-- Por isso o vínculo é `order_items.parent_item_id`.
--
-- O QUE NÃO FOI TOCADO, DE PROPÓSITO
--
-- `create_order` não foi reescrito. O retrabalho tem RPC própria
-- (`create_rework`), e o instantâneo da garantia entra por trigger. Era a
-- terceira reescrita completa daquela função em três migrations, e cada
-- transcrição de 200 linhas é uma chance nova de introduzir defeito onde
-- não havia.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Garantia no catálogo e no item
-- ---------------------------------------------------------------------
ALTER TABLE "public"."services"
  ADD COLUMN "warranty_days" integer NOT NULL DEFAULT 0,
  ADD CONSTRAINT "services_warranty_min" CHECK ("warranty_days" >= 0);

COMMENT ON COLUMN "public"."services"."warranty_days" IS
  'Dias de garantia do serviço. 0 = sem garantia. Copiado para o item na venda.';

ALTER TABLE "public"."order_items"
  ADD COLUMN "warranty_days" integer NOT NULL DEFAULT 0,
  ADD COLUMN "parent_item_id" uuid
    REFERENCES "public"."order_items"("id") ON DELETE SET NULL,
  -- GENERATED e não coluna solta: "é retrabalho" e "tem item de origem"
  -- são a mesma informação, e mantê-las em dois lugares é convite a
  -- divergirem.
  ADD COLUMN "is_rework" boolean
    GENERATED ALWAYS AS ("parent_item_id" IS NOT NULL) STORED;

CREATE INDEX "order_items_parent_idx" ON "public"."order_items" ("parent_item_id")
  WHERE "parent_item_id" IS NOT NULL;

COMMENT ON COLUMN "public"."order_items"."warranty_days" IS
  'Instantâneo da garantia na venda — o catálogo pode mudar depois, o combinado com o cliente não.';
COMMENT ON COLUMN "public"."order_items"."parent_item_id" IS
  'Item original que este retrabalho refaz. A garantia conta a partir do delivered_at DAQUELE item.';

-- Instantâneo da garantia sem tocar em create_order: quem insere item —
-- a RPC, o backfill ou o seed — recebe o valor do catálogo de graça.
CREATE OR REPLACE FUNCTION "public"."trg_order_items_warranty"() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  IF NEW."warranty_days" = 0 AND NEW."service_id" IS NOT NULL THEN
    SELECT coalesce(s."warranty_days", 0) INTO NEW."warranty_days"
    FROM public.services s WHERE s."id" = NEW."service_id";
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "order_items_warranty"
    BEFORE INSERT ON "public"."order_items"
    FOR EACH ROW EXECUTE FUNCTION "public"."trg_order_items_warranty"();

-- ---------------------------------------------------------------------
-- 2. Comanda de valor zero passa a ser legal
-- ---------------------------------------------------------------------
-- ⚠️ Sem isto o retrabalho em garantia é impossível: uma comanda cujo
-- único item vale R$ 0,00 violava `orders_total_positive`.
--
-- Afrouxar não abre a porta para comanda vazia por engano: `create_order`
-- continua recusando total <= 0. Só `create_rework` cria comanda de valor
-- zero, e ela é explícita sobre isso.
ALTER TABLE "public"."orders" DROP CONSTRAINT "orders_total_positive";
ALTER TABLE "public"."orders"
  ADD CONSTRAINT "orders_total_min" CHECK ("total_amount" >= 0);

-- Espelho: comanda é retrabalho quando TODOS os itens dela são.
ALTER TABLE "public"."orders"
  ADD COLUMN "is_rework" boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN "public"."orders"."is_rework" IS
  'Derivado de order_items (recalc_order_from_items). Serve para tirar retrabalho gratuito do ticket médio.';

-- ---------------------------------------------------------------------
-- 3. A derivação passa a cuidar de is_rework
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."recalc_order_from_items"("p_order_id" uuid)
    RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_total      numeric(12,2);
  v_qty        integer;
  v_itens      integer;
  v_abertos    integer;
  v_cancelados integer;
  v_retrab     integer;
  v_status     text;
  v_nome       text;
  v_extra      integer;
  v_service    uuid;
  v_cat        text;
  v_staff      uuid;
  v_entregue   timestamptz;
  v_due        timestamptz;
BEGIN
  SELECT
    count(*),
    coalesce(sum(i."total_amount"), 0),
    coalesce(sum(i."quantity"), 0),
    count(*) FILTER (WHERE i."status_key" = 'cancelada'),
    count(*) FILTER (WHERE i."status_key" NOT IN ('entregue', 'cancelada')),
    count(*) FILTER (WHERE i."is_rework"),
    min(i."due_date"),
    max(i."delivered_at")
  INTO v_itens, v_total, v_qty, v_cancelados, v_abertos, v_retrab, v_due, v_entregue
  FROM public.order_items i
  WHERE i."order_id" = p_order_id;

  IF v_itens = 0 THEN
    RETURN;
  END IF;

  SELECT i."service_name", i."service_id", i."category_key"
  INTO v_nome, v_service, v_cat
  FROM public.order_items i
  WHERE i."order_id" = p_order_id
  ORDER BY i."position"
  LIMIT 1;

  v_extra := v_itens - 1;
  IF v_extra > 0 THEN
    v_nome := v_nome || ' +' || v_extra;
    v_service := NULL;
  END IF;

  -- `array_agg(DISTINCT ...)[1]` e não `min()`: o Postgres não define
  -- min() para uuid, e o erro só aparece em tempo de execução — dentro da
  -- trigger, o que derruba qualquer INSERT de item.
  SELECT CASE WHEN count(DISTINCT i."assigned_staff_id") = 1
              THEN (array_agg(DISTINCT i."assigned_staff_id"))[1] END
  INTO v_staff
  FROM public.order_items i
  WHERE i."order_id" = p_order_id AND i."assigned_staff_id" IS NOT NULL;

  IF v_cancelados = v_itens THEN
    v_status := 'cancelada';
  ELSIF v_abertos = 0 THEN
    v_status := 'entregue';
  ELSE
    SELECT i."status_key" INTO v_status
    FROM public.order_items i
    JOIN public.order_statuses s ON s."key" = i."status_key"
    WHERE i."order_id" = p_order_id
      AND i."status_key" NOT IN ('entregue', 'cancelada')
    ORDER BY s."sort_order"
    LIMIT 1;
    v_entregue := NULL;
  END IF;

  UPDATE public.orders o
  SET "total_amount"      = v_total,
      "quantity"          = v_qty,
      "service_name"      = v_nome,
      "service_id"        = v_service,
      "category_key"      = v_cat,
      "assigned_staff_id" = v_staff,
      "due_date"          = v_due,
      "delivered_at"      = coalesce(o."delivered_at", v_entregue),
      "status_key"        = v_status,
      -- Comanda mista (um item novo + um retrabalho) NÃO é retrabalho:
      -- ela fatura, e tirá-la do ticket médio esconderia receita real.
      "is_rework"         = (v_retrab = v_itens)
  WHERE o."id" = p_order_id
    AND (
      o."total_amount"      IS DISTINCT FROM v_total
      OR o."quantity"       IS DISTINCT FROM v_qty
      OR o."service_name"   IS DISTINCT FROM v_nome
      OR o."service_id"     IS DISTINCT FROM v_service
      OR o."category_key"   IS DISTINCT FROM v_cat
      OR o."assigned_staff_id" IS DISTINCT FROM v_staff
      OR o."due_date"       IS DISTINCT FROM v_due
      OR o."status_key"     IS DISTINCT FROM v_status
      OR o."is_rework"      IS DISTINCT FROM (v_retrab = v_itens)
    );
END;
$$;

-- A trigger precisa reagir também ao vínculo de retrabalho.
DROP TRIGGER IF EXISTS "order_items_sync_order" ON "public"."order_items";
CREATE TRIGGER "order_items_sync_order"
    AFTER INSERT OR DELETE OR UPDATE OF
      "status_key", "quantity", "total_amount", "service_name", "service_id",
      "category_key", "assigned_staff_id", "due_date", "delivered_at", "position",
      "parent_item_id"
    ON "public"."order_items"
    FOR EACH ROW EXECUTE FUNCTION "public"."trg_order_items_sync_order"();

-- ---------------------------------------------------------------------
-- 4. create_rework — abre a comanda de retrabalho vinculada
-- ---------------------------------------------------------------------
-- RPC própria em vez de um caminho dentro de create_order: o retrabalho
-- não tem entrada, não tem escolha de serviço (é o mesmo) e por padrão
-- não tem valor. Enfiar isso na RPC de venda deixaria as duas piores.
CREATE OR REPLACE FUNCTION "public"."create_rework"(
  "p_item_id" uuid,
  "p_payload" jsonb DEFAULT '{}'::jsonb
)
    RETURNS "public"."orders"
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_origem   public.order_items;
  v_ordem    public.orders;
  v_nova     public.orders;
  v_item     public.order_items;
  v_number   integer;
  v_valor    numeric(12,2);
  v_motivo   text;
  v_due      timestamptz;
  v_garantia boolean;
  v_cat      uuid;
BEGIN
  IF NOT (public.can_write('service_desk') OR public.can_write('orders')) THEN
    RAISE EXCEPTION 'Sem permissão para abrir retrabalho.' USING ERRCODE = '42501';
  END IF;

  SELECT i.* INTO v_origem FROM public.order_items i WHERE i."id" = p_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item de origem não encontrado.' USING ERRCODE = 'P0001';
  END IF;

  IF v_origem."delivered_at" IS NULL THEN
    RAISE EXCEPTION 'Só se abre retrabalho de item já entregue — este ainda está na loja.'
      USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_ordem FROM public.orders WHERE "id" = v_origem."order_id";

  v_motivo := btrim(coalesce(p_payload->>'reason', ''));
  IF v_motivo = '' THEN
    RAISE EXCEPTION 'Descreva o que o cliente relatou para abrir o retrabalho.'
      USING ERRCODE = '23514';
  END IF;

  -- Dentro da garantia é o padrão; fora dela o retrabalho existe do mesmo
  -- jeito, mas cobrando. Quem decide é o balcão, e o valor vem no payload.
  v_garantia := v_origem."warranty_days" > 0
                AND v_origem."delivered_at" + make_interval(days => v_origem."warranty_days") >= now();

  v_valor := round(coalesce((p_payload->>'total_amount')::numeric, 0), 2);
  IF v_valor < 0 THEN
    RAISE EXCEPTION 'O valor do retrabalho não pode ser negativo.' USING ERRCODE = '23514';
  END IF;

  v_due := coalesce(
    (p_payload->>'due_date')::timestamptz,
    now() + make_interval(days => greatest(1, coalesce((
      SELECT s."lead_time_days" FROM public.services s WHERE s."id" = v_origem."service_id"
    ), 2)))
  );

  UPDATE public.app_settings
  SET "order_next_number" = "order_next_number" + 1
  WHERE "id"
  RETURNING "order_next_number" - 1 INTO v_number;

  INSERT INTO public.orders (
    "number", "customer_id", "category_key", "service_id", "service_name",
    "description", "quantity", "notes", "due_date", "assigned_staff_id",
    "status_key", "total_amount", "down_payment", "created_by"
  )
  VALUES (
    v_number, v_ordem."customer_id", v_origem."category_key",
    v_origem."service_id", v_origem."service_name",
    v_motivo, 1,
    'Retrabalho da comanda ' || v_ordem."number" ||
      CASE WHEN v_garantia THEN ' · em garantia' ELSE ' · fora da garantia' END,
    v_due, v_origem."assigned_staff_id", 'recebida', v_valor, 0, auth.uid()
  )
  RETURNING * INTO v_nova;

  INSERT INTO public.order_items (
    "order_id", "position", "category_key", "service_id", "service_name",
    "description", "quantity", "total_amount", "due_date", "assigned_staff_id",
    "status_key", "parent_item_id", "created_by"
  )
  VALUES (
    v_nova."id", 1, v_origem."category_key", v_origem."service_id", v_origem."service_name",
    v_motivo, 1, v_valor, v_due, v_origem."assigned_staff_id",
    'recebida', p_item_id, auth.uid()
  )
  RETURNING * INTO v_item;

  PERFORM public.log_order_event(
    v_nova."id", 'Retrabalho aberto',
    'Refaz ' || v_origem."service_name" || ' da comanda ' || v_ordem."number" ||
    CASE WHEN v_garantia THEN ' (em garantia)' ELSE ' (fora da garantia)' END
  );

  -- Rastro nos DOIS lados: quem abre a comanda original precisa saber que
  -- a peça voltou, sem ter de procurar.
  PERFORM public.log_order_event(
    v_ordem."id", 'Peça retornou para retrabalho',
    v_origem."service_name" || ' · nova comanda ' || v_number || ' · ' || v_motivo
  );

  -- Pendência só quando há o que cobrar. Retrabalho em garantia não gera
  -- lançamento nenhum — nem de valor zero, que sujaria o financeiro.
  IF v_valor > 0.01 THEN
    SELECT "id" INTO v_cat
    FROM public.ledger_categories
    WHERE "kind" = 'income' AND "is_system" AND "name" = 'Outros recebimentos'
      AND "deleted_at" IS NULL
    LIMIT 1;

    IF v_cat IS NOT NULL THEN
      INSERT INTO public.ledger_entries (
        "kind", "description", "category_id", "amount", "entry_date", "status_key",
        "order_id", "customer_id", "staff_id", "auto_generated", "auto_role", "created_by"
      )
      VALUES (
        'income', 'Retrabalho · ' || v_origem."service_name", v_cat, v_valor, v_due,
        'pendente', v_nova."id", v_ordem."customer_id", v_origem."assigned_staff_id",
        true, 'receivable', auth.uid()
      );
    END IF;
  END IF;

  SELECT * INTO v_nova FROM public.orders WHERE "id" = v_nova."id";
  RETURN v_nova;
END;
$$;

GRANT EXECUTE ON FUNCTION "public"."create_rework"(uuid, jsonb) TO "authenticated";

-- ---------------------------------------------------------------------
-- 5. Garantia visível — view por item
-- ---------------------------------------------------------------------
-- `warranty_until` não vira coluna GENERATED porque `timestamptz +
-- interval` é STABLE, não IMMUTABLE (depende do fuso), e o Postgres
-- recusa em coluna gerada.
CREATE OR REPLACE VIEW "public"."order_item_warranty_view"
    WITH (security_invoker = true)
    AS
SELECT
  i."id" AS "order_item_id",
  i."order_id",
  o."number" AS "order_number",
  i."position",
  i."service_name",
  i."warranty_days",
  i."delivered_at",
  CASE WHEN i."delivered_at" IS NOT NULL AND i."warranty_days" > 0
       THEN i."delivered_at" + make_interval(days => i."warranty_days") END AS "warranty_until",
  (i."delivered_at" IS NOT NULL
   AND i."warranty_days" > 0
   AND i."delivered_at" + make_interval(days => i."warranty_days") >= now()) AS "in_warranty",
  i."is_rework",
  i."parent_item_id",
  (SELECT count(*) FROM public.order_items r WHERE r."parent_item_id" = i."id") AS "rework_count"
FROM "public"."order_items" i
JOIN "public"."orders" o ON o."id" = i."order_id"
WHERE o."deleted_at" IS NULL;

GRANT SELECT ON "public"."order_item_warranty_view" TO "authenticated";

-- ---------------------------------------------------------------------
-- 6. Relatório de retrabalho
-- ---------------------------------------------------------------------
-- Taxa = retrabalhos abertos / itens entregues, na janela. É o indicador
-- que diz se a oficina está indo bem — e o motivo de o vínculo existir.
CREATE OR REPLACE FUNCTION "public"."report_rework"(
  "p_from" date DEFAULT NULL,
  "p_to"   date DEFAULT NULL
)
    RETURNS TABLE (
      "grupo"        text,
      "service_name" text,
      "staff_name"   text,
      "entregues"    bigint,
      "retrabalhos"  bigint,
      "taxa"         numeric
    )
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  WITH janela AS (
    SELECT i.*
    FROM order_items i
    JOIN orders o ON o."id" = i."order_id"
    WHERE o."deleted_at" IS NULL
      AND i."status_key" <> 'cancelada'
      AND (p_from IS NULL OR o."created_at" >= (p_from::timestamp AT TIME ZONE 'America/Sao_Paulo'))
      AND (p_to   IS NULL OR o."created_at" <  ((p_to + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo'))
  ),
  por_servico AS (
    SELECT
      'servico'::text                                   AS grupo,
      j."service_name",
      NULL::text                                        AS staff_name,
      count(*) FILTER (WHERE NOT j."is_rework")::bigint AS entregues,
      count(*) FILTER (WHERE j."is_rework")::bigint     AS retrabalhos
    FROM janela j
    GROUP BY j."service_name"
  ),
  por_staff AS (
    SELECT
      'responsavel'::text                               AS grupo,
      NULL::text                                        AS service_name,
      coalesce(st."name", 'Sem responsável')            AS staff_name,
      count(*) FILTER (WHERE NOT j."is_rework")::bigint AS entregues,
      count(*) FILTER (WHERE j."is_rework")::bigint     AS retrabalhos
    FROM janela j
    LEFT JOIN staff st ON st."id" = j."assigned_staff_id"
    GROUP BY coalesce(st."name", 'Sem responsável')
  ),
  tudo AS (SELECT * FROM por_servico UNION ALL SELECT * FROM por_staff)
  SELECT
    t.grupo, t.service_name, t.staff_name, t.entregues, t.retrabalhos,
    CASE WHEN t.entregues = 0 THEN 0
         ELSE round(100.0 * t.retrabalhos / t.entregues, 1) END
  FROM tudo t
  WHERE t.retrabalhos > 0 OR t.entregues > 0
  ORDER BY t.grupo, t.retrabalhos DESC, t.entregues DESC;
$$;

GRANT EXECUTE ON FUNCTION "public"."report_rework"(date, date) TO "authenticated";

-- ---------------------------------------------------------------------
-- 7. Retrabalho gratuito fora do ticket medio
-- ---------------------------------------------------------------------
-- `average_ticket` era avg(total_amount) sobre toda comanda nao
-- cancelada. Com retrabalho em garantia valendo R$ 0,00, cada peca que
-- volta puxava o ticket medio para baixo — e o indicador passaria a
-- medir a taxa de retrabalho em vez do valor do servico.
--
-- Contagens (abertas, em execucao, prontas) CONTINUAM incluindo
-- retrabalho: a peca esta fisicamente na loja e ocupa a bancada.
--
-- Corpo extraido de pg_get_functiondef, com uma unica linha alterada.
CREATE OR REPLACE FUNCTION public.dashboard_kpis()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
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
      THEN (SELECT coalesce(avg(o."total_amount"), 0) FROM o
             WHERE o."status_key" <> 'cancelada' AND NOT o."is_rework")
      ELSE NULL END,

  -- Contagem, não valor: o balcão precisa saber quantos clientes chamar.
  'delivered_unpaid',   (SELECT count(*) FROM o WHERE o."status_key" = 'entregue' AND o."balance" > 0.01),

  -- O front usa isto para decidir entre esconder o indicador e mostrar 0.
  'can_read_finance',   (SELECT ve_financeiro FROM perm)
);
$function$


