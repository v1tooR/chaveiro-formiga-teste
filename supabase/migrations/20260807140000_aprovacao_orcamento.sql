-- =====================================================================
-- 20260807140000 — aprovação de orçamento com lastro
-- ---------------------------------------------------------------------
-- Bloco 4 de docs/06-fluxo-do-usuario.md.
--
-- O PROBLEMA
--
-- O status `aprovacao` ("Aguardando aprovação") existe desde a primeira
-- migration, mas nada guardava QUEM aprovou, QUANDO e POR QUAL VALOR.
-- Orçamento aceito por telefone sobrava como texto solto no histórico.
-- Se o cliente contesta o preço, o status diz que foi aprovado e nada diz
-- por quem — que é a mesma classe de buraco que o bloco 1 fechou na
-- entrega.
--
-- ⚠️ MUDANÇA EM RELAÇÃO AO QUE O CHECKLIST PREVIA
--
-- docs/06 foi escrito antes do bloco 3 e falava em `orders.approved_*`.
-- Não serve mais: o bloco 3 moveu o status para o ITEM, e `aprovacao` é
-- status de item. Além disso o valor aprovado é o valor DAQUELA peça —
-- o cliente aprova o conserto do sapato de R$ 120 e recusa a cópia da
-- chave na mesma comanda.
--
-- Aprovação por comanda seria incoerente: a transição que dispara a
-- exigência acontece no item.
--
-- QUANDO A EXIGÊNCIA DISPARA
--
-- Ao SAIR de `aprovacao`, não ao entrar. Entrar é "mandei o orçamento";
-- sair para um status de trabalho é "o cliente aceitou" — e é esse o
-- momento que precisa de lastro.
--
-- Sair de `aprovacao` para `cancelada` é o cliente dizendo NÃO. Aí não se
-- exige nada: obrigar a preencher "quem aprovou" para registrar uma
-- recusa seria pedir mentira ao operador.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Canal da aprovação — tabela de domínio, como as outras
-- ---------------------------------------------------------------------
-- Texto livre viraria "whats", "WhatsApp", "zap" e "telefone " na mesma
-- base, e nenhum relatório conseguiria agrupar.
CREATE TABLE "public"."approval_channels" (
    "key"         text PRIMARY KEY,
    "label"       text NOT NULL,
    "sort_order"  integer NOT NULL DEFAULT 0,
    "created_at"  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "approval_channels_key_format" CHECK ("key" ~ '^[a-z_]{3,24}$')
);

COMMENT ON TABLE "public"."approval_channels" IS
  'Por onde o cliente aprovou o orçamento. Domínio: leitura livre, escrita do responsável.';

ALTER TABLE "public"."approval_channels" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "approval_channels_select" ON "public"."approval_channels"
    FOR SELECT TO "authenticated" USING (true);

CREATE POLICY "approval_channels_write" ON "public"."approval_channels"
    FOR ALL TO "authenticated"
    USING ("public"."is_owner"()) WITH CHECK ("public"."is_owner"());

GRANT SELECT ON "public"."approval_channels" TO "authenticated";

-- As linhas nascem aqui E em seed_prod.sql. Aqui para o banco que já
-- roda (a migration é o único caminho até ele); no seed para o banco
-- novo, onde este INSERT roda antes de qualquer dado existir e o
-- ON CONFLICT o torna inofensivo.
INSERT INTO "public"."approval_channels" ("key", "label", "sort_order") VALUES
  ('presencial', 'Presencial', 1),
  ('telefone',   'Telefone',   2),
  ('whatsapp',   'WhatsApp',   3),
  ('email',      'E-mail',     4)
ON CONFLICT ("key") DO NOTHING;

-- ---------------------------------------------------------------------
-- 2. O lastro, no item
-- ---------------------------------------------------------------------
ALTER TABLE "public"."order_items"
  ADD COLUMN "approved_at"          timestamptz,
  ADD COLUMN "approved_by_name"     text NOT NULL DEFAULT '',
  ADD COLUMN "approved_amount"      numeric(12,2),
  ADD COLUMN "approval_channel_key" text
    REFERENCES "public"."approval_channels"("key") ON DELETE RESTRICT,
  -- Quem no balcão registrou. Não é quem aprovou: aprovar é do cliente.
  ADD COLUMN "approval_taken_by"    uuid
    REFERENCES "public"."profiles"("id") ON DELETE SET NULL;

COMMENT ON COLUMN "public"."order_items"."approved_by_name" IS
  'O CLIENTE que aprovou (ou quem ele mandou). Nunca o funcionário — esse é approval_taken_by.';
COMMENT ON COLUMN "public"."order_items"."approved_amount" IS
  'Valor no instante do aceite. Divergir de total_amount depois é o caso "o serviço cresceu", e a tela sinaliza.';

-- ---------------------------------------------------------------------
-- 3. change_order_item_status — exige o lastro ao sair de `aprovacao`
-- ---------------------------------------------------------------------
-- Corpo idêntico ao da 20260807100000 salvo o bloco de aprovação.
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
  -- Só na SAÍDA de `aprovacao`, e nunca para `cancelada` (isso é o
  -- cliente recusando). Já aprovado antes não pede de novo: reabrir o
  -- pedido a cada mudança de coluna no Kanban travaria a produção.
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

    -- Mensagem com acento de propósito: mensagemErro (src/lib/supabase.ts:115)
    -- só repassa a frase da RPC quando ela tem caractere acentuado.
    IF coalesce(v_exige, false) AND NOT EXISTS (
      SELECT 1 FROM public.order_photos
      WHERE "order_item_id" = p_item_id AND "kind" = 'depois'
    ) THEN
      RAISE EXCEPTION 'É obrigatório anexar uma foto do tipo "Depois" neste item antes de entregá-lo.'
        USING ERRCODE = '23514';
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

-- A versão de 3 argumentos sai: com as duas vivas o PostgREST fica com
-- sobrecarga ambígua e a exigência de aprovação vira contornável.
DROP FUNCTION IF EXISTS "public"."change_order_item_status"(uuid, text, jsonb);

GRANT EXECUTE ON FUNCTION "public"."change_order_item_status"(uuid, text, jsonb, jsonb)
  TO "authenticated";

-- ---------------------------------------------------------------------
-- 4. change_order_status — repassa a aprovação no fan-out
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.change_order_status(
  p_order_id   uuid,
  p_status_key text,
  p_delivery   jsonb DEFAULT NULL,
  p_approval   jsonb DEFAULT NULL
)
 RETURNS orders
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_order public.orders;
  v_item  uuid;
  v_qtd   integer := 0;
BEGIN
  IF NOT (public.can_write('orders') OR public.can_write('production')) THEN
    RAISE EXCEPTION 'Sem permissão para alterar o status da comanda.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_order
  FROM public.orders
  WHERE "id" = p_order_id AND "deleted_at" IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Comanda não encontrada.' USING ERRCODE = 'P0001';
  END IF;

  FOR v_item IN
    SELECT i."id" FROM public.order_items i
    WHERE i."order_id" = p_order_id
      AND i."status_key" NOT IN ('entregue', 'cancelada')
    ORDER BY i."position"
  LOOP
    PERFORM public.change_order_item_status(v_item, p_status_key, p_delivery, p_approval);
    v_qtd := v_qtd + 1;
  END LOOP;

  IF v_qtd = 0 THEN
    RAISE EXCEPTION 'Comanda % não tem item em aberto para mover.', v_order."number"
      USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE "id" = p_order_id;
  RETURN v_order;
END;
$function$
;

DROP FUNCTION IF EXISTS public.change_order_status(uuid, text, jsonb);

GRANT EXECUTE ON FUNCTION public.change_order_status(uuid, text, jsonb, jsonb) TO "authenticated";

-- ---------------------------------------------------------------------
-- 5. Divergência entre o aprovado e o cobrado
-- ---------------------------------------------------------------------
-- É o caso "o serviço cresceu depois do aceite". Não é erro: acontece
-- quando a peça abre e aparece mais coisa. Mas precisa ser VISÍVEL antes
-- da cobrança, não descoberto na discussão com o cliente.
--
-- Vive na view para não obrigar cada tela a repetir a conta.
CREATE OR REPLACE VIEW "public"."order_item_approval_view"
    WITH (security_invoker = true)
    AS
SELECT
  i."id"                AS "order_item_id",
  i."order_id",
  o."number"            AS "order_number",
  i."position",
  i."service_name",
  i."approved_at",
  i."approved_by_name",
  i."approved_amount",
  i."approval_channel_key",
  ac."label"            AS "approval_channel_label",
  p."full_name"         AS "approval_taken_by_name",
  i."total_amount",
  (i."total_amount" - i."approved_amount")             AS "approval_difference",
  (i."approved_at" IS NOT NULL
   AND i."approved_amount" IS DISTINCT FROM i."total_amount") AS "approval_diverges"
FROM "public"."order_items" i
JOIN "public"."orders" o ON o."id" = i."order_id"
LEFT JOIN "public"."approval_channels" ac ON ac."key" = i."approval_channel_key"
LEFT JOIN "public"."profiles" p ON p."id" = i."approval_taken_by"
WHERE o."deleted_at" IS NULL;

COMMENT ON VIEW "public"."order_item_approval_view" IS
  'Lastro da aprovação por item, com a divergência entre o valor aprovado e o cobrado hoje.';

GRANT SELECT ON "public"."order_item_approval_view" TO "authenticated";
