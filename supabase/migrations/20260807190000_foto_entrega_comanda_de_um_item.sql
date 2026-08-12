-- =====================================================================
-- 20260807190000 — foto de entrega: aceitar a da comanda quando há um item
-- ---------------------------------------------------------------------
-- DEFEITO INTRODUZIDO PELA 20260807100000
--
-- A exigência de foto "Depois" desceu para o item e passou a procurar
-- `order_photos.order_item_id = <item>`. Mas `enviarFoto`
-- (src/lib/api/fotos.ts) grava só `order_id` — a aba Fotos da ficha é da
-- COMANDA, não do item.
--
-- Efeito: numa comanda de um item só — o caso mais comum do balcão — o
-- operador anexava a foto do "Depois", via a foto na tela, e a entrega
-- continuava recusando. Sem saída pela interface.
--
-- Não apareceu nos testes de API porque eles inseriam a foto já com
-- `order_item_id` preenchido. Apareceu ao reexecutar o teste do bloco 1
-- depois do bloco 3 — o roteiro antigo anexava a foto como a tela anexa.
--
-- A CORREÇÃO
--
-- Comanda de UM item: foto solta da comanda vale, porque não há ambiguidade
-- sobre a qual peça ela pertence.
--
-- Comanda de VÁRIOS: continua exigindo o vínculo. Uma foto do sapato não
-- pode liberar a entrega da chave, e é isso que a 100000 veio garantir.
-- =====================================================================

CREATE OR REPLACE FUNCTION "public"."change_order_item_status"(
  "p_item_id"    uuid,
  "p_status_key" text,
  "p_delivery"   jsonb DEFAULT NULL,
  "p_approval"   jsonb DEFAULT NULL
)
    RETURNS "public"."order_items"
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_item    public.order_items;
  v_final   boolean;
  v_nome    text;
  v_doc     text;
  v_obs     text;
  v_exige   boolean;
  v_num     integer;
  v_itens   integer;
  v_tem     boolean;
  v_ap_nome text;
  v_ap_val  numeric(12,2);
  v_ap_via  text;
BEGIN
  IF NOT (public.can_write('orders') OR public.can_write('production')) THEN
    RAISE EXCEPTION 'Sem permissão para alterar o status do item.' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.order_statuses WHERE "key" = p_status_key) THEN
    RAISE EXCEPTION 'Status "%" inexistente.', p_status_key USING ERRCODE = '23514';
  END IF;

  SELECT i.* INTO v_item
  FROM public.order_items i
  JOIN public.orders o ON o."id" = i."order_id"
  WHERE i."id" = p_item_id AND o."deleted_at" IS NULL
  FOR UPDATE OF i;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item não encontrado.' USING ERRCODE = 'P0001';
  END IF;

  SELECT o."number" INTO v_num FROM public.orders o WHERE o."id" = v_item."order_id";

  SELECT s."is_final" INTO v_final
  FROM public.order_statuses s WHERE s."key" = v_item."status_key";

  IF v_final AND v_item."status_key" IS DISTINCT FROM p_status_key THEN
    RAISE EXCEPTION 'O item "%" da comanda % já está % e não muda mais de status.',
      v_item."service_name", v_num, v_item."status_key"
      USING ERRCODE = '23514';
  END IF;

  -- ---- aprovação do orçamento --------------------------------------
  IF v_item."status_key" = 'aprovacao'
     AND p_status_key NOT IN ('aprovacao', 'cancelada')
     AND v_item."approved_at" IS NULL THEN

    v_ap_nome := btrim(coalesce(p_approval->>'approved_by_name', ''));
    v_ap_via  := NULLIF(btrim(coalesce(p_approval->>'approval_channel_key', '')), '');
    v_ap_val  := round(
      coalesce((p_approval->>'approved_amount')::numeric, v_item."total_amount"), 2
    );

    IF v_ap_nome = '' THEN
      RAISE EXCEPTION 'Informe quem aprovou o orçamento para liberar o serviço.'
        USING ERRCODE = '23514';
    END IF;

    IF v_ap_via IS NULL THEN
      RAISE EXCEPTION 'Informe por onde o cliente aprovou o orçamento.'
        USING ERRCODE = '23514';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.approval_channels WHERE "key" = v_ap_via) THEN
      RAISE EXCEPTION 'Canal de aprovação "%" inválido.', v_ap_via USING ERRCODE = '23514';
    END IF;

    UPDATE public.order_items
    SET "approved_at"          = now(),
        "approved_by_name"     = v_ap_nome,
        "approved_amount"      = v_ap_val,
        "approval_channel_key" = v_ap_via,
        "approval_taken_by"    = auth.uid()
    WHERE "id" = p_item_id
    RETURNING * INTO v_item;

    PERFORM public.log_order_event(
      v_item."order_id", 'Orçamento aprovado',
      v_item."service_name" || ' · R$ ' || to_char(v_ap_val, 'FM999999990.00')
        || ' · aprovado por ' || v_ap_nome
        || ' (' || (SELECT c."label" FROM public.approval_channels c WHERE c."key" = v_ap_via) || ')'
    );
  END IF;

  IF p_status_key = 'entregue' THEN
    v_nome := btrim(coalesce(p_delivery->>'delivered_to_name', ''));
    v_doc  := btrim(coalesce(p_delivery->>'delivered_to_document', ''));
    v_obs  := btrim(coalesce(p_delivery->>'delivery_note', ''));

    IF v_nome = '' THEN
      RAISE EXCEPTION 'Informe quem está retirando o item para finalizar a entrega.'
        USING ERRCODE = '23514';
    END IF;

    SELECT "require_photo_on_delivery" INTO v_exige FROM public.app_settings WHERE "id";

    IF coalesce(v_exige, false) THEN
      SELECT count(*) INTO v_itens
      FROM public.order_items WHERE "order_id" = v_item."order_id";

      SELECT EXISTS (
        SELECT 1 FROM public.order_photos p
        WHERE p."kind" = 'depois'
          AND (
            p."order_item_id" = p_item_id
            -- ⚠️ AQUI ESTÁ A CORREÇÃO. Comanda de um item só: a foto solta
            -- da comanda vale, porque não há outra peça a que ela possa
            -- pertencer. É o que a aba Fotos da ficha grava.
            OR (v_itens = 1 AND p."order_item_id" IS NULL AND p."order_id" = v_item."order_id")
          )
      ) INTO v_tem;

      -- Mensagem com acento de propósito: mensagemErro (src/lib/supabase.ts:115)
      -- só repassa a frase da RPC quando ela tem caractere acentuado.
      IF NOT v_tem THEN
        IF v_itens = 1 THEN
          RAISE EXCEPTION 'É obrigatório anexar uma foto do tipo "Depois" antes de entregar.'
            USING ERRCODE = '23514';
        ELSE
          RAISE EXCEPTION 'É obrigatório anexar uma foto do tipo "Depois" NESTE item antes de entregá-lo. Anexe pela aba Itens — foto solta da comanda não vale quando há mais de uma peça.'
            USING ERRCODE = '23514';
        END IF;
      END IF;
    END IF;

    UPDATE public.order_items
    SET "status_key"            = p_status_key,
        "delivered_at"          = now(),
        "delivered_to_name"     = v_nome,
        "delivered_to_document" = v_doc,
        "delivery_note"         = v_obs,
        "delivered_by"          = auth.uid()
    WHERE "id" = p_item_id
    RETURNING * INTO v_item;

    PERFORM public.log_order_event(
      v_item."order_id", 'Item entregue',
      v_item."service_name" || ' · retirado por ' || v_nome
        || CASE WHEN v_doc <> '' THEN ' · ' || v_doc ELSE '' END
    );
  ELSE
    UPDATE public.order_items
    SET "status_key" = p_status_key
    WHERE "id" = p_item_id
    RETURNING * INTO v_item;

    PERFORM public.log_order_event(
      v_item."order_id", 'Item · status alterado',
      v_item."service_name" || ' → ' ||
      (SELECT s."label" FROM public.order_statuses s WHERE s."key" = p_status_key)
    );
  END IF;

  RETURN v_item;
END;
$$;

GRANT EXECUTE ON FUNCTION "public"."change_order_item_status"(uuid, text, jsonb, jsonb)
  TO "authenticated";
