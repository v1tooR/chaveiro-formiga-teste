-- =====================================================================
-- 20260807100000 — comanda com mais de um item
-- ---------------------------------------------------------------------
-- Bloco 3 de docs/06-fluxo-do-usuario.md, com as três decisões tomadas:
--
--   1. UM número de comanda, N itens        → tabela `order_items`
--   2. Status por ITEM                      → o Kanban move item, não comanda
--   3. Entrega parcial                      → cada item sai no seu momento
--
-- O PROBLEMA QUE RESOLVE
--
-- `orders` tinha `service_id`, `service_name` e `quantity` no singular.
-- Cliente que chega com duas chaves e um sapato virava três comandas,
-- três números e o financeiro em três pedaços — numa loja que se define
-- como "chaveiro, sapataria, costura e reparos", esse é o caso comum.
--
-- A ESCOLHA CENTRAL: `orders` VIRA ESPELHO DERIVADO
--
-- `order_items` passa a ser a fonte da verdade de serviço, quantidade,
-- preço, status e entrega. As colunas equivalentes em `orders` NÃO são
-- removidas: viram espelhos mantidos por trigger.
--
-- O motivo é conservador de propósito. Dependem dessas colunas hoje:
-- `order_list_view`, `customer_summary_view`, os oito `report_*`,
-- `dashboard_kpis`, `dashboard_alerts`, as policies de RLS e as telas de
-- Comandas, Clientes, Financeiro e Dashboard. Derivando em vez de
-- remover, nada disso muda — e a mudança fica contida em Produção,
-- ComandaDetalhe, Atendimento e Etiquetas.
--
-- O preço é uma regra que precisa ficar clara: a partir daqui, escrever
-- direto em orders.status_key/total_amount/quantity é gravar num espelho.
-- Quem manda é o item.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. A tabela
-- ---------------------------------------------------------------------
CREATE TABLE "public"."order_items" (
    "id"        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "order_id"  uuid NOT NULL REFERENCES "public"."orders"("id") ON DELETE CASCADE,

    -- Ordem de exibição e da etiqueta. 1, 2, 3… dentro da comanda.
    "position"  integer NOT NULL DEFAULT 1,

    "category_key"  text NOT NULL REFERENCES "public"."service_categories"("key") ON DELETE RESTRICT,
    -- Mesmo contrato de `orders`: o serviço pode sair do catálogo, o item
    -- sobrevive, e o nome é snapshot da hora da venda.
    "service_id"    uuid REFERENCES "public"."services"("id") ON DELETE SET NULL,
    "service_name"  text NOT NULL,

    "description"  text NOT NULL DEFAULT '',
    "quantity"     integer NOT NULL DEFAULT 1,

    -- ⚠️ O VALOR DA LINHA É A FONTE DA VERDADE, NÃO O PREÇO UNITÁRIO.
    --
    -- A tentação era `total_amount GENERATED AS round(unit_price * quantity)`.
    -- Isso quebra o backfill: comanda legada de R$ 100,00 com quantidade 3
    -- daria unit_price 33,33 e total 99,99. Como `orders.balance` e
    -- `orders.is_settled` são GENERATED a partir do total, um centavo de
    -- diferença transforma comanda quitada em devedora — e a pendência
    -- automática no financeiro volta a existir sozinha.
    --
    -- Além disso a tela nunca pediu preço unitário: NovoAtendimento pede o
    -- VALOR do serviço, que o operador negocia. Derivar o total do unitário
    -- inverteria o que a loja faz de verdade.
    "total_amount" numeric(12,2) NOT NULL,

    "due_date"          timestamptz NOT NULL,
    "assigned_staff_id" uuid REFERENCES "public"."staff"("id") ON DELETE SET NULL,
    "status_key"        text NOT NULL DEFAULT 'recebida'
                          REFERENCES "public"."order_statuses"("key") ON DELETE RESTRICT,

    -- Entrega por item (decisão 3). Espelha o bloco 1, um nível abaixo.
    "delivered_at"          timestamptz,
    "delivered_to_name"     text NOT NULL DEFAULT '',
    "delivered_to_document" text NOT NULL DEFAULT '',
    "delivery_note"         text NOT NULL DEFAULT '',
    "delivered_by"          uuid REFERENCES "public"."profiles"("id") ON DELETE SET NULL,

    "label_printed"  boolean NOT NULL DEFAULT false,

    "created_at"  timestamptz NOT NULL DEFAULT now(),
    "updated_at"  timestamptz NOT NULL DEFAULT now(),
    "created_by"  uuid REFERENCES "public"."profiles"("id") ON DELETE SET NULL,

    CONSTRAINT "order_items_quantity_min"     CHECK ("quantity" >= 1),
    -- `>= 0` e não `> 0`: a soma em `orders` continua guardada por
    -- `orders_total_positive`, e item de valor zero é o que o retrabalho
    -- em garantia (bloco 5) vai precisar.
    CONSTRAINT "order_items_total_min"        CHECK ("total_amount" >= 0),
    CONSTRAINT "order_items_service_name_min" CHECK (char_length(btrim("service_name")) > 0),
    CONSTRAINT "order_items_position_min"     CHECK ("position" >= 1),
    CONSTRAINT "order_items_position_unique"  UNIQUE ("order_id", "position") DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX "order_items_order_idx"   ON "public"."order_items" ("order_id", "position");
CREATE INDEX "order_items_status_idx"  ON "public"."order_items" ("status_key")
  WHERE "status_key" NOT IN ('entregue', 'cancelada');
CREATE INDEX "order_items_staff_idx"   ON "public"."order_items" ("assigned_staff_id");

COMMENT ON TABLE "public"."order_items" IS
  'Itens da comanda — fonte da verdade de serviço, preço, status e entrega. As colunas equivalentes em `orders` são espelhos derivados (trigger order_items_sync_order).';
COMMENT ON COLUMN "public"."order_items"."position" IS
  'Ordem dentro da comanda. Vira o sufixo da etiqueta: CF-0042/1, CF-0042/2.';
COMMENT ON COLUMN "public"."order_items"."status_key" IS
  'Status REAL. orders.status_key é derivado deste (item menos adiantado).';

CREATE TRIGGER "order_items_set_updated_at"
    BEFORE UPDATE ON "public"."order_items"
    FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();

-- ---------------------------------------------------------------------
-- 2. Foto por item
-- ---------------------------------------------------------------------
-- NULL = foto da comanda como um todo (é o que o balcão tira no
-- recebimento: o monte que o cliente trouxe). A foto do "depois" é
-- amarrada ao item, porque é ela que libera a entrega DAQUELE item.
ALTER TABLE "public"."order_photos"
  ADD COLUMN "order_item_id" uuid REFERENCES "public"."order_items"("id") ON DELETE CASCADE;

CREATE INDEX "order_photos_item_idx" ON "public"."order_photos" ("order_item_id")
  WHERE "order_item_id" IS NOT NULL;

COMMENT ON COLUMN "public"."order_photos"."order_item_id" IS
  'Item a que a foto pertence. NULL = foto da comanda (recebimento). A foto `depois` que libera a entrega precisa estar amarrada ao item.';

-- ---------------------------------------------------------------------
-- 3. Backfill — toda comanda sem item vira uma comanda de um item
-- ---------------------------------------------------------------------
-- ⚠️ POR QUE É FUNÇÃO E NÃO UM INSERT SOLTO
--
-- O db-init aplica as MIGRATIONS e só depois os SEEDS. Num banco novo,
-- na hora desta migration ainda não existe comanda nenhuma — um INSERT
-- aqui pegaria zero linhas, e as 120 comandas do seed de demonstração
-- nasceriam sem item: invisíveis na Produção e sem entrega possível.
--
-- Como função idempotente, ela serve aos dois casos: chamada no fim desta
-- migration (banco que já roda) e no fim dos seeds (banco novo).
CREATE OR REPLACE FUNCTION "public"."backfill_order_items"() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_n integer;
BEGIN
  INSERT INTO public.order_items (
    "order_id", "position", "category_key", "service_id", "service_name",
    "description", "quantity", "total_amount", "due_date", "assigned_staff_id",
    "status_key", "delivered_at", "delivered_to_name", "delivered_to_document",
    "delivery_note", "delivered_by", "label_printed", "created_at", "created_by"
  )
  SELECT
    o."id", 1, o."category_key", o."service_id", o."service_name",
    -- O total vai verbatim: é o que mantém balance e is_settled intactos.
    o."description", o."quantity", o."total_amount",
    o."due_date", o."assigned_staff_id",
    o."status_key", o."delivered_at", o."delivered_to_name", o."delivered_to_document",
    o."delivery_note", o."delivered_by", o."label_printed", o."created_at", o."created_by"
  FROM public.orders o
  WHERE NOT EXISTS (SELECT 1 FROM public.order_items i WHERE i."order_id" = o."id");

  GET DIAGNOSTICS v_n = ROW_COUNT;

  -- Foto de comanda de um item só pertence àquele item.
  UPDATE public.order_photos p
  SET "order_item_id" = i."id"
  FROM public.order_items i
  WHERE i."order_id" = p."order_id"
    AND i."position" = 1
    AND p."order_item_id" IS NULL
    AND (SELECT count(*) FROM public.order_items x WHERE x."order_id" = p."order_id") = 1;

  RETURN v_n;
END;
$$;

COMMENT ON FUNCTION "public"."backfill_order_items"() IS
  'Cria o item de posição 1 para comandas que não têm nenhum. Idempotente: roda na migration e no fim dos seeds (o db-init aplica migrations ANTES dos seeds).';

-- ---------------------------------------------------------------------
-- 4. RLS — a mesma regra de `orders`, herdada pela comanda-mãe
-- ---------------------------------------------------------------------
-- Item não tem dono próprio: quem pode ler/escrever a comanda pode
-- ler/escrever os itens dela. Duplicar a lógica aqui seria criar uma
-- segunda fonte de verdade de autorização.
ALTER TABLE "public"."order_items" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "order_items_select" ON "public"."order_items"
    FOR SELECT TO "authenticated"
    USING (
      "public"."can_read"('orders') OR "public"."can_read"('production')
    );

CREATE POLICY "order_items_insert" ON "public"."order_items"
    FOR INSERT TO "authenticated"
    WITH CHECK (
      (
        "public"."can_write"('orders')
        OR "public"."can_write"('service_desk')
      )
      -- Mesma guarda de order_photos_insert: não se acrescenta item a
      -- comanda finalizada ou excluída.
      AND EXISTS (
        SELECT 1 FROM "public"."orders" o
        JOIN "public"."order_statuses" st ON st."key" = o."status_key"
        WHERE o."id" = "order_id" AND o."deleted_at" IS NULL AND NOT st."is_final"
      )
    );

-- `labels` entra no UPDATE só por causa de `label_printed` — é o mesmo
-- alcance que `mark_labels_printed` já tinha sobre orders.
CREATE POLICY "order_items_update" ON "public"."order_items"
    FOR UPDATE TO "authenticated"
    USING (
      "public"."can_write"('orders')
      OR "public"."can_write"('production')
      OR "public"."can_write"('labels')
    )
    WITH CHECK (
      "public"."can_write"('orders')
      OR "public"."can_write"('production')
      OR "public"."can_write"('labels')
    );

CREATE POLICY "order_items_delete" ON "public"."order_items"
    FOR DELETE TO "authenticated"
    USING ("public"."can_write"('orders'));

GRANT SELECT, INSERT, UPDATE, DELETE ON "public"."order_items" TO "authenticated";

-- ---------------------------------------------------------------------
-- 5. Derivação: orders passa a ser espelho dos itens
-- ---------------------------------------------------------------------
-- REGRA DO STATUS AGREGADO
--
--   todos cancelados          → cancelada
--   todos entregues/cancelados→ entregue
--   senão                     → o status do item MENOS ADIANTADO
--                               (menor sort_order entre os não-finais)
--
-- "Menos adiantado" e não "mais adiantado" porque a comanda só está tão
-- pronta quanto a peça mais lenta. Com uma chave pronta e um sapato em
-- execução, a comanda está em execução — dizer "pronta" faria o balcão
-- chamar o cliente para levar metade.
--
-- ATENÇÃO À ORDEM DAS TRIGGERS
--
-- `orders_guard_status` (BEFORE UPDATE OF status_key) recusa mudança
-- quando o status ANTIGO é final, e é ela quem grava `delivered_at`.
-- A derivação nunca reabre comanda finalizada: os itens de uma comanda
-- entregue também são finais, e `change_order_item_status` os barra
-- antes. A guarda continua valendo como rede.
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
    min(i."due_date"),
    max(i."delivered_at")
  INTO v_itens, v_total, v_qty, v_cancelados, v_abertos, v_due, v_entregue
  FROM public.order_items i
  WHERE i."order_id" = p_order_id;

  -- Comanda sem item não deveria existir; se acontecer, não se toca no
  -- espelho (zerar total_amount violaria orders_total_positive e
  -- transformaria um estado estranho num erro sem relação com a causa).
  IF v_itens = 0 THEN
    RETURN;
  END IF;

  -- Nome: primeiro item + "+N" quando há mais. É o que aparece na
  -- listagem de Comandas, no card do Kanban e na busca.
  SELECT i."service_name", i."service_id", i."category_key"
  INTO v_nome, v_service, v_cat
  FROM public.order_items i
  WHERE i."order_id" = p_order_id
  ORDER BY i."position"
  LIMIT 1;

  v_extra := v_itens - 1;
  IF v_extra > 0 THEN
    v_nome := v_nome || ' +' || v_extra;
    -- Com mais de um item não existe "o serviço" nem "o responsável" da
    -- comanda: NULL é mais honesto que o valor do primeiro item.
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
    v_entregue := NULL; -- ainda há item na loja
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
      "status_key"        = v_status
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
    );
END;
$$;

COMMENT ON FUNCTION "public"."recalc_order_from_items"(uuid) IS
  'Reescreve o espelho em `orders` a partir de `order_items`. Status agregado = item menos adiantado.';

CREATE OR REPLACE FUNCTION "public"."trg_order_items_sync_order"() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  PERFORM public.recalc_order_from_items(coalesce(NEW."order_id", OLD."order_id"));
  RETURN coalesce(NEW, OLD);
END;
$$;

CREATE TRIGGER "order_items_sync_order"
    AFTER INSERT OR DELETE OR UPDATE OF
      "status_key", "quantity", "total_amount", "service_name", "service_id",
      "category_key", "assigned_staff_id", "due_date", "delivered_at", "position"
    ON "public"."order_items"
    FOR EACH ROW EXECUTE FUNCTION "public"."trg_order_items_sync_order"();

-- ---------------------------------------------------------------------
-- 6. change_order_item_status — o novo motor do fluxo
-- ---------------------------------------------------------------------
-- Substitui change_order_status como caminho normal. A comanda continua
-- tendo status, mas agora ele é consequência.
--
-- A exigência de foto "Depois" (bloco 2) desce para o item: é a peça que
-- está saindo, não a comanda. A foto precisa estar amarrada AO ITEM
-- (order_photos.order_item_id) — foto solta da comanda não libera nada,
-- senão uma foto do sapato liberaria a entrega da chave.
CREATE OR REPLACE FUNCTION "public"."change_order_item_status"(
  "p_item_id"    uuid,
  "p_status_key" text,
  "p_delivery"   jsonb DEFAULT NULL
)
    RETURNS "public"."order_items"
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_item   public.order_items;
  v_final  boolean;
  v_nome   text;
  v_doc    text;
  v_obs    text;
  v_exige  boolean;
  v_num    integer;
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

  -- Regra 23, um nível abaixo: item entregue ou cancelado não volta.
  SELECT s."is_final" INTO v_final
  FROM public.order_statuses s WHERE s."key" = v_item."status_key";

  IF v_final AND v_item."status_key" IS DISTINCT FROM p_status_key THEN
    RAISE EXCEPTION 'O item "%" da comanda % já está % e não muda mais de status.',
      v_item."service_name", v_num, v_item."status_key"
      USING ERRCODE = '23514';
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

GRANT EXECUTE ON FUNCTION "public"."change_order_item_status"(uuid, text, jsonb) TO "authenticated";

-- ---------------------------------------------------------------------
-- 7. change_order_status — vira fan-out sobre os itens abertos
-- ---------------------------------------------------------------------
-- Continua existindo porque "cancelar a comanda" e "pausar tudo" são
-- ações legítimas de comanda inteira, e porque a comanda de um item só
-- (o caso mais comum no balcão) fica com um clique só.
--
-- Escrever direto em orders.status_key deixaria de funcionar: o próximo
-- toque em qualquer item sobrescreveria o espelho. Por isso ela agora
-- delega, e a derivação faz o resto.
CREATE OR REPLACE FUNCTION public.change_order_status(
  p_order_id   uuid,
  p_status_key text,
  p_delivery   jsonb DEFAULT NULL
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
    PERFORM public.change_order_item_status(v_item, p_status_key, p_delivery);
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

GRANT EXECUTE ON FUNCTION public.change_order_status(uuid, text, jsonb) TO "authenticated";

-- ---------------------------------------------------------------------
-- 8. create_order — agora recebe uma lista de itens
-- ---------------------------------------------------------------------
-- Aceita as DUAS formas de payload:
--
--   { items: [{service_id, quantity, total_amount, ...}, ...] }   nova
--   { service_id, quantity, total_amount, ... }                   antiga
--
-- A antiga não sobrevive por nostalgia: ela é o caso de um item só, que
-- é o mais comum no balcão, e mantê-la deixa o front migrar sem que uma
-- aba aberta com o bundle velho quebre na cara do operador.
--
-- `photos[].item_index` (base 0) amarra a foto ao item correspondente.
-- Sem ele a foto fica na comanda — que é o certo para o monte que o
-- cliente larga no balcão no recebimento.
CREATE OR REPLACE FUNCTION public.create_order(p_payload jsonb)
 RETURNS orders
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_order        public.orders;
  v_number       integer;
  v_customer     public.customers;
  v_service      public.services;
  v_itens        jsonb;
  v_item         jsonb;
  v_idx          integer := 0;
  v_ids          uuid[] := ARRAY[]::uuid[];
  v_total        numeric(12,2) := 0;
  v_qty_total    integer := 0;
  v_down         numeric(12,2);
  v_method       text;
  v_due_min      timestamptz;
  v_primeiro     text;
  v_cat_primeira text;
  v_qty          integer;
  v_valor        numeric(12,2);
  v_due          timestamptz;
  v_staff        uuid;
  v_cat          text;
  v_photos       jsonb;
  v_photo        jsonb;
  v_photo_count  integer := 0;
  v_photo_item   uuid;
  v_cat_down     uuid;
  v_cat_recv     uuid;
  v_exige_foto   boolean;
  v_novo_item    public.order_items;
BEGIN
  IF NOT (public.can_write('service_desk') OR public.can_write('orders')) THEN
    RAISE EXCEPTION 'Sem permissão para criar comandas.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_customer
  FROM public.customers
  WHERE "id" = (p_payload->>'customer_id')::uuid AND "deleted_at" IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cliente não encontrado.' USING ERRCODE = 'P0001';
  END IF;

  -- Normaliza a forma antiga para a nova antes de qualquer outra coisa.
  v_itens := p_payload->'items';
  IF v_itens IS NULL OR jsonb_array_length(v_itens) = 0 THEN
    IF (p_payload->>'service_id') IS NULL THEN
      RAISE EXCEPTION 'Informe ao menos um serviço para abrir a comanda.' USING ERRCODE = '23514';
    END IF;
    v_itens := jsonb_build_array(jsonb_build_object(
      'service_id',        p_payload->>'service_id',
      'quantity',          p_payload->>'quantity',
      'total_amount',      p_payload->>'total_amount',
      'assigned_staff_id', p_payload->>'assigned_staff_id',
      'due_date',          p_payload->>'due_date',
      'category_key',      p_payload->>'category_key',
      'description',       p_payload->>'description'
    ));
  END IF;

  v_down   := round(coalesce((p_payload->>'down_payment')::numeric, 0), 2);
  v_method := NULLIF(p_payload->>'down_payment_method_key', '');

  -- ---- primeira passada: valida e soma, ainda sem gravar nada --------
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_itens) LOOP
    SELECT * INTO v_service
    FROM public.services
    WHERE "id" = (v_item->>'service_id')::uuid AND "deleted_at" IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Serviço não encontrado.' USING ERRCODE = 'P0001';
    END IF;

    v_qty   := greatest(1, coalesce((v_item->>'quantity')::integer, 1));
    v_valor := round(coalesce((v_item->>'total_amount')::numeric, v_service."base_price" * v_qty), 2);

    IF v_valor < 0 THEN
      RAISE EXCEPTION 'O valor do item não pode ser negativo.' USING ERRCODE = '23514';
    END IF;

    v_due := coalesce(
      (v_item->>'due_date')::timestamptz,
      (p_payload->>'due_date')::timestamptz,
      now() + (v_service."lead_time_days" || ' days')::interval
    );

    v_total     := v_total + v_valor;
    v_qty_total := v_qty_total + v_qty;
    v_due_min   := least(coalesce(v_due_min, v_due), v_due);

    IF v_idx = 0 THEN
      v_primeiro     := v_service."name";
      v_cat_primeira := coalesce(NULLIF(v_item->>'category_key', ''), v_service."category_key");
    END IF;
    v_idx := v_idx + 1;
  END LOOP;

  IF v_total <= 0 THEN
    RAISE EXCEPTION 'Valor total deve ser maior que zero.' USING ERRCODE = '23514';
  END IF;
  IF v_down > v_total THEN
    RAISE EXCEPTION 'Entrada não pode exceder o valor total da comanda.' USING ERRCODE = '23514';
  END IF;
  IF (v_down > 0) <> (v_method IS NOT NULL) THEN
    RAISE EXCEPTION 'Forma de pagamento é obrigatória quando há entrada, e proibida quando não há.'
      USING ERRCODE = '23514';
  END IF;

  -- Foto antes de consumir a numeração: comanda recusada não queima número.
  SELECT "require_photo_on_intake" INTO v_exige_foto FROM public.app_settings WHERE "id";
  IF coalesce(v_exige_foto, false)
     AND jsonb_array_length(coalesce(p_payload->'photos', '[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'É obrigatório anexar ao menos uma foto do item recebido para abrir a comanda.'
      USING ERRCODE = '23514';
  END IF;

  UPDATE public.app_settings
  SET "order_next_number" = "order_next_number" + 1
  WHERE "id"
  RETURNING "order_next_number" - 1 INTO v_number;

  IF v_number IS NULL THEN
    RAISE EXCEPTION 'app_settings não inicializada — rode o seed de produção.' USING ERRCODE = 'P0001';
  END IF;

  -- ---- comanda: os campos derivados entram já calculados -------------
  -- A trigger de derivação reescreve estes mesmos valores quando os itens
  -- entrarem; gravá-los aqui é o que satisfaz os NOT NULL e os CHECK de
  -- `orders` no instante do INSERT.
  INSERT INTO public.orders (
    "number", "customer_id", "category_key", "service_id", "service_name",
    "description", "quantity", "notes", "due_date", "assigned_staff_id",
    "status_key", "total_amount", "down_payment", "down_payment_method_key", "created_by"
  )
  VALUES (
    v_number, v_customer."id", v_cat_primeira, NULL,
    v_primeiro || CASE WHEN v_idx > 1 THEN ' +' || (v_idx - 1) ELSE '' END,
    coalesce(p_payload->>'description', ''), v_qty_total, coalesce(p_payload->>'notes', ''),
    v_due_min, NULL, 'recebida', v_total, v_down, v_method, auth.uid()
  )
  RETURNING * INTO v_order;

  -- ---- segunda passada: grava os itens -------------------------------
  v_idx := 0;
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_itens) LOOP
    SELECT * INTO v_service
    FROM public.services WHERE "id" = (v_item->>'service_id')::uuid;

    v_qty   := greatest(1, coalesce((v_item->>'quantity')::integer, 1));
    v_valor := round(coalesce((v_item->>'total_amount')::numeric, v_service."base_price" * v_qty), 2);
    v_cat   := coalesce(NULLIF(v_item->>'category_key', ''), v_service."category_key");
    v_staff := coalesce((v_item->>'assigned_staff_id')::uuid, v_service."default_staff_id");
    v_due   := coalesce(
      (v_item->>'due_date')::timestamptz,
      (p_payload->>'due_date')::timestamptz,
      now() + (v_service."lead_time_days" || ' days')::interval
    );

    INSERT INTO public.order_items (
      "order_id", "position", "category_key", "service_id", "service_name",
      "description", "quantity", "total_amount", "due_date", "assigned_staff_id",
      "status_key", "created_by"
    )
    VALUES (
      v_order."id", v_idx + 1, v_cat, v_service."id", v_service."name",
      coalesce(v_item->>'description', ''), v_qty, v_valor, v_due, v_staff,
      'recebida', auth.uid()
    )
    RETURNING * INTO v_novo_item;

    v_ids := v_ids || v_novo_item."id";
    v_idx := v_idx + 1;
  END LOOP;

  -- ---- fotos ---------------------------------------------------------
  v_photos := coalesce(p_payload->'photos', '[]'::jsonb);
  FOR v_photo IN SELECT * FROM jsonb_array_elements(v_photos) LOOP
    v_photo_item := NULL;
    IF (v_photo->>'item_index') IS NOT NULL THEN
      v_photo_item := v_ids[(v_photo->>'item_index')::integer + 1];
    END IF;

    INSERT INTO public.order_photos (
      "order_id", "order_item_id", "kind", "caption", "storage_path", "gradient_seed", "created_by"
    )
    VALUES (
      v_order."id", v_photo_item,
      coalesce(NULLIF(v_photo->>'kind', ''), 'antes'),
      coalesce(v_photo->>'caption', ''),
      NULLIF(v_photo->>'storage_path', ''),
      coalesce(NULLIF(v_photo->>'gradient_seed', ''), v_cat_primeira || '-0'),
      auth.uid()
    );
    v_photo_count := v_photo_count + 1;
  END LOOP;

  -- ---- eventos -------------------------------------------------------
  PERFORM public.log_order_event(
    v_order."id", 'Comanda criada',
    v_idx || ' item(ns) · R$ ' || to_char(v_total, 'FM999999990.00')
  );

  IF v_photo_count > 0 THEN
    PERFORM public.log_order_event(
      v_order."id", 'Fotos anexadas', v_photo_count || ' foto(s) no recebimento'
    );
  END IF;

  IF v_down > 0 THEN
    PERFORM public.log_order_event(
      v_order."id", 'Entrada registrada', 'R$ ' || to_char(v_down, 'FM999999990.00')
    );
  END IF;

  -- ---- regra 30: lançamentos financeiros (nível comanda) -------------
  -- Continuam na comanda, não no item: o cliente paga uma conta só, e é
  -- exatamente isso que o bloco 3 veio consertar.
  SELECT "id" INTO v_cat_down
  FROM public.ledger_categories
  WHERE "kind" = 'income' AND "is_system" AND "name" = 'Entrada de comanda' AND "deleted_at" IS NULL
  LIMIT 1;

  SELECT "id" INTO v_cat_recv
  FROM public.ledger_categories
  WHERE "kind" = 'income' AND "deleted_at" IS NULL
    AND "auto_for_service_category" = v_cat_primeira
  LIMIT 1;

  IF v_cat_recv IS NULL THEN
    SELECT "id" INTO v_cat_recv
    FROM public.ledger_categories
    WHERE "kind" = 'income' AND "is_system" AND "name" = 'Outros recebimentos' AND "deleted_at" IS NULL
    LIMIT 1;
  END IF;

  -- Recarrega para pegar o espelho já derivado pelos itens.
  SELECT * INTO v_order FROM public.orders WHERE "id" = v_order."id";

  IF v_down > 0 AND v_cat_down IS NOT NULL THEN
    INSERT INTO public.ledger_entries (
      "kind", "description", "category_id", "amount", "entry_date", "status_key",
      "method_key", "order_id", "customer_id", "staff_id",
      "auto_generated", "auto_role", "created_by"
    )
    VALUES (
      'income', 'Entrada · ' || v_order."service_name", v_cat_down, v_down, v_order."created_at",
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
      'income', 'Saldo a receber · ' || v_order."service_name", v_cat_recv, v_order."balance", v_due_min,
      CASE WHEN v_down > 0 THEN 'parcial' ELSE 'pendente' END,
      NULL, v_order."id", v_customer."id", v_order."assigned_staff_id",
      true, 'receivable', auth.uid()
    );
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE "id" = v_order."id";
  RETURN v_order;
END;
$function$
;

GRANT EXECUTE ON FUNCTION public.create_order(jsonb) TO "authenticated";

-- ---------------------------------------------------------------------
-- 9. update_order_item — editar um item da comanda
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."update_order_item"(
  "p_item_id" uuid,
  "p_patch"   jsonb
)
    RETURNS "public"."order_items"
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_item    public.order_items;
  v_antes   public.order_items;
  v_order   public.orders;
  v_service public.services;
  v_final   boolean;
  v_novo    numeric(12,2);
BEGIN
  IF NOT (public.can_write('orders') OR public.can_write('production')) THEN
    RAISE EXCEPTION 'Sem permissão para editar itens da comanda.' USING ERRCODE = '42501';
  END IF;

  SELECT i.* INTO v_antes
  FROM public.order_items i
  JOIN public.orders o ON o."id" = i."order_id"
  WHERE i."id" = p_item_id AND o."deleted_at" IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item não encontrado.' USING ERRCODE = 'P0001';
  END IF;

  SELECT s."is_final" INTO v_final
  FROM public.order_statuses s WHERE s."key" = v_antes."status_key";

  IF v_final THEN
    RAISE EXCEPTION 'Este item já foi finalizado e não pode mais ser editado.'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE "id" = v_antes."order_id";

  -- O total da COMANDA não pode cair abaixo do que já foi recebido. A
  -- checagem é no nível da comanda porque o pagamento é da comanda.
  v_novo := coalesce(round((p_patch->>'total_amount')::numeric, 2), v_antes."total_amount");
  IF (v_order."total_amount" - v_antes."total_amount" + v_novo) < v_order."amount_paid" THEN
    RAISE EXCEPTION 'O valor da comanda não pode ficar menor que o já pago (R$ %).',
      to_char(v_order."amount_paid", 'FM999G999G990D00')
      USING ERRCODE = '23514';
  END IF;

  IF p_patch ? 'service_id' AND (p_patch->>'service_id') IS NOT NULL THEN
    SELECT * INTO v_service FROM public.services
    WHERE "id" = (p_patch->>'service_id')::uuid AND "deleted_at" IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Serviço não encontrado.' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  UPDATE public.order_items i
  SET "description"       = coalesce(p_patch->>'description', i."description"),
      "quantity"          = coalesce((p_patch->>'quantity')::integer, i."quantity"),
      "total_amount"      = v_novo,
      "due_date"          = coalesce((p_patch->>'due_date')::timestamptz, i."due_date"),
      "assigned_staff_id" = CASE
                              WHEN p_patch ? 'assigned_staff_id'
                              THEN (p_patch->>'assigned_staff_id')::uuid
                              ELSE i."assigned_staff_id"
                            END,
      "service_id"        = CASE
                              WHEN p_patch ? 'service_id'
                              THEN (p_patch->>'service_id')::uuid
                              ELSE i."service_id"
                            END,
      "service_name"      = coalesce(v_service."name", i."service_name"),
      "category_key"      = coalesce(p_patch->>'category_key', v_service."category_key", i."category_key")
  WHERE i."id" = p_item_id
  RETURNING * INTO v_item;

  RETURN v_item;
END;
$$;

GRANT EXECUTE ON FUNCTION "public"."update_order_item"(uuid, jsonb) TO "authenticated";

-- ---------------------------------------------------------------------
-- 10. Relatórios por serviço e por categoria passam a ler dos itens
-- ---------------------------------------------------------------------
-- Sem isto, "Cópia de chave +2" viraria uma linha própria no ranking de
-- serviços e a categoria da comanda seria a do primeiro item, escondendo
-- os outros. São as duas únicas funções cujo resultado muda de verdade
-- com o bloco 3 — as demais agregam por comanda, e a comanda continua
-- sendo uma só.
CREATE OR REPLACE FUNCTION "public"."report_top_services"(
  "p_limit" integer DEFAULT 8,
  "p_from"  date DEFAULT NULL,
  "p_to"    date DEFAULT NULL
)
    RETURNS TABLE ("service_name" text, "category_key" text, "quantity" bigint, "amount" numeric)
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  SELECT
    i."service_name",
    min(i."category_key"),
    sum(i."quantity")::bigint,
    coalesce(sum(i."total_amount"), 0)
  FROM order_items i
  JOIN orders o ON o."id" = i."order_id"
  WHERE o."deleted_at" IS NULL
    AND i."status_key" <> 'cancelada'
    AND (p_from IS NULL OR o."created_at" >= (p_from::timestamp AT TIME ZONE 'America/Sao_Paulo'))
    AND (p_to   IS NULL OR o."created_at" <  ((p_to + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo'))
  GROUP BY i."service_name"
  ORDER BY sum(i."quantity") DESC
  LIMIT greatest(1, coalesce(p_limit, 8));
$$;

GRANT EXECUTE ON FUNCTION "public"."report_top_services"(integer, date, date) TO "authenticated";

CREATE OR REPLACE FUNCTION "public"."report_by_category"(
  "p_from" date DEFAULT NULL,
  "p_to"   date DEFAULT NULL
)
    RETURNS TABLE ("category_key" text, "label" text, "color" text, "orders" bigint, "amount" numeric)
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  SELECT
    sc."key", sc."label", sc."color",
    -- Conta ITENS, não comandas: uma comanda com chave e sapato entra em
    -- duas categorias, e somar 1 comanda em cada uma seria contar duas.
    count(i."id"),
    coalesce(sum(i."total_amount"), 0)
  FROM service_categories sc
  LEFT JOIN order_items i ON i."category_key" = sc."key"
    AND i."status_key" <> 'cancelada'
    AND EXISTS (
      SELECT 1 FROM orders o
      WHERE o."id" = i."order_id"
        AND o."deleted_at" IS NULL
        AND (p_from IS NULL OR o."created_at" >= (p_from::timestamp AT TIME ZONE 'America/Sao_Paulo'))
        AND (p_to   IS NULL OR o."created_at" <  ((p_to + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo'))
    )
  GROUP BY sc."key", sc."label", sc."color", sc."sort_order"
  HAVING count(i."id") > 0
  ORDER BY sc."sort_order";
$$;

GRANT EXECUTE ON FUNCTION "public"."report_by_category"(date, date) TO "authenticated";

-- ---------------------------------------------------------------------
-- 11. Realtime
-- ---------------------------------------------------------------------
-- Sem isto o Kanban da Produção não se move sozinho: quem muda agora é o
-- item, e a publicação só conhecia `orders`.
ALTER PUBLICATION "supabase_realtime" ADD TABLE "public"."order_items";

-- ---------------------------------------------------------------------
-- 12. Backfill do banco que já roda
-- ---------------------------------------------------------------------
-- Num banco novo isto pega zero linhas (os seeds ainda não rodaram) e
-- quem preenche é a chamada no fim de seed_prod.sql / seed_demo.sql.
SELECT public.backfill_order_items();
