-- =====================================================================
-- 20260729120900 — Automações: o que o front espera que "aconteça sozinho"
-- ---------------------------------------------------------------------
-- Tudo que hoje está espalhado nas actions do Zustand vira trigger:
--   regra 13  amount_paid = entrada + Σ pagamentos
--   regra 22  delivered_at gravado ao entrar em `entregue`
--   regra 23  status final trava a comanda
--   regra 27  status do cliente derivado do histórico
--   regra 31  baixa/ajuste das pendências ao receber pagamento
-- =====================================================================

-- ---------------------------------------------------------------------
-- Regra 13 — total pago  ← totalPago() (src/lib/utils.ts:87)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."recalc_order_amount_paid"("p_order_id" uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  UPDATE public.orders o
  SET "amount_paid" = o."down_payment" + coalesce((
        SELECT sum(p."amount") FROM public.order_payments p WHERE p."order_id" = o."id"
      ), 0)
  WHERE o."id" = p_order_id;
END;
$$;

COMMENT ON FUNCTION "public"."recalc_order_amount_paid"(uuid) IS
  'Regra 13. balance e is_settled são GENERATED e acompanham automaticamente.';


CREATE OR REPLACE FUNCTION "public"."trg_order_payments_recalc"() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  PERFORM public.recalc_order_amount_paid(coalesce(NEW."order_id", OLD."order_id"));
  RETURN coalesce(NEW, OLD);
END;
$$;

CREATE TRIGGER "order_payments_recalc_order"
    AFTER INSERT OR DELETE ON "public"."order_payments"
    FOR EACH ROW EXECUTE FUNCTION "public"."trg_order_payments_recalc"();


-- Entrada alterada na edição da comanda → recalcula na mesma linha
-- (BEFORE, sem UPDATE recursivo).
CREATE OR REPLACE FUNCTION "public"."trg_orders_sync_amount_paid"() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW."amount_paid" := NEW."down_payment";
  ELSIF NEW."down_payment" IS DISTINCT FROM OLD."down_payment" THEN
    NEW."amount_paid" := NEW."down_payment" + coalesce((
      SELECT sum(p."amount") FROM public.order_payments p WHERE p."order_id" = NEW."id"
    ), 0);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "orders_sync_amount_paid"
    BEFORE INSERT OR UPDATE OF "down_payment" ON "public"."orders"
    FOR EACH ROW EXECUTE FUNCTION "public"."trg_orders_sync_amount_paid"();


-- ---------------------------------------------------------------------
-- Regras 22 e 23 — trava de status final e delivered_at
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."trg_orders_guard_status"() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
DECLARE
  v_old_final boolean;
  v_new_final boolean;
BEGIN
  IF NEW."status_key" IS NOT DISTINCT FROM OLD."status_key" THEN
    RETURN NEW;
  END IF;

  SELECT "is_final" INTO v_old_final FROM public.order_statuses WHERE "key" = OLD."status_key";
  SELECT "is_final" INTO v_new_final FROM public.order_statuses WHERE "key" = NEW."status_key";

  -- Regra 23: entregue/cancelada travam a comanda (finalizada, ComandaDetalhe.tsx:103).
  IF v_old_final THEN
    RAISE EXCEPTION 'Comanda % está finalizada (%) e não pode mudar de status.',
      NEW."number", OLD."status_key"
      USING ERRCODE = '23514';
  END IF;

  -- Regra 22: marca a data de entrega (useApp.ts:254).
  IF NEW."status_key" = 'entregue' AND NEW."delivered_at" IS NULL THEN
    NEW."delivered_at" := now();
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "orders_guard_status"
    BEFORE UPDATE OF "status_key" ON "public"."orders"
    FOR EACH ROW EXECUTE FUNCTION "public"."trg_orders_guard_status"();


-- ---------------------------------------------------------------------
-- Evento de histórico + repercussão financeira da mudança de status
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."trg_orders_after_status_change"() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_description text;
BEGIN
  SELECT "description" INTO v_description
  FROM public.order_statuses WHERE "key" = NEW."status_key";

  PERFORM public.log_order_event(NEW."id", 'Status alterado', v_description);

  -- Entregue com saldo em aberto → a pendência automática vence
  -- (espelha entregueSemPagar → 'vencido', seed.ts:465).
  IF NEW."status_key" = 'entregue' AND NOT NEW."is_settled" THEN
    UPDATE public.ledger_entries
    SET "status_key" = 'vencido'
    WHERE "order_id" = NEW."id"
      AND "auto_generated"
      AND "auto_role" = 'receivable'
      AND "deleted_at" IS NULL
      AND "status_key" IN ('previsto', 'pendente', 'parcial');
  END IF;

  -- Cancelada → lançamentos automáticos ainda abertos são cancelados.
  -- O front simplesmente ignora comandas canceladas no financeiro
  -- (seed.ts:412); no banco isso precisa ser explícito.
  IF NEW."status_key" = 'cancelada' THEN
    UPDATE public.ledger_entries le
    SET "status_key" = 'cancelado'
    WHERE le."order_id" = NEW."id"
      AND le."auto_generated"
      AND le."deleted_at" IS NULL
      AND EXISTS (
        SELECT 1 FROM public.ledger_statuses s
        WHERE s."key" = le."status_key" AND s."counts_as_open"
      );
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "orders_after_status_change"
    AFTER UPDATE OF "status_key" ON "public"."orders"
    FOR EACH ROW
    WHEN (OLD."status_key" IS DISTINCT FROM NEW."status_key")
    EXECUTE FUNCTION "public"."trg_orders_after_status_change"();


-- ---------------------------------------------------------------------
-- Regra 27 — status do cliente derivado
-- ← aplicarStatusClientes() (src/data/seed.ts:546)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."recalc_customer_status"("p_customer_id" uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_count    integer;
  v_pending  numeric(12,2);
  v_new      text;
  v_current  text;
  v_derived  boolean;
BEGIN
  IF p_customer_id IS NULL THEN
    RETURN;
  END IF;

  SELECT c."status_key", coalesce(cs."is_derived", true)
  INTO v_current, v_derived
  FROM public.customers c
  LEFT JOIN public.customer_statuses cs ON cs."key" = c."status_key"
  WHERE c."id" = p_customer_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- `bloqueado` é decisão manual e nunca é sobrescrita (is_derived = false).
  IF NOT v_derived THEN
    RETURN;
  END IF;

  SELECT count(*), coalesce(sum(o."balance"), 0)
  INTO v_count, v_pending
  FROM public.orders o
  WHERE o."customer_id" = p_customer_id
    AND o."deleted_at" IS NULL
    AND o."status_key" <> 'cancelada';

  v_new := CASE
    WHEN v_count = 0        THEN 'inativo'
    WHEN v_pending > 0.01   THEN 'pendencia'
    WHEN v_count >= 3       THEN 'recorrente'
    WHEN v_count = 1        THEN 'novo'
    ELSE 'ativo'
  END;

  IF v_new IS DISTINCT FROM v_current THEN
    UPDATE public.customers SET "status_key" = v_new WHERE "id" = p_customer_id;
  END IF;
END;
$$;

COMMENT ON FUNCTION "public"."recalc_customer_status"(uuid) IS
  'Regra 27. Preserva `bloqueado` (customer_statuses.is_derived = false).';


CREATE OR REPLACE FUNCTION "public"."trg_orders_recalc_customer"() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  PERFORM public.recalc_customer_status(coalesce(NEW."customer_id", OLD."customer_id"));
  -- Comanda transferida de cliente: recalcula os dois lados.
  IF TG_OP = 'UPDATE' AND NEW."customer_id" IS DISTINCT FROM OLD."customer_id" THEN
    PERFORM public.recalc_customer_status(OLD."customer_id");
  END IF;
  RETURN coalesce(NEW, OLD);
END;
$$;

CREATE TRIGGER "orders_recalc_customer"
    AFTER INSERT OR DELETE ON "public"."orders"
    FOR EACH ROW EXECUTE FUNCTION "public"."trg_orders_recalc_customer"();

-- No UPDATE só interessam as colunas que entram no cálculo.
CREATE TRIGGER "orders_recalc_customer_on_change"
    AFTER UPDATE OF "customer_id", "status_key", "amount_paid", "total_amount", "deleted_at"
    ON "public"."orders"
    FOR EACH ROW EXECUTE FUNCTION "public"."trg_orders_recalc_customer"();


-- =====================================================================
-- RPC create_order  ← criarComanda() (src/store/useApp.ts:154)
-- ---------------------------------------------------------------------
-- Numeração + comanda + fotos + eventos + 1-2 lançamentos, atômico.
-- Regra 17: o número é consumido com SELECT ... FOR UPDATE. Dois
-- atendentes clicando ao mesmo tempo não geram o mesmo número.
-- =====================================================================
CREATE OR REPLACE FUNCTION "public"."create_order"("p_payload" jsonb)
    RETURNS "public"."orders"
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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
BEGIN
  IF NOT (public.can_write('service_desk') OR public.can_write('orders')) THEN
    RAISE EXCEPTION 'Sem permissão para criar comandas.' USING ERRCODE = '42501';
  END IF;

  -- ---- validação de entrada -----------------------------------------
  SELECT * INTO v_customer
  FROM public.customers
  WHERE "id" = (p_payload->>'customer_id')::uuid AND "deleted_at" IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cliente não encontrado.' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_service
  FROM public.services
  WHERE "id" = (p_payload->>'service_id')::uuid AND "deleted_at" IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Serviço não encontrado.' USING ERRCODE = 'P0002';
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

  -- ---- regra 17: número sequencial atômico --------------------------
  UPDATE public.app_settings
  SET "order_next_number" = "order_next_number" + 1
  WHERE "id"
  RETURNING "order_next_number" - 1 INTO v_number;

  IF v_number IS NULL THEN
    RAISE EXCEPTION 'app_settings não inicializada — rode o seed de produção.' USING ERRCODE = 'P0002';
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
$$;

COMMENT ON FUNCTION "public"."create_order"(jsonb) IS
  'Cria comanda (numeração atômica + fotos + eventos + lançamentos). Regras 8-12, 17, 30, 33.';

REVOKE ALL ON FUNCTION "public"."create_order"(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."create_order"(jsonb) TO "authenticated";


-- =====================================================================
-- RPC register_order_payment  ← registrarPagamento() (useApp.ts:289)
-- ---------------------------------------------------------------------
-- Regras 16 e 31: nunca recebe mais que o saldo; quitou → baixa as
-- pendências; não quitou → ajusta a parcial para o saldo restante.
-- =====================================================================
CREATE OR REPLACE FUNCTION "public"."register_order_payment"(
    "p_order_id"   uuid,
    "p_amount"     numeric,
    "p_method_key" text,
    "p_note"       text DEFAULT ''
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_order    public.orders;
  v_applied  numeric(12,2);
  v_cat      uuid;
  v_payment  public.order_payments;
BEGIN
  IF NOT (public.can_write('finance') OR public.can_write('service_desk') OR public.can_write('orders')) THEN
    RAISE EXCEPTION 'Sem permissão para registrar pagamentos.' USING ERRCODE = '42501';
  END IF;

  -- Lock da comanda: dois caixas recebendo ao mesmo tempo não passam do saldo.
  SELECT * INTO v_order FROM public.orders
  WHERE "id" = p_order_id AND "deleted_at" IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Comanda não encontrada.' USING ERRCODE = 'P0002';
  END IF;

  IF v_order."status_key" = 'cancelada' THEN
    RAISE EXCEPTION 'Comanda cancelada não recebe pagamento.' USING ERRCODE = '23514';
  END IF;

  IF v_order."balance" <= 0.009 THEN
    RAISE EXCEPTION 'Comanda % já está quitada.', v_order."number" USING ERRCODE = '23514';
  END IF;

  IF coalesce(p_amount, 0) <= 0 THEN
    RAISE EXCEPTION 'Valor do pagamento deve ser maior que zero.' USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.payment_methods WHERE "key" = p_method_key AND "active") THEN
    RAISE EXCEPTION 'Forma de pagamento "%" inválida ou inativa.', p_method_key USING ERRCODE = '23514';
  END IF;

  -- Regra 16: espelha Math.min(valor, emAberto) (RegistrarPagamento.tsx:78).
  v_applied := round(least(p_amount, v_order."balance"), 2);

  INSERT INTO public.order_payments (
    "order_id", "amount", "method_key", "received_by_staff_id", "note", "created_by"
  )
  VALUES (
    p_order_id, v_applied, p_method_key, public.current_staff_id(), coalesce(p_note, ''), auth.uid()
  )
  RETURNING * INTO v_payment;

  -- A entrada da comanda só define a forma quando ainda não havia nenhuma
  -- (x.formaPagamento ?? forma, useApp.ts:301). Sem entrada, não se inventa.

  PERFORM public.log_order_event(
    p_order_id, 'Pagamento registrado',
    'R$ ' || to_char(v_applied, 'FM999999990.00') || ' · ' || upper(p_method_key)
  );

  -- Lançamento do pagamento.
  SELECT "id" INTO v_cat
  FROM public.ledger_categories
  WHERE "kind" = 'income' AND "is_system" AND "name" = 'Saldo final' AND "deleted_at" IS NULL
  LIMIT 1;

  IF v_cat IS NOT NULL THEN
    INSERT INTO public.ledger_entries (
      "kind", "description", "category_id", "amount", "entry_date", "status_key",
      "method_key", "order_id", "customer_id", "staff_id",
      "auto_generated", "auto_role", "created_by"
    )
    VALUES (
      'income', 'Pagamento · ' || v_order."service_name", v_cat, v_applied, v_payment."paid_at",
      'recebido', p_method_key, p_order_id, v_order."customer_id", public.current_staff_id(),
      true, 'payment', auth.uid()
    );
  END IF;

  -- Recarrega com amount_paid/balance já atualizados pela trigger.
  SELECT * INTO v_order FROM public.orders WHERE "id" = p_order_id;

  -- ---- regra 31: baixa ou ajuste das pendências ---------------------
  IF v_order."is_settled" THEN
    UPDATE public.ledger_entries le
    SET "status_key" = 'recebido'
    WHERE le."order_id" = p_order_id
      AND le."auto_generated"
      AND le."auto_role" = 'receivable'
      AND le."deleted_at" IS NULL
      AND EXISTS (
        SELECT 1 FROM public.ledger_statuses s
        WHERE s."key" = le."status_key" AND s."counts_as_open"
      );
  ELSE
    UPDATE public.ledger_entries le
    SET "status_key" = 'parcial', "amount" = v_order."balance"
    WHERE le."order_id" = p_order_id
      AND le."auto_generated"
      AND le."auto_role" = 'receivable'
      AND le."deleted_at" IS NULL
      AND EXISTS (
        SELECT 1 FROM public.ledger_statuses s
        WHERE s."key" = le."status_key" AND s."counts_as_open"
      );
  END IF;

  RETURN jsonb_build_object(
    'payment_id',      v_payment."id",
    'applied_amount',  v_applied,
    'order_id',        v_order."id",
    'order_number',    v_order."number",
    'amount_paid',     v_order."amount_paid",
    'balance',         v_order."balance",
    'is_settled',      v_order."is_settled",
    'paid_at',         v_payment."paid_at"
  );
END;
$$;

COMMENT ON FUNCTION "public"."register_order_payment"(uuid, numeric, text, text) IS
  'Registra pagamento com lock da comanda. Regras 16 e 31. Retorna dados do recibo.';

REVOKE ALL ON FUNCTION "public"."register_order_payment"(uuid, numeric, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."register_order_payment"(uuid, numeric, text, text) TO "authenticated";


-- =====================================================================
-- RPC change_order_status  ← alterarStatus() (useApp.ts:246)
-- =====================================================================
CREATE OR REPLACE FUNCTION "public"."change_order_status"(
    "p_order_id"  uuid,
    "p_status_key" text
) RETURNS "public"."orders"
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_order public.orders;
BEGIN
  -- Ambiguidade A3: financeiro tem `orders` só em leitura e não muda status.
  IF NOT (public.can_write('orders') OR public.can_write('production')) THEN
    RAISE EXCEPTION 'Sem permissão para alterar o status da comanda.' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.order_statuses WHERE "key" = p_status_key) THEN
    RAISE EXCEPTION 'Status "%" inexistente.', p_status_key USING ERRCODE = '23514';
  END IF;

  UPDATE public.orders
  SET "status_key" = p_status_key
  WHERE "id" = p_order_id AND "deleted_at" IS NULL
  RETURNING * INTO v_order;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Comanda não encontrada.' USING ERRCODE = 'P0002';
  END IF;

  RETURN v_order;
END;
$$;

REVOKE ALL ON FUNCTION "public"."change_order_status"(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."change_order_status"(uuid, text) TO "authenticated";


-- =====================================================================
-- RPC update_order  ← atualizarComanda() (useApp.ts:233)
-- ---------------------------------------------------------------------
-- Aceita só os campos que a UI realmente edita (ModalEditar,
-- ComandaDetalhe.tsx:695; drawer da Produção, Producao.tsx:272).
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
  v_order public.orders;
BEGIN
  IF NOT (public.can_write('orders') OR public.can_write('production')) THEN
    RAISE EXCEPTION 'Sem permissão para editar comandas.' USING ERRCODE = '42501';
  END IF;

  UPDATE public.orders o
  SET
    "description"       = coalesce(p_patch->>'description', o."description"),
    "notes"             = coalesce(p_patch->>'notes', o."notes"),
    "quantity"          = coalesce((p_patch->>'quantity')::integer, o."quantity"),
    "total_amount"      = coalesce(round((p_patch->>'total_amount')::numeric, 2), o."total_amount"),
    "due_date"          = coalesce((p_patch->>'due_date')::timestamptz, o."due_date"),
    "assigned_staff_id" = CASE
                            WHEN p_patch ? 'assigned_staff_id'
                            THEN (p_patch->>'assigned_staff_id')::uuid
                            ELSE o."assigned_staff_id"
                          END
  WHERE o."id" = p_order_id AND o."deleted_at" IS NULL
  RETURNING * INTO v_order;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Comanda não encontrada.' USING ERRCODE = 'P0002';
  END IF;

  IF p_event_title IS NOT NULL THEN
    PERFORM public.log_order_event(p_order_id, p_event_title, NULL);
  END IF;

  RETURN v_order;
END;
$$;

REVOKE ALL ON FUNCTION "public"."update_order"(uuid, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."update_order"(uuid, jsonb, text) TO "authenticated";


-- =====================================================================
-- RPCs de impressão  ← marcarImpressa() / marcarEtiqueta() (useApp.ts:351)
-- =====================================================================
CREATE OR REPLACE FUNCTION "public"."mark_order_printed"("p_order_id" uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  IF NOT (public.can_write('orders') OR public.can_write('production') OR public.can_write('service_desk')) THEN
    RAISE EXCEPTION 'Sem permissão para imprimir comandas.' USING ERRCODE = '42501';
  END IF;

  UPDATE public.orders SET "order_printed" = true
  WHERE "id" = p_order_id AND "deleted_at" IS NULL;

  PERFORM public.log_order_event(p_order_id, 'Comanda impressa', NULL);
END;
$$;

-- Regra 24: só etiqueta o que ainda está na operação (Etiquetas.tsx:27).
CREATE OR REPLACE FUNCTION "public"."mark_labels_printed"("p_order_ids" uuid[]) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_id      uuid;
  v_count   integer := 0;
BEGIN
  IF NOT public.can_write('labels') THEN
    RAISE EXCEPTION 'Sem permissão para imprimir etiquetas.' USING ERRCODE = '42501';
  END IF;

  FOREACH v_id IN ARRAY coalesce(p_order_ids, ARRAY[]::uuid[]) LOOP
    UPDATE public.orders o
    SET "label_printed" = true
    WHERE o."id" = v_id
      AND o."deleted_at" IS NULL
      AND EXISTS (
        SELECT 1 FROM public.order_statuses st
        WHERE st."key" = o."status_key" AND NOT st."is_final"
      );

    IF FOUND THEN
      PERFORM public.log_order_event(v_id, 'Etiqueta impressa', NULL);
      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION "public"."mark_labels_printed"(uuid[]) IS
  'Regra 24: ignora comandas finalizadas. Retorna quantas etiquetas foram efetivamente marcadas.';

REVOKE ALL ON FUNCTION "public"."mark_order_printed"(uuid)    FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."mark_labels_printed"(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."mark_order_printed"(uuid)    TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."mark_labels_printed"(uuid[]) TO "authenticated";
