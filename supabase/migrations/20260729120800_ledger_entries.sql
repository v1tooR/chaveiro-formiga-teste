-- =====================================================================
-- 20260729120800 — Lançamentos financeiros
-- ---------------------------------------------------------------------
-- Espelha Lancamento (src/types.ts:116). Tela: Financeiro + gráficos
-- do Dashboard e Relatórios.
--
-- Exclusão: SOFT DELETE. O front oferece "Excluir lançamento"
-- (Financeiro.tsx:499), mas apagar histórico financeiro de verdade
-- destrói a conciliação — vira deleted_at, sai das listas e dos KPIs.
-- =====================================================================

CREATE TABLE "public"."ledger_entries" (
    "id"    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "kind"  text NOT NULL,

    "description"  text NOT NULL,
    "category_id"  uuid NOT NULL REFERENCES "public"."ledger_categories"("id") ON DELETE RESTRICT,
    "amount"       numeric(12,2) NOT NULL,
    "entry_date"   timestamptz NOT NULL DEFAULT now(),

    "status_key"   text NOT NULL REFERENCES "public"."ledger_statuses"("key") ON DELETE RESTRICT,
    "method_key"   text REFERENCES "public"."payment_methods"("key") ON DELETE RESTRICT,

    -- Vínculos opcionais: lançamento avulso não tem comanda nem cliente.
    "order_id"     uuid REFERENCES "public"."orders"("id")    ON DELETE SET NULL,
    "customer_id"  uuid REFERENCES "public"."customers"("id") ON DELETE SET NULL,
    "staff_id"     uuid REFERENCES "public"."staff"("id")     ON DELETE SET NULL,

    "note"  text NOT NULL DEFAULT '',

    -- Distingue o que a automação criou do que foi digitado à mão.
    -- Só o automático é reescrito por register_order_payment (regra 31).
    "auto_generated"  boolean NOT NULL DEFAULT false,
    -- Papel do lançamento automático dentro da comanda.
    "auto_role"       text,

    "created_at"  timestamptz NOT NULL DEFAULT now(),
    "updated_at"  timestamptz NOT NULL DEFAULT now(),
    "deleted_at"  timestamptz,
    "created_by"  uuid REFERENCES "public"."profiles"("id") ON DELETE SET NULL,

    CONSTRAINT "ledger_entries_kind_valid"    CHECK ("kind" IN ('income', 'expense')),
    -- Regra 28 (Financeiro.tsx:672)
    CONSTRAINT "ledger_entries_desc_min"      CHECK (char_length(btrim("description")) > 2),
    CONSTRAINT "ledger_entries_amount_positive" CHECK ("amount" > 0),
    CONSTRAINT "ledger_entries_auto_role"     CHECK (
      "auto_role" IS NULL OR "auto_role" IN ('down_payment', 'receivable', 'payment')
    ),
    -- Lançamento automático sempre pertence a uma comanda.
    CONSTRAINT "ledger_entries_auto_has_order" CHECK (NOT "auto_generated" OR "order_id" IS NOT NULL)
);

COMMENT ON TABLE  "public"."ledger_entries" IS
  'Lançamentos de entrada/saída (Lancamento, src/types.ts:116). Soft delete: preserva conciliação.';
COMMENT ON COLUMN "public"."ledger_entries"."auto_generated" IS
  'true = criado por create_order/register_order_payment. Só estes são reescritos pela automação.';
COMMENT ON COLUMN "public"."ledger_entries"."auto_role" IS
  'down_payment = entrada da comanda | receivable = saldo a receber | payment = pagamento posterior.';

-- Índices ------------------------------------------------------------

-- Listagem padrão do Financeiro: data desc (Financeiro.tsx:130).
CREATE INDEX "ledger_entries_date_idx"     ON "public"."ledger_entries" ("entry_date" DESC) WHERE "deleted_at" IS NULL;
CREATE INDEX "ledger_entries_kind_idx"     ON "public"."ledger_entries" ("kind", "entry_date" DESC) WHERE "deleted_at" IS NULL;
CREATE INDEX "ledger_entries_status_idx"   ON "public"."ledger_entries" ("status_key", "entry_date" DESC) WHERE "deleted_at" IS NULL;
CREATE INDEX "ledger_entries_category_idx" ON "public"."ledger_entries" ("category_id") WHERE "deleted_at" IS NULL;
CREATE INDEX "ledger_entries_order_idx"    ON "public"."ledger_entries" ("order_id") WHERE "deleted_at" IS NULL;
CREATE INDEX "ledger_entries_customer_idx" ON "public"."ledger_entries" ("customer_id") WHERE "deleted_at" IS NULL;
CREATE INDEX "ledger_entries_method_idx"   ON "public"."ledger_entries" ("method_key") WHERE "deleted_at" IS NULL;

-- Pendências abertas de uma comanda: caminho quente da regra 31.
CREATE INDEX "ledger_entries_auto_open_idx"
    ON "public"."ledger_entries" ("order_id", "auto_role")
    WHERE "deleted_at" IS NULL AND "auto_generated";

CREATE INDEX "ledger_entries_search_idx"
    ON "public"."ledger_entries"
    USING gin ("public"."normalize_search"("description") extensions.gin_trgm_ops)
    WHERE "deleted_at" IS NULL;

CREATE TRIGGER "ledger_entries_set_updated_at"
    BEFORE UPDATE ON "public"."ledger_entries"
    FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();


-- ---------------------------------------------------------------------
-- Regra 29 — categoria coerente com o tipo do lançamento
-- (o front troca a lista de categorias ao trocar o tipo, Financeiro.tsx:671;
--  sem esta trigger nada impede uma saída com categoria de entrada)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."validate_ledger_entry"() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
DECLARE
  v_cat_kind text;
BEGIN
  SELECT "kind" INTO v_cat_kind
  FROM public.ledger_categories
  WHERE "id" = NEW."category_id";

  IF v_cat_kind IS DISTINCT FROM NEW."kind" THEN
    RAISE EXCEPTION 'Categoria % é de tipo "%", incompatível com lançamento "%".',
      NEW."category_id", v_cat_kind, NEW."kind"
      USING ERRCODE = '23514';
  END IF;

  NEW."description" := btrim(NEW."description");

  IF TG_OP = 'INSERT' AND NEW."created_by" IS NULL THEN
    NEW."created_by" := auth.uid();
  END IF;

  -- Sem responsável explícito, assume quem está logado.
  IF NEW."staff_id" IS NULL THEN
    NEW."staff_id" := public.current_staff_id();
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "ledger_entries_validate"
    BEFORE INSERT OR UPDATE ON "public"."ledger_entries"
    FOR EACH ROW EXECUTE FUNCTION "public"."validate_ledger_entry"();


-- =====================================================================
-- RLS — módulo `finance`
-- owner: r w | finance: r w | attendant: — | production: — | viewer: —
-- ---------------------------------------------------------------------
-- Atendimento NÃO lê o financeiro: o balcão vê o saldo pela comanda
-- (orders.balance), não pela tabela de lançamentos.
-- =====================================================================
ALTER TABLE "public"."ledger_entries" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ledger_entries_select" ON "public"."ledger_entries"
    FOR SELECT TO "authenticated"
    USING ("deleted_at" IS NULL AND "public"."can_read"('finance'));

CREATE POLICY "ledger_entries_insert" ON "public"."ledger_entries"
    FOR INSERT TO "authenticated"
    WITH CHECK ("public"."can_write"('finance') AND NOT "auto_generated");

CREATE POLICY "ledger_entries_update" ON "public"."ledger_entries"
    FOR UPDATE TO "authenticated"
    USING ("deleted_at" IS NULL AND "public"."can_write"('finance'))
    -- Lançamento automático é gerido pelas RPCs (SECURITY DEFINER), não à mão.
    WITH CHECK ("public"."can_write"('finance') AND NOT "auto_generated");

-- Exclusão do front é soft (UPDATE deleted_at). DELETE físico: só o responsável.
CREATE POLICY "ledger_entries_delete" ON "public"."ledger_entries"
    FOR DELETE TO "authenticated" USING ("public"."is_owner"());
