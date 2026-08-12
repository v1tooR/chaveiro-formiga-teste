-- =====================================================================
-- 20260806200000 — registro da entrega + foto obrigatória
-- ---------------------------------------------------------------------
-- Blocos 1 e 2 de docs/06-fluxo-do-usuario.md. Saem juntos porque os dois
-- alteram `change_order_status`, e migration aplicada não se edita.
--
-- O QUE FALTAVA
--
-- 1. `orders` guardava `delivered_at` e nada mais. Quem retirou, com qual
--    documento e quem no balcão entregou não existiam. "Finalizar
--    entrega" era um confirm de uma pergunta. A linha "Assinatura do
--    cliente" só existe na comanda impressa de ENTRADA, e o papel não
--    volta para o sistema.
--
-- 2. Foto nunca era obrigatória. `podeAvancar` (NovoAtendimento.tsx:185)
--    valida cliente, serviço, valor e entrada; a etapa de Fotos caía no
--    `default: return true`. Comanda nascia sem foto e era entregue sem
--    foto do "depois" — o inverso do que protege a loja numa disputa.
--
-- POR QUE NÃO É CHECK CONSTRAINT
--
-- Um `CHECK (status_key <> 'entregue' OR delivered_to_name <> '')` marca
-- toda comanda já entregue como inválida, e o Postgres revalida a linha
-- inteira em QUALQUER update posterior — inclusive o de `amount_paid`
-- feito por trigger. Comandas antigas ficariam impossíveis de tocar. A
-- exigência mora na RPC, que só olha a transição.
--
-- DEFAULT true NAS DUAS FLAGS
--
-- É o comportamento que se quer. Comanda em `pronta` criada antes desta
-- migration vai pedir a foto do "depois" na hora de entregar — que é o
-- ponto. Quem não quiser desliga em Configurações → Operação; a regra é
-- da loja, não do código.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Registro da entrega
-- ---------------------------------------------------------------------
ALTER TABLE "public"."orders"
  ADD COLUMN "delivered_to_name"     text NOT NULL DEFAULT '',
  ADD COLUMN "delivered_to_document" text NOT NULL DEFAULT '',
  ADD COLUMN "delivery_note"         text NOT NULL DEFAULT '',
  ADD COLUMN "delivered_by"          uuid REFERENCES "public"."profiles"("id") ON DELETE SET NULL;

COMMENT ON COLUMN "public"."orders"."delivered_to_name" IS
  'Quem retirou. Exigido por change_order_status na transição para `entregue`; vazio nas comandas anteriores a 20260806200000.';
COMMENT ON COLUMN "public"."orders"."delivered_to_document" IS
  'Documento de quem retirou. Opcional — existe para retirada por terceiro.';
COMMENT ON COLUMN "public"."orders"."delivered_by" IS
  'Quem no balcão entregou. `created_by` só cobre a abertura da comanda.';

-- ---------------------------------------------------------------------
-- 2. Exigência de foto — decisão da loja, não do código
-- ---------------------------------------------------------------------
ALTER TABLE "public"."app_settings"
  ADD COLUMN "require_photo_on_intake"   boolean NOT NULL DEFAULT true,
  ADD COLUMN "require_photo_on_delivery" boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN "public"."app_settings"."require_photo_on_intake" IS
  'Exige ao menos uma foto para criar a comanda (create_order).';
COMMENT ON COLUMN "public"."app_settings"."require_photo_on_delivery" IS
  'Exige ao menos uma foto do tipo `depois` para finalizar a entrega (change_order_status).';

-- ---------------------------------------------------------------------
-- 3. A view precisa devolver o registro da entrega
-- ---------------------------------------------------------------------
-- CREATE OR REPLACE VIEW só aceita coluna NOVA no fim, e nunca reordena.
-- Por isso o corpo abaixo repete a definição atual na ordem exata e só
-- acrescenta as cinco colunas no final.
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
  ph."first_photo_seed",

  -- Novas — sempre no fim, ver comentário acima.
  o."delivered_to_name",
  o."delivered_to_document",
  o."delivery_note",
  o."delivered_by",
  pf."full_name" AS "delivered_by_name"
FROM "public"."orders" o
JOIN "public"."customers"      c   ON c."id"   = o."customer_id"
JOIN "public"."order_statuses" ost ON ost."key" = o."status_key"
LEFT JOIN "public"."staff"     st  ON st."id"  = o."assigned_staff_id"
LEFT JOIN "public"."profiles"  pf  ON pf."id"  = o."delivered_by"
LEFT JOIN LATERAL (
  SELECT
    count(*) AS "photo_count",
    (array_agg(p."id"            ORDER BY p."created_at"))[1] AS "first_photo_id",
    (array_agg(p."kind"          ORDER BY p."created_at"))[1] AS "first_photo_kind",
    (array_agg(p."caption"       ORDER BY p."created_at"))[1] AS "first_photo_caption",
    (array_agg(p."storage_path"  ORDER BY p."created_at"))[1] AS "first_photo_path",
    (array_agg(p."gradient_seed" ORDER BY p."created_at"))[1] AS "first_photo_seed"
  FROM "public"."order_photos" p
  WHERE p."order_id" = o."id"
) ph ON true
WHERE o."deleted_at" IS NULL;

-- ---------------------------------------------------------------------
-- 4. change_order_status — agora recebe o registro da entrega
-- ---------------------------------------------------------------------
-- O terceiro argumento entra com DEFAULT NULL para que as chamadas de
-- "Marcar como pronto" e "Cliente avisado" continuem passando dois
-- argumentos. A versão de 2 argumentos é dropada no fim: com as duas
-- vivas o PostgREST fica com sobrecarga ambígua e resolve pelo corpo do
-- POST, o que faria a exigência de entrega ser contornável.
CREATE OR REPLACE FUNCTION public.change_order_status(
  p_order_id  uuid,
  p_status_key text,
  p_delivery  jsonb DEFAULT NULL
)
 RETURNS orders
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_order   public.orders;
  v_nome    text;
  v_doc     text;
  v_obs     text;
  v_exige   boolean;
BEGIN
  -- Ambiguidade A3: financeiro tem `orders` só em leitura e não muda status.
  IF NOT (public.can_write('orders') OR public.can_write('production')) THEN
    RAISE EXCEPTION 'Sem permissão para alterar o status da comanda.' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.order_statuses WHERE "key" = p_status_key) THEN
    RAISE EXCEPTION 'Status "%" inexistente.', p_status_key USING ERRCODE = '23514';
  END IF;

  -- Carrega ANTES de atualizar: as validações de entrega precisam olhar a
  -- comanda e as fotos. O lock evita dois balcões entregando junto.
  SELECT * INTO v_order
  FROM public.orders
  WHERE "id" = p_order_id AND "deleted_at" IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Comanda não encontrada.' USING ERRCODE = 'P0001';
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

    -- ⚠️ A MENSAGEM PRECISA DE ACENTO. `mensagemErro` (src/lib/supabase.ts:115)
    -- distingue mensagem nossa de mensagem do Postgres testando se há
    -- caractere acentuado. Sem acento, esta frase seria descartada e o
    -- operador veria o genérico de 23514 — "os dados informados não
    -- atendem a uma regra do sistema", que não diz o que fazer.
    IF coalesce(v_exige, false) AND NOT EXISTS (
      SELECT 1 FROM public.order_photos
      WHERE "order_id" = p_order_id AND "kind" = 'depois'
    ) THEN
      RAISE EXCEPTION 'É obrigatório anexar uma foto do tipo "Depois" antes de finalizar a entrega.'
        USING ERRCODE = '23514';
    END IF;

    -- `delivered_at` continua sendo gravado pela trigger orders_guard_status
    -- (regra 22). Aqui só entra o que a trigger não tem como saber.
    UPDATE public.orders
    SET "status_key"            = p_status_key,
        "delivered_to_name"     = v_nome,
        "delivered_to_document" = v_doc,
        "delivery_note"         = v_obs,
        "delivered_by"          = auth.uid()
    WHERE "id" = p_order_id AND "deleted_at" IS NULL
    RETURNING * INTO v_order;

    PERFORM public.log_order_event(
      p_order_id, 'Entrega registrada',
      'Retirado por ' || v_nome || CASE WHEN v_doc <> '' THEN ' · ' || v_doc ELSE '' END
    );
  ELSE
    UPDATE public.orders
    SET "status_key" = p_status_key
    WHERE "id" = p_order_id AND "deleted_at" IS NULL
    RETURNING * INTO v_order;
  END IF;

  RETURN v_order;
END;
$function$
;

DROP FUNCTION IF EXISTS public.change_order_status(uuid, text);

GRANT EXECUTE ON FUNCTION public.change_order_status(uuid, text, jsonb) TO "authenticated";

-- ---------------------------------------------------------------------
-- 5. create_order — foto obrigatória no recebimento
-- ---------------------------------------------------------------------
-- Corpo idêntico ao da 20260730220000, com um único acréscimo: a checagem
-- de foto DEPOIS do laço que insere as fotos. Antes do laço, v_photo_count
-- ainda é zero e a comanda nunca seria criada.
CREATE OR REPLACE FUNCTION public.create_order(p_payload jsonb)
 RETURNS orders
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_order        public.orders;
  v_number       integer;
  v_service      public.services;
  v_customer     public.customers;
  v_total        numeric(12,2);
  v_down         numeric(12,2);
  v_method       text;
  v_qty          integer;
  v_due          timestamptz;
  v_staff        uuid;
  v_cat          text;
  v_photos       jsonb;
  v_photo        jsonb;
  v_photo_count  integer := 0;
  v_cat_down     uuid;
  v_cat_recv     uuid;
  v_exige_foto   boolean;
BEGIN
  IF NOT (public.can_write('service_desk') OR public.can_write('orders')) THEN
    RAISE EXCEPTION 'Sem permissão para criar comandas.' USING ERRCODE = '42501';
  END IF;

  -- ---- validação de entrada -----------------------------------------
  SELECT * INTO v_customer
  FROM public.customers
  WHERE "id" = (p_payload->>'customer_id')::uuid AND "deleted_at" IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cliente não encontrado.' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_service
  FROM public.services
  WHERE "id" = (p_payload->>'service_id')::uuid AND "deleted_at" IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Serviço não encontrado.' USING ERRCODE = 'P0001';
  END IF;

  v_qty    := greatest(1, coalesce((p_payload->>'quantity')::integer, 1));
  v_total   := round(coalesce((p_payload->>'total_amount')::numeric, v_service."base_price" * v_qty), 2);
  v_down    := round(coalesce((p_payload->>'down_payment')::numeric, 0), 2);
  v_method  := NULLIF(p_payload->>'down_payment_method_key', '');
  v_cat     := coalesce(NULLIF(p_payload->>'category_key', ''), v_service."category_key");
  v_staff   := coalesce((p_payload->>'assigned_staff_id')::uuid, v_service."default_staff_id");

  -- Regra 33: sem prazo explícito, hoje + prazo padrão do serviço.
  v_due := coalesce(
    (p_payload->>'due_date')::timestamptz,
    now() + (v_service."lead_time_days" || ' days')::interval
  );

  IF v_total <= 0 THEN
    RAISE EXCEPTION 'Valor total deve ser maior que zero.' USING ERRCODE = '23514';
  END IF;
  -- Regra 10: o front limita com Math.min; aqui é erro explícito.
  IF v_down > v_total THEN
    RAISE EXCEPTION 'Entrada (%) não pode exceder o valor total (%).', v_down, v_total
      USING ERRCODE = '23514';
  END IF;
  -- Regra 12
  IF (v_down > 0) <> (v_method IS NOT NULL) THEN
    RAISE EXCEPTION 'Forma de pagamento é obrigatória quando há entrada, e proibida quando não há.'
      USING ERRCODE = '23514';
  END IF;

  -- Foto do recebimento: checada ANTES de consumir o número sequencial,
  -- senão uma comanda recusada queima um número da numeração.
  SELECT "require_photo_on_intake" INTO v_exige_foto FROM public.app_settings WHERE "id";

  -- Mensagem com acento de propósito — ver o comentário em
  -- change_order_status sobre mensagemErro (src/lib/supabase.ts:115).
  IF coalesce(v_exige_foto, false)
     AND jsonb_array_length(coalesce(p_payload->'photos', '[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'É obrigatório anexar ao menos uma foto do item recebido para abrir a comanda.'
      USING ERRCODE = '23514';
  END IF;

  -- ---- regra 17: número sequencial atômico --------------------------
  UPDATE public.app_settings
  SET "order_next_number" = "order_next_number" + 1
  WHERE "id"
  RETURNING "order_next_number" - 1 INTO v_number;

  IF v_number IS NULL THEN
    RAISE EXCEPTION 'app_settings não inicializada — rode o seed de produção.' USING ERRCODE = 'P0001';
  END IF;

  -- ---- comanda ------------------------------------------------------
  INSERT INTO public.orders (
    "number", "customer_id", "category_key", "service_id", "service_name",
    "description", "quantity", "notes", "due_date", "assigned_staff_id",
    "status_key", "total_amount", "down_payment", "down_payment_method_key", "created_by"
  )
  VALUES (
    v_number, v_customer."id", v_cat, v_service."id", v_service."name",
    coalesce(p_payload->>'description', ''), v_qty, coalesce(p_payload->>'notes', ''),
    v_due, v_staff, 'recebida', v_total, v_down, v_method, auth.uid()
  )
  RETURNING * INTO v_order;

  -- ---- fotos do recebimento -----------------------------------------
  v_photos := coalesce(p_payload->'photos', '[]'::jsonb);
  FOR v_photo IN SELECT * FROM jsonb_array_elements(v_photos) LOOP
    INSERT INTO public.order_photos ("order_id", "kind", "caption", "storage_path", "gradient_seed", "created_by")
    VALUES (
      v_order."id",
      coalesce(NULLIF(v_photo->>'kind', ''), 'antes'),
      coalesce(v_photo->>'caption', ''),
      NULLIF(v_photo->>'storage_path', ''),
      coalesce(NULLIF(v_photo->>'gradient_seed', ''), v_cat || '-0'),
      auth.uid()
    );
    v_photo_count := v_photo_count + 1;
  END LOOP;

  -- ---- eventos (espelha o histórico montado em useApp.ts:158) -------
  PERFORM public.log_order_event(
    v_order."id", 'Comanda criada',
    v_service."name" || ' · ' || v_qty || 'x'
  );

  IF v_photo_count > 0 THEN
    PERFORM public.log_order_event(
      v_order."id", 'Fotos anexadas',
      v_photo_count || ' foto(s) no recebimento'
    );
  END IF;

  IF v_down > 0 THEN
    PERFORM public.log_order_event(
      v_order."id", 'Entrada registrada',
      'R$ ' || to_char(v_down, 'FM999999990.00')
    );
  END IF;

  -- ---- regra 30: lançamentos financeiros ----------------------------
  SELECT "id" INTO v_cat_down
  FROM public.ledger_categories
  WHERE "kind" = 'income' AND "is_system" AND "name" = 'Entrada de comanda' AND "deleted_at" IS NULL
  LIMIT 1;

  -- Ambiguidade A4: usa o mapa por categoria de serviço (seed.ts:396) e
  -- não o CAT_ENTRADA[0] fixo do store (useApp.ts:215).
  SELECT "id" INTO v_cat_recv
  FROM public.ledger_categories
  WHERE "kind" = 'income' AND "deleted_at" IS NULL
    AND "auto_for_service_category" = v_cat
  LIMIT 1;

  IF v_cat_recv IS NULL THEN
    SELECT "id" INTO v_cat_recv
    FROM public.ledger_categories
    WHERE "kind" = 'income' AND "is_system" AND "name" = 'Outros recebimentos' AND "deleted_at" IS NULL
    LIMIT 1;
  END IF;

  IF v_down > 0 AND v_cat_down IS NOT NULL THEN
    INSERT INTO public.ledger_entries (
      "kind", "description", "category_id", "amount", "entry_date", "status_key",
      "method_key", "order_id", "customer_id", "staff_id",
      "auto_generated", "auto_role", "created_by"
    )
    VALUES (
      'income', 'Entrada · ' || v_service."name", v_cat_down, v_down, v_order."created_at",
      'recebido', v_method, v_order."id", v_customer."id", public.current_staff_id(),
      true, 'down_payment', auth.uid()
    );
  END IF;

  IF v_order."balance" > 0.01 AND v_cat_recv IS NOT NULL THEN
    INSERT INTO public.ledger_entries (
      "kind", "description", "category_id", "amount", "entry_date", "status_key",
      "method_key", "order_id", "customer_id", "staff_id",
      "auto_generated", "auto_role", "created_by"
    )
    VALUES (
      'income', 'Saldo a receber · ' || v_service."name", v_cat_recv, v_order."balance", v_due,
      CASE WHEN v_down > 0 THEN 'parcial' ELSE 'pendente' END,
      NULL, v_order."id", v_customer."id", v_staff,
      true, 'receivable', auth.uid()
    );
  END IF;

  -- Recarrega para devolver amount_paid/balance/is_settled já calculados.
  SELECT * INTO v_order FROM public.orders WHERE "id" = v_order."id";
  RETURN v_order;
END;
$function$
;

GRANT EXECUTE ON FUNCTION public.create_order(jsonb) TO "authenticated";
