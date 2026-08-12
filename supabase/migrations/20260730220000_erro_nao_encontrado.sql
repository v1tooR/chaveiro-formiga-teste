-- =====================================================================
-- 20260730220000 — "não encontrado" para de virar 500 sem mensagem
-- ---------------------------------------------------------------------
-- SINTOMA
--
-- Toda RPC que levantava `P0002` devolvia, pela API:
--
--   HTTP 500 · "Something went wrong"
--
-- Sem corpo JSON. A mensagem em português ("Comanda não encontrada.",
-- "Serviço não encontrado.", "Usuário não encontrado.") existia no banco
-- e era descartada no caminho — o operador via só uma falha genérica.
--
-- CAUSA
--
-- O PostgREST mapeia a classe `P0` do SQLSTATE para HTTP 500, com uma
-- exceção: `P0001` (o padrão de `RAISE EXCEPTION`), que vira 400 com o
-- JSON do erro. O 500 do PostgREST é então substituído pela página de
-- erro do Kong, que não tem corpo.
--
-- Medido, com a mesma mensagem em cada código:
--
--   P0001 → 400 + {"message":"..."}   ✓
--   42501 → 403 + {"message":"..."}   ✓
--   23514 → 400 + {"message":"..."}   ✓
--   23505 → 409 + {"message":"..."}   ✓
--   P0002 → 500 + "Something went wrong"   ✗
--
-- CORREÇÃO
--
-- `P0002` → `P0001` nas 9 funções afetadas. Nada além do código de erro
-- muda: os corpos abaixo foram extraídos de `pg_get_functiondef` do banco
-- em produção, então preservam SECURITY DEFINER, search_path e a lógica
-- exata de cada uma.
--
-- O front continua traduzindo por SQLSTATE (src/lib/supabase.ts), mas o
-- caminho preferido já era outro: `mensagemErro` devolve a mensagem da
-- própria RPC quando ela tem acento — e agora ela chega.
--
-- Defeito PRÉ-EXISTENTE: `duplicate_service` e `create_order` já usavam
-- P0002 desde a 20260729120500.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.change_order_status(p_order_id uuid, p_status_key text)
 RETURNS orders
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    RAISE EXCEPTION 'Comanda não encontrada.' USING ERRCODE = 'P0001';
  END IF;

  RETURN v_order;
END;
$function$
;

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

CREATE OR REPLACE FUNCTION public.delete_customer(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_row      public.customers;
  v_comandas integer;
BEGIN
  IF NOT public.can_write('customers') THEN
    RAISE EXCEPTION 'Sem permissão para excluir clientes.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_row FROM public.customers WHERE "id" = p_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cliente não encontrado.' USING ERRCODE = 'P0001';
  END IF;

  IF v_row."deleted_at" IS NOT NULL THEN
    RETURN;
  END IF;

  SELECT count(*) INTO v_comandas
  FROM public.orders
  WHERE "customer_id" = p_id AND "deleted_at" IS NULL;

  IF v_comandas > 0 THEN
    RAISE EXCEPTION
      'Cliente tem % comanda(s) no histórico e não pode ser excluído. Use "Bloquear" para tirá-lo do atendimento sem perder o histórico.',
      v_comandas
      USING ERRCODE = '23514';
  END IF;

  -- `customers_phone_unique` é índice parcial (WHERE deleted_at IS NULL),
  -- então excluir libera o telefone para recadastro.
  UPDATE public.customers SET "deleted_at" = now() WHERE "id" = p_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.delete_ledger_entry(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_row public.ledger_entries;
  v_num integer;
BEGIN
  IF NOT public.can_write('finance') THEN
    RAISE EXCEPTION 'Sem permissão para excluir lançamentos.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_row FROM public.ledger_entries WHERE "id" = p_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lançamento não encontrado.' USING ERRCODE = 'P0001';
  END IF;

  -- Idempotente: dois cliques no botão não viram erro na cara do operador.
  IF v_row."deleted_at" IS NOT NULL THEN
    RETURN;
  END IF;

  IF v_row."auto_generated" THEN
    SELECT o."number" INTO v_num FROM public.orders o WHERE o."id" = v_row."order_id";
    RAISE EXCEPTION
      'Este lançamento foi gerado automaticamente pela comanda %. Para anular o valor, cancele ou ajuste a comanda.',
      coalesce(v_num::text, 'vinculada')
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.ledger_entries SET "deleted_at" = now() WHERE "id" = p_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.duplicate_service(p_service_id uuid)
 RETURNS services
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_base public.services;
  v_new  public.services;
  v_name text;
  v_n    integer := 1;
BEGIN
  IF NOT public.can_write('services') THEN
    RAISE EXCEPTION 'Sem permissão para duplicar serviços.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_base
  FROM public.services
  WHERE "id" = p_service_id AND "deleted_at" IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Serviço % não encontrado.', p_service_id USING ERRCODE = 'P0001';
  END IF;

  -- O nome é único; se "(cópia)" já existir, numera.
  v_name := v_base."name" || ' (cópia)';
  WHILE EXISTS (
    SELECT 1 FROM public.services
    WHERE lower(btrim("name")) = lower(btrim(v_name)) AND "deleted_at" IS NULL
  ) LOOP
    v_n := v_n + 1;
    v_name := v_base."name" || ' (cópia ' || v_n || ')';
  END LOOP;

  INSERT INTO public.services (
    "name", "category_key", "description", "base_price",
    "lead_time_days", "default_staff_id", "active", "notes", "created_by"
  )
  VALUES (
    v_name, v_base."category_key", v_base."description", v_base."base_price",
    v_base."lead_time_days", v_base."default_staff_id", v_base."active", v_base."notes", auth.uid()
  )
  RETURNING * INTO v_new;

  RETURN v_new;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.register_order_payment(p_order_id uuid, p_amount numeric, p_method_key text, p_note text DEFAULT ''::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    RAISE EXCEPTION 'Comanda não encontrada.' USING ERRCODE = 'P0001';
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
$function$
;

CREATE OR REPLACE FUNCTION public.set_profile_active(p_profile_id uuid, p_active boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_nome  text;
  v_atual boolean;
BEGIN
  IF NOT public.is_owner() THEN
    RAISE EXCEPTION 'Somente o responsável pode ativar ou desativar acessos.' USING ERRCODE = '42501';
  END IF;

  IF p_profile_id = auth.uid() AND NOT p_active THEN
    RAISE EXCEPTION 'Você não pode desativar o próprio acesso.' USING ERRCODE = '42501';
  END IF;

  SELECT p."full_name", p."is_active" INTO v_nome, v_atual
  FROM public.profiles p WHERE p."id" = p_profile_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Usuário não encontrado.' USING ERRCODE = 'P0001';
  END IF;

  IF v_atual = p_active THEN
    RETURN; -- idempotente
  END IF;

  IF NOT p_active AND private.other_active_owners(p_profile_id) = 0 THEN
    RAISE EXCEPTION
      '% é o único responsável ativo: desativá-lo deixaria o sistema sem administrador.', v_nome
      USING ERRCODE = '23514';
  END IF;

  UPDATE public.profiles SET "is_active" = p_active WHERE "id" = p_profile_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.set_profile_role(p_profile_id uuid, p_role_key text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_nome     text;
  v_era      text;
  v_vai_ter  boolean;
BEGIN
  IF NOT public.is_owner() THEN
    RAISE EXCEPTION 'Somente o responsável pode alterar papéis de acesso.' USING ERRCODE = '42501';
  END IF;

  IF p_profile_id = auth.uid() THEN
    RAISE EXCEPTION 'Você não pode alterar o próprio papel de acesso.' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.roles WHERE "key" = p_role_key) THEN
    RAISE EXCEPTION 'Papel "%" não existe.', p_role_key USING ERRCODE = '23514';
  END IF;

  SELECT p."full_name", p."role_key" INTO v_nome, v_era
  FROM public.profiles p WHERE p."id" = p_profile_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Usuário não encontrado.' USING ERRCODE = 'P0001';
  END IF;

  IF v_era = p_role_key THEN
    RETURN; -- idempotente
  END IF;

  -- Cinto de segurança: hoje inalcançável (a guarda de auto-alteração já
  -- barra), mas sobrevive a uma mudança futura de policy.
  SELECT rm."can_write" INTO v_vai_ter
  FROM public.role_modules rm
  WHERE rm."role_key" = p_role_key AND rm."module_key" = 'settings';

  IF NOT coalesce(v_vai_ter, false) AND private.other_active_owners(p_profile_id) = 0 THEN
    RAISE EXCEPTION
      '% é o único responsável ativo. Promova outra pessoa antes de rebaixá-lo.', v_nome
      USING ERRCODE = '23514';
  END IF;

  UPDATE public.profiles SET "role_key" = p_role_key WHERE "id" = p_profile_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_order(p_order_id uuid, p_patch jsonb, p_event_title text DEFAULT NULL::text)
 RETURNS orders
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    RAISE EXCEPTION 'Comanda não encontrada.' USING ERRCODE = 'P0001';
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
      RAISE EXCEPTION 'Serviço não encontrado.' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF p_patch ? 'customer_id' AND NOT EXISTS (
    SELECT 1 FROM public.customers
    WHERE "id" = (p_patch->>'customer_id')::uuid AND "deleted_at" IS NULL
  ) THEN
    RAISE EXCEPTION 'Cliente não encontrado.' USING ERRCODE = 'P0001';
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
$function$
;

