-- =====================================================================
-- 20260807200000 — a entrega volta a aparecer na comanda
-- ---------------------------------------------------------------------
-- DEFEITO DEIXADO PELA 20260807100000
--
-- O bloco 1 (20260806200000) criou `orders.delivered_to_name`,
-- `delivered_to_document`, `delivery_note` e `delivered_by`, gravados por
-- `change_order_status`.
--
-- O bloco 3 moveu a entrega para o item: `change_order_status` virou
-- fan-out e quem grava agora é `change_order_item_status`, em
-- `order_items`. As quatro colunas de `orders` ficaram órfãs — existem,
-- ninguém preenche.
--
-- Efeito visível: ReciboEntrega.tsx e a aba "Visão geral" leem
-- `comanda.entreguePara`. O comprovante que o cliente assina sairia com
-- "Retirado por —" mesmo depois de a entrega ter sido registrada com
-- nome e documento no item.
--
-- Encontrado ao reexecutar o teste do bloco 1 depois do bloco 5 — ele
-- ainda conferia as colunas da comanda, que era o contrato original.
--
-- A CORREÇÃO
--
-- Segue o padrão que o bloco 3 estabeleceu: `orders` é espelho. A entrega
-- da comanda passa a ser derivada da ÚLTIMA peça que saiu — que é a
-- pessoa que assinou por último, e a data que fecha a comanda.
-- =====================================================================

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
  v_ent        public.order_items;
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

  -- Espelho da entrega: a ÚLTIMA peça que saiu. É quem assinou por último
  -- e a data que fecha a comanda — e é o que o recibo imprime.
  SELECT i.* INTO v_ent
  FROM public.order_items i
  WHERE i."order_id" = p_order_id AND i."delivered_at" IS NOT NULL
  ORDER BY i."delivered_at" DESC
  LIMIT 1;

  UPDATE public.orders o
  SET "total_amount"          = v_total,
      "quantity"              = v_qty,
      "service_name"          = v_nome,
      "service_id"            = v_service,
      "category_key"          = v_cat,
      "assigned_staff_id"     = v_staff,
      "due_date"              = v_due,
      "delivered_at"          = coalesce(o."delivered_at", v_entregue),
      "status_key"            = v_status,
      "is_rework"             = (v_retrab = v_itens),
      "delivered_to_name"     = coalesce(v_ent."delivered_to_name", ''),
      "delivered_to_document" = coalesce(v_ent."delivered_to_document", ''),
      "delivery_note"         = coalesce(v_ent."delivery_note", ''),
      "delivered_by"          = v_ent."delivered_by"
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
      OR o."delivered_to_name" IS DISTINCT FROM coalesce(v_ent."delivered_to_name", '')
      OR o."delivered_by"   IS DISTINCT FROM v_ent."delivered_by"
    );
END;
$$;

-- A trigger precisa acordar também quando a ENTREGA do item muda.
DROP TRIGGER IF EXISTS "order_items_sync_order" ON "public"."order_items";
CREATE TRIGGER "order_items_sync_order"
    AFTER INSERT OR DELETE OR UPDATE OF
      "status_key", "quantity", "total_amount", "service_name", "service_id",
      "category_key", "assigned_staff_id", "due_date", "delivered_at", "position",
      "parent_item_id", "delivered_to_name", "delivered_by"
    ON "public"."order_items"
    FOR EACH ROW EXECUTE FUNCTION "public"."trg_order_items_sync_order"();

-- Reconcilia o que já está no banco.
DO $reconcilia$
DECLARE r record;
BEGIN
  FOR r IN SELECT DISTINCT "order_id" FROM public.order_items LOOP
    PERFORM public.recalc_order_from_items(r."order_id");
  END LOOP;
END
$reconcilia$;
