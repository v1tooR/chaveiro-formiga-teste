-- =====================================================================
-- 20260811100000 — item não retirado (bloco 6 de docs/06)
-- ---------------------------------------------------------------------
-- O PROBLEMA
--
-- Comanda `pronta` há oito meses continua `pronta` para sempre. Não
-- existe prazo, alerta nem filtro. A peça ocupa prateleira, o dinheiro
-- fica pendurado, e há consequência legal em guardar bem de terceiro por
-- tempo indeterminado.
--
-- A DECISÃO QUE O CHECKLIST DEIXOU EM ABERTO: status novo ou derivado?
--
-- O checklist perguntava se `abandonada` deveria virar um status. NÃO
-- vira, e a razão é que abandono não é um estado de trabalho — é uma
-- propriedade do TEMPO.
--
-- A peça continua pronta: o serviço está feito e ela está esperando. O
-- que mudou foi quantos dias faz. Um status exigiria alguém mover a
-- comanda na mão, e é exatamente isso que não acontece numa loja cheia —
-- o alerta que depende de alguém lembrar de marcar não dispara nunca.
-- Derivado do tempo, está sempre certo e custa zero de operação.
--
-- Também evita a pergunta chata: quando o cliente aparece no décimo mês,
-- quem devolve o status? Com derivação, ele simplesmente entrega.
--
-- Se um dia a loja precisar de um ATO explícito — doar, vender, descartar
-- — aí sim é status novo, porque aí existe uma decisão humana com peso
-- legal para registrar. Isso é outra conversa, e ela não é de software.
--
-- O QUE ENTRA
--
--   1. `app_settings.abandoned_after_days` — a loja decide. 0 desliga.
--   2. `order_items.ready_at` — quando ESTA peça ficou pronta.
--   3. `orders.ready_at` — espelho, seguindo o padrão do bloco 3.
--   4. `order_list_view.days_ready` — dias na prateleira.
--   5. `dashboard_alerts()` ganha o bloco `abandoned`.
--
-- POR QUE `ready_at` E NÃO `updated_at`
--
-- `updated_at` muda a cada toque: corrigir uma observação, imprimir a
-- etiqueta, registrar pagamento. A peça "rejuvenesceria" toda vez que
-- alguém mexesse na comanda, e o abandono nunca completaria o prazo —
-- justamente nas comandas mais mexidas, que são as problemáticas.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. O prazo é decisão da loja
-- ---------------------------------------------------------------------
ALTER TABLE "public"."app_settings"
  ADD COLUMN "abandoned_after_days" integer NOT NULL DEFAULT 90;

ALTER TABLE "public"."app_settings"
  ADD CONSTRAINT "app_settings_abandoned_days" CHECK ("abandoned_after_days" >= 0);

COMMENT ON COLUMN "public"."app_settings"."abandoned_after_days" IS
  'Dias na prateleira até a peça ser considerada não retirada. 0 desliga o alerta.';

-- ---------------------------------------------------------------------
-- 2. Quando a peça ficou pronta
-- ---------------------------------------------------------------------
ALTER TABLE "public"."order_items" ADD COLUMN "ready_at" timestamptz;
ALTER TABLE "public"."orders"      ADD COLUMN "ready_at" timestamptz;

COMMENT ON COLUMN "public"."order_items"."ready_at" IS
  'Quando esta peça ficou pronta. Gravado uma única vez, na primeira vez que entra em pronta/avisado — voltar para execução e ficar pronta de novo não reinicia a contagem.';
COMMENT ON COLUMN "public"."orders"."ready_at" IS
  'Espelho derivado de order_items (recalc_order_from_items). Quando a comanda INTEIRA ficou pronta.';

-- ---------------------------------------------------------------------
-- Backfill — FUNÇÃO, não UPDATE solto
-- ---------------------------------------------------------------------
-- ⚠️ O `db-init` aplica migrations ANTES dos seeds. Um UPDATE aqui rodaria
-- com o banco VAZIO e não pegaria nada: numa instalação do zero, as 120
-- comandas semeadas nasceriam sem `ready_at`, nunca entrariam no alerta, e
-- o bloco 6 pareceria funcionar enquanto não fazia nada.
--
-- Foi exatamente essa a armadilha do backfill do bloco 3
-- (`backfill_order_items`, 20260807100000). Mesmo remédio: função
-- idempotente, chamada aqui E no fim dos dois seeds.
--
-- `updated_at` é a melhor aproximação para o que já está no banco. Não é
-- exato, mas o alerta compara com dezenas de dias — errar por horas não
-- muda decisão nenhuma.
CREATE OR REPLACE FUNCTION "public"."backfill_ready_at"() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE v_n integer;
BEGIN
  UPDATE public.order_items
  SET "ready_at" = "updated_at"
  WHERE "status_key" IN ('pronta', 'avisado') AND "ready_at" IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

COMMENT ON FUNCTION "public"."backfill_ready_at"() IS
  'Preenche order_items.ready_at nas peças já prontas. Idempotente — só toca em ready_at nulo. Chamada pela migration e pelo fim dos seeds, porque o db-init migra antes de semear.';

SELECT public.backfill_ready_at();

-- ---------------------------------------------------------------------
-- 3. change_order_item_status grava o marco
-- ---------------------------------------------------------------------
-- Só a linha do UPDATE muda em relação à 20260807220000; o resto do corpo
-- é idêntico e vem junto porque CREATE OR REPLACE substitui a função
-- inteira.
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
        SELECT EXISTS (
          SELECT 1 FROM public.order_photos p
          WHERE p."kind" = 'depois'
            AND p."storage_path" IS NULL
            AND (
              p."order_item_id" = p_item_id
              OR (v_itens = 1 AND p."order_item_id" IS NULL AND p."order_id" = v_item."order_id")
            )
        ) INTO v_vazia;

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
    -- ⚠️ AQUI ESTÁ A MUDANÇA DESTA MIGRATION.
    --
    -- `coalesce` e não atribuição direta: a peça que volta para a bancada
    -- e fica pronta de novo NÃO reinicia a contagem. Ela está na loja
    -- desde a primeira vez, e é isso que o cliente e a prateleira sentem.
    -- Sem o coalesce, mexer numa comanda velha a tiraria do alerta.
    UPDATE public.order_items
    SET "status_key" = p_status_key,
        "ready_at"   = CASE
                         WHEN p_status_key IN ('pronta', 'avisado')
                         THEN coalesce("ready_at", now())
                         ELSE "ready_at"
                       END
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

-- ---------------------------------------------------------------------
-- 4. O espelho na comanda
-- ---------------------------------------------------------------------
-- `max()` das peças ainda na loja: a comanda só está pronta quando a
-- ÚLTIMA peça ficou pronta. Com `min()`, uma comanda de três peças em que
-- uma ficou pronta em janeiro entraria no alerta enquanto as outras duas
-- ainda estivessem na bancada — e não há nada de abandonado nisso.
--
-- Peças já entregues saem da conta pelo mesmo motivo: elas não estão na
-- prateleira. `ready_at` fica NULL enquanto qualquer peça viva não estiver
-- pronta, e o alerta ignora NULL.
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
  v_pronta     timestamptz;
  v_falta      integer;
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

  -- Prateleira: só quando NENHUMA peça viva está fora de pronta/avisado.
  SELECT
    count(*) FILTER (WHERE i."status_key" NOT IN ('pronta', 'avisado')),
    max(i."ready_at")
  INTO v_falta, v_pronta
  FROM public.order_items i
  WHERE i."order_id" = p_order_id
    AND i."status_key" NOT IN ('entregue', 'cancelada');

  IF coalesce(v_falta, 0) > 0 OR v_abertos = 0 THEN
    v_pronta := NULL;
  END IF;

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
      "ready_at"              = v_pronta,
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
      OR o."ready_at"       IS DISTINCT FROM v_pronta
      OR o."is_rework"      IS DISTINCT FROM (v_retrab = v_itens)
      OR o."delivered_to_name" IS DISTINCT FROM coalesce(v_ent."delivered_to_name", '')
      OR o."delivered_by"   IS DISTINCT FROM v_ent."delivered_by"
    );
END;
$$;

-- A trigger precisa acordar quando `ready_at` do item muda.
DROP TRIGGER IF EXISTS "order_items_sync_order" ON "public"."order_items";
CREATE TRIGGER "order_items_sync_order"
    AFTER INSERT OR DELETE OR UPDATE OF
      "status_key", "quantity", "total_amount", "service_name", "service_id",
      "category_key", "assigned_staff_id", "due_date", "delivered_at", "position",
      "parent_item_id", "delivered_to_name", "delivered_by", "ready_at"
    ON "public"."order_items"
    FOR EACH ROW EXECUTE FUNCTION "public"."trg_order_items_sync_order"();

DO $reconcilia$
DECLARE r record;
BEGIN
  FOR r IN SELECT DISTINCT "order_id" FROM public.order_items LOOP
    PERFORM public.recalc_order_from_items(r."order_id");
  END LOOP;
END
$reconcilia$;

-- ---------------------------------------------------------------------
-- 5. A view expõe os dias, não o veredito
-- ---------------------------------------------------------------------
-- `days_ready` e não `is_abandoned`: o prazo mora em `app_settings`, e
-- lê-lo aqui dentro amarraria a view a uma tabela com RLS própria. Quem
-- sabe o prazo compara — `dashboard_alerts()` no servidor, a tela no
-- cliente, que já carrega a configuração.
--
-- ⚠️ Colunas novas SEMPRE no fim (regra desde a 20260806200000): o front
-- e os testes leem por nome, mas `SELECT *` em ordem posicional existe em
-- alguns lugares e reordenar quebraria calado.
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
  o."delivered_to_name",
  o."delivered_to_document",
  o."delivery_note",
  o."delivered_by",
  pf."full_name" AS "delivered_by_name",

  -- Novas — sempre no fim.
  o."ready_at",
  CASE
    WHEN o."ready_at" IS NULL THEN NULL
    ELSE ((now() AT TIME ZONE 'America/Sao_Paulo')::date - o."ready_at"::date)
  END AS "days_ready"
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

CREATE INDEX IF NOT EXISTS "orders_ready_at_idx" ON "public"."orders" ("ready_at")
  WHERE "ready_at" IS NOT NULL AND "deleted_at" IS NULL;

-- ---------------------------------------------------------------------
-- 6. O alerta
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."dashboard_alerts"() RETURNS jsonb
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
WITH
  today AS (SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date AS d),
  cfg AS (SELECT coalesce(max("abandoned_after_days"), 0) AS "limite" FROM app_settings),
  o AS (
    SELECT
      orders."id", orders."number", orders."status_key", orders."due_date",
      orders."balance", orders."label_printed", orders."customer_id", orders."service_name",
      orders."ready_at",
      ost."is_final",
      (orders."due_date"::date - (SELECT d FROM today)) AS "days_left",
      CASE WHEN orders."ready_at" IS NULL THEN NULL
           ELSE ((SELECT d FROM today) - orders."ready_at"::date) END AS "days_ready",
      coalesce((SELECT count(*) FROM order_photos p WHERE p."order_id" = orders."id"), 0) AS "photos"
    FROM orders
    JOIN order_statuses ost ON ost."key" = orders."status_key"
    WHERE orders."deleted_at" IS NULL
  ),
  named AS (
    SELECT o.*, c."name" AS "customer_name"
    FROM o JOIN customers c ON c."id" = o."customer_id"
  ),
  -- Limite 0 desliga: sem esta guarda, `days_ready >= 0` marcaria como
  -- abandonada toda peça que ficou pronta hoje.
  esquecidas AS (
    SELECT * FROM named
    WHERE (SELECT "limite" FROM cfg) > 0
      AND NOT "is_final"
      AND "days_ready" IS NOT NULL
      AND "days_ready" >= (SELECT "limite" FROM cfg)
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
  'abandoned', jsonb_build_object(
    'count',  (SELECT count(*) FROM esquecidas),
    'days',   (SELECT "limite" FROM cfg),
    'oldest', (SELECT max("days_ready") FROM esquecidas),
    'sample', coalesce((SELECT jsonb_agg(x) FROM (
                 SELECT "id", "number", "customer_name", "service_name", "days_ready"
                 FROM esquecidas ORDER BY "days_ready" DESC LIMIT 4
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
  'no_due_date',    (SELECT count(*) FROM named WHERE NOT "is_final" AND "days_left" > 60)
);
$$;

COMMENT ON FUNCTION "public"."dashboard_alerts"() IS
  'Port de gerarAlertas() (src/lib/metricas.ts:221), + `abandoned` (bloco 6): peça pronta há mais de app_settings.abandoned_after_days na prateleira.';
