-- =====================================================================
-- 20260807220000 — a foto que libera a entrega precisa ter IMAGEM
-- ---------------------------------------------------------------------
-- O QUE ESTAVA ERRADO
--
-- A exigência do bloco 2 pergunta se EXISTE UMA LINHA em `order_photos`
-- com `kind = 'depois'`. Não pergunta se existe uma imagem.
--
-- E `order_photos` aceita linha sem arquivo de propósito: a constraint
-- `order_photos_has_source` (20260729120700) exige `storage_path` OU
-- `gradient_seed`, porque o seed de demonstração popula 120 comandas sem
-- nenhum binário.
--
-- No balcão isso virava um buraco de um clique. O botão "Sem foto" da
-- grade criava exatamente essa linha — gradiente, nenhuma imagem — e a
-- entrega passava. Ele ficava encostado no botão que anexa de verdade,
-- com o mesmo peso visual, e dava menos trabalho.
--
-- O botão já foi removido da interface (a câmera tomou o lugar dele), mas
-- interface não é regra. Enquanto o banco aceitar, qualquer caminho novo
-- — um import, uma tela futura, um POST direto no PostgREST — reabre o
-- buraco sem que ninguém perceba.
--
-- A DECISÃO
--
-- A foto da ENTREGA passa a exigir arquivo. É a que serve de prova
-- quando o cliente volta dizendo que a peça saiu diferente; um gradiente
-- colorido não prova nada.
--
-- A foto do RECEBIMENTO continua aceitando linha sem arquivo, e isso é
-- deliberado — não é esquecimento:
--
--   • `create_order` valida dentro da transação que cria a comanda, e
--     nesse instante o arquivo AINDA NÃO PODE existir: o caminho no
--     bucket é `<order_id>/…` e o id nasce ali. O cadastro manda as
--     linhas, a comanda nasce, os arquivos sobem em seguida
--     (`anexarArquivo`, src/lib/api/fotos.ts).
--   • Exigir arquivo aqui tornaria impossível abrir qualquer comanda.
--
-- Se um upload de recebimento falhar, a linha fica com o gradiente e o
-- operador é avisado na hora para reanexar pela ficha. A comanda existe,
-- que é o certo — o cliente já foi embora com o comprovante.
--
-- EFEITO NO QUE JÁ ESTÁ NO BANCO
--
-- Nada é invalidado: a regra só roda na TRANSIÇÃO para `entregue`. O que
-- já saiu continua entregue.
--
-- Mas comandas em `pronta` cujo "depois" é só gradiente — todas as do
-- seed de demonstração — passam a pedir uma foto de verdade antes de
-- sair. Numa base de demonstração é o comportamento desejado; numa base
-- real vinda de antes deste sistema, avise o balcão.
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
  v_vazia   boolean;
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

      -- ⚠️ `storage_path IS NOT NULL` é a mudança desta migration.
      --
      -- A cláusula do meio (comanda de um item aceita foto solta) veio da
      -- 20260807190000: a aba Fotos da ficha é da COMANDA, e numa comanda
      -- de uma peça só não há ambiguidade sobre a qual peça a foto
      -- pertence. Com mais de uma peça o vínculo continua obrigatório,
      -- senão a foto do sapato liberaria a entrega da chave.
      SELECT EXISTS (
        SELECT 1 FROM public.order_photos p
        WHERE p."kind" = 'depois'
          AND p."storage_path" IS NOT NULL
          AND (
            p."order_item_id" = p_item_id
            OR (v_itens = 1 AND p."order_item_id" IS NULL AND p."order_id" = v_item."order_id")
          )
      ) INTO v_tem;

      IF NOT v_tem THEN
        -- Separa "não tem foto" de "tem a marcação, mas sem imagem". São
        -- situações diferentes e a segunda confunde muito: o operador vê
        -- um quadrado colorido na tela marcado como "Depois" e não
        -- entende por que o sistema diz que falta foto.
        SELECT EXISTS (
          SELECT 1 FROM public.order_photos p
          WHERE p."kind" = 'depois'
            AND p."storage_path" IS NULL
            AND (
              p."order_item_id" = p_item_id
              OR (v_itens = 1 AND p."order_item_id" IS NULL AND p."order_id" = v_item."order_id")
            )
        ) INTO v_vazia;

        -- Mensagens acentuadas de propósito: mensagemErro
        -- (src/lib/supabase.ts:115) só repassa a frase da RPC ao operador
        -- quando ela tem caractere acentuado. Sem acento cai no texto
        -- genérico de 23514, que não diz o que fazer.
        IF v_vazia THEN
          RAISE EXCEPTION 'A marcação "Depois" existe, mas está sem imagem. Fotografe a peça pronta pelo botão Câmera antes de entregar.'
            USING ERRCODE = '23514';
        ELSIF v_itens = 1 THEN
          RAISE EXCEPTION 'É obrigatório fotografar a peça pronta antes de entregar. Use o botão Câmera e marque a foto como "Depois".'
            USING ERRCODE = '23514';
        ELSE
          RAISE EXCEPTION 'É obrigatório fotografar ESTA peça pronta antes de entregá-la. Anexe pela aba Itens — foto solta da comanda não vale quando há mais de uma peça.'
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

COMMENT ON COLUMN "public"."app_settings"."require_photo_on_delivery" IS
  'Exige uma foto `depois` COM ARQUIVO para finalizar a entrega do item (change_order_item_status). Linha só com gradiente não vale.';
