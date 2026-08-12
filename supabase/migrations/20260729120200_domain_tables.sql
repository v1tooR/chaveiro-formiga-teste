-- =====================================================================
-- 20260729120200 — Tabelas de domínio
-- ---------------------------------------------------------------------
-- Substituem os mapas constantes do front (src/lib/constants.ts). As
-- cores vêm junto porque o front as usa para badge/kanban/gráfico — não
-- faz sentido duplicar a paleta em dois lugares.
--
-- Todas seguem o mesmo contrato: key text PK, label, sort_order, cores.
-- Leitura para todo autenticado; escrita apenas para o responsável.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Categorias de serviço  ← CATEGORIAS (constants.ts:10)
-- ---------------------------------------------------------------------
CREATE TABLE "public"."service_categories" (
    "key"         text PRIMARY KEY,
    "label"       text NOT NULL,
    "icon"        text NOT NULL DEFAULT 'Package',
    "color"       text NOT NULL,
    "bg_color"    text NOT NULL,
    "sort_order"  integer NOT NULL DEFAULT 0,
    "active"      boolean NOT NULL DEFAULT true,
    "created_at"  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "service_categories_key_format" CHECK ("key" ~ '^[a-z_]{3,24}$'),
    CONSTRAINT "service_categories_color_hex"  CHECK ("color"    ~* '^#[0-9a-f]{6}$'),
    CONSTRAINT "service_categories_bg_hex"     CHECK ("bg_color" ~* '^#[0-9a-f]{6}$')
);

COMMENT ON TABLE "public"."service_categories" IS 'Espelha CATEGORIAS (src/lib/constants.ts:10). icon = nome do ícone lucide-react.';


-- ---------------------------------------------------------------------
-- Status de comanda  ← STATUS + KANBAN_COLS + STATUS_ABERTOS (constants.ts:29)
-- ---------------------------------------------------------------------
CREATE TABLE "public"."order_statuses" (
    "key"           text PRIMARY KEY,
    "label"         text NOT NULL,
    "description"   text NOT NULL DEFAULT '',
    "color"         text NOT NULL,
    "bg_color"      text NOT NULL,
    "border_color"  text NOT NULL,
    "in_kanban"     boolean NOT NULL DEFAULT true,
    "is_open"       boolean NOT NULL DEFAULT true,
    "is_final"      boolean NOT NULL DEFAULT false,
    "sort_order"    integer NOT NULL DEFAULT 0,
    "created_at"    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "order_statuses_key_format"  CHECK ("key" ~ '^[a-z_]{3,24}$'),
    CONSTRAINT "order_statuses_color_hex"   CHECK ("color"        ~* '^#[0-9a-f]{6}$'),
    CONSTRAINT "order_statuses_bg_hex"      CHECK ("bg_color"     ~* '^#[0-9a-f]{6}$'),
    CONSTRAINT "order_statuses_border_hex"  CHECK ("border_color" ~* '^#[0-9a-f]{6}$'),
    -- Status final nunca é "aberto" nem aparece como coluna de trabalho.
    CONSTRAINT "order_statuses_final_not_open" CHECK (NOT "is_final" OR NOT "is_open")
);

COMMENT ON TABLE  "public"."order_statuses" IS 'Espelha STATUS (constants.ts:29). sort_order = ordem das colunas do Kanban.';
COMMENT ON COLUMN "public"."order_statuses"."in_kanban" IS 'false para pausada/cancelada (KANBAN_COLS, constants.ts:43).';
COMMENT ON COLUMN "public"."order_statuses"."is_open"   IS 'true = ocupa a operação (STATUS_ABERTOS, constants.ts:57).';
COMMENT ON COLUMN "public"."order_statuses"."is_final"  IS 'true = entregue/cancelada. Trava mudanças de status (regra 23).';
COMMENT ON COLUMN "public"."order_statuses"."description" IS 'Texto do evento de histórico (statusTexto(), useApp.ts:404).';


-- ---------------------------------------------------------------------
-- Status de cliente  ← CLIENTE_STATUS (constants.ts:68)
-- ---------------------------------------------------------------------
CREATE TABLE "public"."customer_statuses" (
    "key"         text PRIMARY KEY,
    "label"       text NOT NULL,
    "color"       text NOT NULL,
    "bg_color"    text NOT NULL,
    "is_derived"  boolean NOT NULL DEFAULT true,
    "sort_order"  integer NOT NULL DEFAULT 0,
    "created_at"  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "customer_statuses_key_format" CHECK ("key" ~ '^[a-z_]{3,24}$'),
    CONSTRAINT "customer_statuses_color_hex"  CHECK ("color"    ~* '^#[0-9a-f]{6}$'),
    CONSTRAINT "customer_statuses_bg_hex"     CHECK ("bg_color" ~* '^#[0-9a-f]{6}$')
);

COMMENT ON COLUMN "public"."customer_statuses"."is_derived" IS
  'true = recalculado pelo histórico de comandas. `bloqueado` é false (manual) e nunca sobrescrito.';


-- ---------------------------------------------------------------------
-- Formas de pagamento  ← FORMAS (constants.ts:87)
-- ---------------------------------------------------------------------
CREATE TABLE "public"."payment_methods" (
    "key"         text PRIMARY KEY,
    "label"       text NOT NULL,
    "icon"        text NOT NULL DEFAULT 'Wallet',
    "color"       text NOT NULL DEFAULT '#6B7280',
    "active"      boolean NOT NULL DEFAULT true,
    "sort_order"  integer NOT NULL DEFAULT 0,
    "created_at"  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "payment_methods_key_format" CHECK ("key" ~ '^[a-z_]{3,24}$'),
    CONSTRAINT "payment_methods_color_hex"  CHECK ("color" ~* '^#[0-9a-f]{6}$')
);

COMMENT ON COLUMN "public"."payment_methods"."color" IS
  'Cor do gráfico de formas de pagamento (CORES_FORMA, Financeiro.tsx:52).';


-- ---------------------------------------------------------------------
-- Status de lançamento  ← LANCAMENTO_STATUS (constants.ts:77)
-- ---------------------------------------------------------------------
CREATE TABLE "public"."ledger_statuses" (
    "key"                 text PRIMARY KEY,
    "label"               text NOT NULL,
    "color"               text NOT NULL,
    "bg_color"            text NOT NULL,
    -- Classificação usada em TODOS os cálculos de metricas.ts.
    "counts_as_received"  boolean NOT NULL DEFAULT false,
    "counts_as_open"      boolean NOT NULL DEFAULT false,
    "is_final"            boolean NOT NULL DEFAULT false,
    "sort_order"          integer NOT NULL DEFAULT 0,
    "created_at"          timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "ledger_statuses_key_format" CHECK ("key" ~ '^[a-z_]{3,24}$'),
    CONSTRAINT "ledger_statuses_color_hex"  CHECK ("color"    ~* '^#[0-9a-f]{6}$'),
    CONSTRAINT "ledger_statuses_bg_hex"     CHECK ("bg_color" ~* '^#[0-9a-f]{6}$'),
    CONSTRAINT "ledger_statuses_exclusive"  CHECK (NOT ("counts_as_received" AND "counts_as_open"))
);

COMMENT ON COLUMN "public"."ledger_statuses"."counts_as_received" IS
  'recebido/pago — entram em recebidoHoje/recebidoMes (metricas.ts:41).';
COMMENT ON COLUMN "public"."ledger_statuses"."counts_as_open" IS
  'pendente/parcial/vencido — entram em totalPendente (metricas.ts:138).';


-- ---------------------------------------------------------------------
-- Categorias de lançamento  ← CAT_ENTRADA / CAT_SAIDA (constants.ts:147)
-- ---------------------------------------------------------------------
CREATE TABLE "public"."ledger_categories" (
    "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "name"        text NOT NULL,
    "kind"        text NOT NULL,
    -- Categoria automática de comanda por categoria de serviço (CAT_ENTRADA_DE, seed.ts:396).
    "auto_for_service_category" text REFERENCES "public"."service_categories"("key") ON DELETE SET NULL,
    "is_system"   boolean NOT NULL DEFAULT false,
    "active"      boolean NOT NULL DEFAULT true,
    "sort_order"  integer NOT NULL DEFAULT 0,
    "created_at"  timestamptz NOT NULL DEFAULT now(),
    "updated_at"  timestamptz NOT NULL DEFAULT now(),
    "deleted_at"  timestamptz,
    CONSTRAINT "ledger_categories_kind_valid" CHECK ("kind" IN ('income', 'expense')),
    CONSTRAINT "ledger_categories_name_min"   CHECK (char_length(btrim("name")) > 2)
);

COMMENT ON TABLE  "public"."ledger_categories" IS 'Espelha CAT_ENTRADA/CAT_SAIDA (constants.ts:147).';
COMMENT ON COLUMN "public"."ledger_categories"."is_system" IS
  'Usada por automação (Entrada de comanda, Saldo final). Não pode ser excluída.';
COMMENT ON COLUMN "public"."ledger_categories"."auto_for_service_category" IS
  'Categoria de receita escolhida ao gerar o saldo a receber da comanda (resolve a ambiguidade A4).';

CREATE UNIQUE INDEX "ledger_categories_name_unique"
    ON "public"."ledger_categories" (lower(btrim("name"))) WHERE "deleted_at" IS NULL;
CREATE INDEX "ledger_categories_kind_idx"
    ON "public"."ledger_categories" ("kind", "sort_order") WHERE "deleted_at" IS NULL AND "active";

CREATE TRIGGER "ledger_categories_set_updated_at"
    BEFORE UPDATE ON "public"."ledger_categories"
    FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();


-- ---------------------------------------------------------------------
-- Tipos de foto  ← TIPOS/LEGENDA_PADRAO (Fotos.tsx:8)
-- ---------------------------------------------------------------------
CREATE TABLE "public"."photo_kinds" (
    "key"              text PRIMARY KEY,
    "label"            text NOT NULL,
    "default_caption"  text NOT NULL,
    "sort_order"       integer NOT NULL DEFAULT 0,
    "created_at"       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "photo_kinds_key_format" CHECK ("key" ~ '^[a-z_]{3,24}$')
);


-- =====================================================================
-- RLS — tabelas de domínio: leitura livre para autenticado, escrita owner
-- =====================================================================
ALTER TABLE "public"."service_categories" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."order_statuses"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."customer_statuses"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."payment_methods"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."ledger_statuses"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."ledger_categories"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."photo_kinds"        ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'service_categories', 'order_statuses', 'customer_statuses',
    'payment_methods', 'ledger_statuses', 'photo_kinds'
  ] LOOP
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (true)',
      t || '_select', t
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.is_owner()) WITH CHECK (public.is_owner())',
      t || '_write', t
    );
  END LOOP;
END
$$;

-- ledger_categories tem soft delete: o SELECT filtra deleted_at.
CREATE POLICY "ledger_categories_select" ON "public"."ledger_categories"
    FOR SELECT TO "authenticated" USING ("deleted_at" IS NULL);
CREATE POLICY "ledger_categories_write" ON "public"."ledger_categories"
    FOR ALL TO "authenticated" USING ("public"."is_owner"()) WITH CHECK ("public"."is_owner"());
