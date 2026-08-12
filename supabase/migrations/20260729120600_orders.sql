-- =====================================================================
-- 20260729120600 — Comandas (ordem de serviço)
-- ---------------------------------------------------------------------
-- Entidade central do sistema. Espelha Comanda (src/types.ts:91).
-- Telas: Comandas, ComandaDetalhe, Produção (kanban), Etiquetas,
-- Atendimento, Dashboard.
--
-- Exclusão: SOFT DELETE. O front nunca exclui comanda — cancela
-- (`status_key = 'cancelada'`). `deleted_at` só para o responsável.
-- =====================================================================

CREATE TABLE "public"."orders" (
    "id"      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Regra 17: sequencial vindo de app_settings.order_next_number.
    -- Atribuído pela RPC create_order, nunca pelo cliente.
    "number"  integer NOT NULL,

    "customer_id"   uuid NOT NULL REFERENCES "public"."customers"("id") ON DELETE RESTRICT,
    "category_key"  text NOT NULL REFERENCES "public"."service_categories"("key") ON DELETE RESTRICT,
    -- Serviço pode ser arquivado/removido do catálogo; a comanda sobrevive.
    "service_id"    uuid REFERENCES "public"."services"("id") ON DELETE SET NULL,
    -- Snapshot do nome no momento da venda: renomear o serviço no catálogo
    -- não pode reescrever o histórico (o front usa servicoNome em tudo).
    "service_name"  text NOT NULL,

    "description"  text NOT NULL DEFAULT '',
    "quantity"     integer NOT NULL DEFAULT 1,
    "notes"        text NOT NULL DEFAULT '',

    "due_date"          timestamptz NOT NULL,
    "assigned_staff_id" uuid REFERENCES "public"."staff"("id") ON DELETE SET NULL,
    "status_key"        text NOT NULL DEFAULT 'recebida'
                          REFERENCES "public"."order_statuses"("key") ON DELETE RESTRICT,

    -- Financeiro ------------------------------------------------------
    "total_amount"   numeric(12,2) NOT NULL,
    "down_payment"   numeric(12,2) NOT NULL DEFAULT 0,
    "down_payment_method_key" text REFERENCES "public"."payment_methods"("key") ON DELETE RESTRICT,

    -- Regra 13: mantida por trigger a partir de down_payment + order_payments.
    "amount_paid"  numeric(12,2) NOT NULL DEFAULT 0,
    -- Regra 14: GENERATED — impossível ficar dessincronizado.
    "balance"      numeric(12,2) GENERATED ALWAYS AS
                     (greatest(0::numeric, "total_amount" - "amount_paid")) STORED,
    -- Regra 15: tolerância de 0,009 igual a estaQuitada() (utils.ts:95).
    "is_settled"   boolean GENERATED ALWAYS AS
                     (("total_amount" - "amount_paid") <= 0.009) STORED,

    -- Impressão -------------------------------------------------------
    "label_printed"  boolean NOT NULL DEFAULT false,
    "order_printed"  boolean NOT NULL DEFAULT false,

    "delivered_at"  timestamptz,
    "created_at"    timestamptz NOT NULL DEFAULT now(),
    "updated_at"    timestamptz NOT NULL DEFAULT now(),
    "deleted_at"    timestamptz,
    "created_by"    uuid REFERENCES "public"."profiles"("id") ON DELETE SET NULL,

    -- Regra 8  (NovoAtendimento.tsx:470)
    CONSTRAINT "orders_quantity_min"      CHECK ("quantity" >= 1),
    -- Regra 9  (NovoAtendimento.tsx:154)
    CONSTRAINT "orders_total_positive"    CHECK ("total_amount" > 0),
    -- Regra 11
    CONSTRAINT "orders_down_min"          CHECK ("down_payment" >= 0),
    -- Regra 10 (NovoAtendimento.tsx:678)
    CONSTRAINT "orders_down_lte_total"    CHECK ("down_payment" <= "total_amount"),
    -- Regra 12 (NovoAtendimento.tsx:195): forma exigida ⇔ entrada > 0
    CONSTRAINT "orders_down_method_iff"   CHECK (("down_payment" > 0) = ("down_payment_method_key" IS NOT NULL)),
    CONSTRAINT "orders_paid_min"          CHECK ("amount_paid" >= 0),
    CONSTRAINT "orders_service_name_min"  CHECK (char_length(btrim("service_name")) > 0),
    CONSTRAINT "orders_number_positive"   CHECK ("number" >= 1)
);

COMMENT ON TABLE  "public"."orders" IS
  'Comandas / ordens de serviço (Comanda, src/types.ts:91). Soft delete; o cancelamento é status_key=cancelada.';
COMMENT ON COLUMN "public"."orders"."number"       IS 'Sequencial atômico (regra 17). Exibido como PREFIXO-0000 (comandaCod, utils.ts:111).';
COMMENT ON COLUMN "public"."orders"."service_name" IS 'Snapshot do nome do serviço na venda. Renomear o catálogo não altera o histórico.';
COMMENT ON COLUMN "public"."orders"."amount_paid"  IS 'entrada + Σ order_payments. Mantido por trigger (regra 13).';
COMMENT ON COLUMN "public"."orders"."balance"      IS 'GENERATED: max(0, total − pago) (regra 14).';
COMMENT ON COLUMN "public"."orders"."is_settled"   IS 'GENERATED: saldo ≤ 0,009 (regra 15).';

-- Índices ------------------------------------------------------------

CREATE UNIQUE INDEX "orders_number_unique" ON "public"."orders" ("number");

-- Listagem padrão: ordenada por número desc (Comandas.tsx:112).
CREATE INDEX "orders_number_desc_idx" ON "public"."orders" ("number" DESC) WHERE "deleted_at" IS NULL;

-- Kanban de produção: status + prazo (Producao.tsx:70).
CREATE INDEX "orders_status_due_idx"   ON "public"."orders" ("status_key", "due_date") WHERE "deleted_at" IS NULL;

-- Filtros da listagem de comandas (Comandas.tsx:88).
CREATE INDEX "orders_customer_idx"     ON "public"."orders" ("customer_id", "created_at" DESC) WHERE "deleted_at" IS NULL;
CREATE INDEX "orders_category_idx"     ON "public"."orders" ("category_key") WHERE "deleted_at" IS NULL;
CREATE INDEX "orders_staff_idx"        ON "public"."orders" ("assigned_staff_id") WHERE "deleted_at" IS NULL;
CREATE INDEX "orders_service_idx"      ON "public"."orders" ("service_id") WHERE "deleted_at" IS NULL;
CREATE INDEX "orders_created_at_idx"   ON "public"."orders" ("created_at" DESC) WHERE "deleted_at" IS NULL;

-- Comandas com saldo (filtro "Com saldo" + tela de Financeiro).
CREATE INDEX "orders_open_balance_idx" ON "public"."orders" ("due_date") WHERE "deleted_at" IS NULL AND NOT "is_settled";

-- Fila de etiquetas: não finalizadas e sem etiqueta (Etiquetas.tsx:36).
CREATE INDEX "orders_label_pending_idx"
    ON "public"."orders" ("number" DESC) WHERE "deleted_at" IS NULL AND NOT "label_printed";

-- Busca por número/serviço (Comandas.tsx:103).
CREATE INDEX "orders_search_idx"
    ON "public"."orders"
    USING gin (("public"."normalize_search"("service_name") || ' ' || "number"::text) extensions.gin_trgm_ops)
    WHERE "deleted_at" IS NULL;

CREATE TRIGGER "orders_set_updated_at"
    BEFORE UPDATE ON "public"."orders"
    FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();


-- =====================================================================
-- RLS — módulo `orders`
-- owner: r w | attendant: r w | production: r w | finance: r | viewer: r
-- ---------------------------------------------------------------------
-- Ambiguidade A3: financeiro vê comandas (para cobrar) mas não altera o
-- serviço. Ele escreve em order_payments, não em orders.
-- =====================================================================
ALTER TABLE "public"."orders" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "orders_select" ON "public"."orders"
    FOR SELECT TO "authenticated"
    USING (
      "deleted_at" IS NULL
      AND ("public"."can_read"('orders') OR "public"."can_read"('production'))
    );

CREATE POLICY "orders_insert" ON "public"."orders"
    FOR INSERT TO "authenticated"
    WITH CHECK ("public"."can_write"('orders') OR "public"."can_write"('service_desk'));

CREATE POLICY "orders_update" ON "public"."orders"
    FOR UPDATE TO "authenticated"
    USING (
      "deleted_at" IS NULL
      AND ("public"."can_write"('orders') OR "public"."can_write"('production'))
    )
    WITH CHECK ("public"."can_write"('orders') OR "public"."can_write"('production'));

CREATE POLICY "orders_delete" ON "public"."orders"
    FOR DELETE TO "authenticated" USING ("public"."is_owner"());
