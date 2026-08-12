-- =====================================================================
-- 20260730200000 — Edição de comanda: serviço, cliente, categoria e guardas
-- ---------------------------------------------------------------------
-- A edição só aceitava valor, quantidade, descrição, observação, prazo e
-- responsável. Errar o SERVIÇO ou o CLIENTE obrigava a cancelar a comanda
-- e refazer — perdendo número, histórico e as fotos já anexadas.
--
-- Duas guardas entram junto, e a segunda fecha um buraco real:
--
--   1. Comanda em status FINAL não é editável. O front já bloqueava; o
--      banco aceitava. Um POST direto no PostgREST alterava comanda
--      entregue sem deixar rastro de que aquilo deveria ser impossível.
--
--   2. `total_amount` não pode ficar abaixo de `amount_paid`. Isto era
--      validado SÓ no front ("O valor não pode ser menor que o já pago").
--      Como `balance` é `greatest(0, total - paid)`, baixar o total abaixo
--      do pago zerava o saldo em silêncio e o dinheiro recebido a mais
--      sumia da conciliação.
--
-- Trocar o CLIENTE exige recalcular o status dos dois lados: o antigo
-- pode deixar de ter pendência, o novo pode passar a ter.
-- =====================================================================

CREATE OR REPLACE FUNCTION "public"."update_order"(
    "p_order_id"    uuid,
    "p_patch"       jsonb,
    "p_event_title" text DEFAULT NULL
) RETURNS "public"."orders"
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_order        public.orders;
  v_antes        public.orders;
  v_final        boolean;
  v_novo_total   numeric(12,2);
  v_servico      public.services;
BEGIN
  IF NOT (public.can_write('orders') OR public.can_write('production')) THEN
    RAISE EXCEPTION 'Sem permissão para editar comandas.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_antes FROM public.orders
  WHERE "id" = p_order_id AND "deleted_at" IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Comanda não encontrada.' USING ERRCODE = 'P0002';
  END IF;

  SELECT ost."is_final" INTO v_final
  FROM public.order_statuses ost WHERE ost."key" = v_antes."status_key";

  IF v_final THEN
    RAISE EXCEPTION
      'Comanda % está finalizada e não pode mais ser editada.', v_antes."number"
      USING ERRCODE = '42501';
  END IF;

  -- Valor nunca abaixo do que já foi recebido.
  v_novo_total := coalesce(round((p_patch->>'total_amount')::numeric, 2), v_antes."total_amount");
  IF v_novo_total < v_antes."amount_paid" THEN
    RAISE EXCEPTION
      'O valor não pode ser menor que o já pago (R$ %).',
      to_char(v_antes."amount_paid", 'FM999G999G990D00')
      USING ERRCODE = '23514';
  END IF;

  -- Trocar de serviço reescreve o nome guardado na comanda: `service_name`
  -- é snapshot (o catálogo pode mudar depois), então precisa vir da tabela.
  IF p_patch ? 'service_id' AND (p_patch->>'service_id') IS NOT NULL THEN
    SELECT * INTO v_servico FROM public.services
    WHERE "id" = (p_patch->>'service_id')::uuid AND "deleted_at" IS NULL;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Serviço não encontrado.' USING ERRCODE = 'P0002';
    END IF;
  END IF;

  IF p_patch ? 'customer_id' AND NOT EXISTS (
    SELECT 1 FROM public.customers
    WHERE "id" = (p_patch->>'customer_id')::uuid AND "deleted_at" IS NULL
  ) THEN
    RAISE EXCEPTION 'Cliente não encontrado.' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.orders o
  SET
    "description"       = coalesce(p_patch->>'description', o."description"),
    "notes"             = coalesce(p_patch->>'notes', o."notes"),
    "quantity"          = coalesce((p_patch->>'quantity')::integer, o."quantity"),
    "total_amount"      = v_novo_total,
    "due_date"          = coalesce((p_patch->>'due_date')::timestamptz, o."due_date"),
    "assigned_staff_id" = CASE
                            WHEN p_patch ? 'assigned_staff_id'
                            THEN (p_patch->>'assigned_staff_id')::uuid
                            ELSE o."assigned_staff_id"
                          END,
    "customer_id"       = coalesce((p_patch->>'customer_id')::uuid, o."customer_id"),
    "service_id"        = CASE
                            WHEN p_patch ? 'service_id'
                            THEN (p_patch->>'service_id')::uuid
                            ELSE o."service_id"
                          END,
    "service_name"      = coalesce(v_servico."name", o."service_name"),
    "category_key"      = coalesce(
                            p_patch->>'category_key',
                            v_servico."category_key",
                            o."category_key"
                          )
  WHERE o."id" = p_order_id AND o."deleted_at" IS NULL
  RETURNING * INTO v_order;

  -- Trocar o cliente muda a pendência dos DOIS: o antigo pode zerar, o
  -- novo pode passar a dever.
  IF v_order."customer_id" IS DISTINCT FROM v_antes."customer_id" THEN
    PERFORM public.recalc_customer_status(v_antes."customer_id");
    PERFORM public.recalc_customer_status(v_order."customer_id");
  END IF;

  IF p_event_title IS NOT NULL THEN
    PERFORM public.log_order_event(p_order_id, p_event_title, NULL);
  END IF;

  RETURN v_order;
END;
$$;

COMMENT ON FUNCTION "public"."update_order"(uuid, jsonb, text) IS
  'Edição de comanda. Recusa comanda finalizada e valor abaixo do já pago. Aceita service_id, customer_id e category_key além dos campos originais.';

REVOKE ALL ON FUNCTION "public"."update_order"(uuid, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."update_order"(uuid, jsonb, text) TO "authenticated";

NOTIFY pgrst, 'reload schema';
