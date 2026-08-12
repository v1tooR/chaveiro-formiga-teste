-- =====================================================================
-- 20260729120700 — Filhos da comanda: fotos, pagamentos, eventos
-- ---------------------------------------------------------------------
-- Espelham os arrays embutidos em Comanda (src/types.ts:108-110):
--   fotos      → order_photos
--   pagamentos → order_payments
--   historico  → order_events
-- =====================================================================

-- ---------------------------------------------------------------------
-- Fotos  ← Foto (src/types.ts:40)
-- Exclusão: HARD DELETE — o front remove a foto de vez (Fotos.tsx:105).
-- ---------------------------------------------------------------------
CREATE TABLE "public"."order_photos" (
    "id"        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "order_id"  uuid NOT NULL REFERENCES "public"."orders"("id") ON DELETE CASCADE,
    "kind"      text NOT NULL DEFAULT 'antes'
                  REFERENCES "public"."photo_kinds"("key") ON DELETE RESTRICT,
    "caption"   text NOT NULL DEFAULT '',

    -- Arquivo real no bucket privado `order-photos`.
    "storage_path"  text,
    -- Ambiguidade A6: gradiente determinístico do front. Mantido como
    -- fallback visual para o seed de demonstração, que não tem binários.
    "gradient_seed" text NOT NULL DEFAULT '',

    "created_at"  timestamptz NOT NULL DEFAULT now(),
    "created_by"  uuid REFERENCES "public"."profiles"("id") ON DELETE SET NULL,

    -- Ou tem arquivo, ou tem gradiente. Foto sem nenhum dos dois não renderiza.
    CONSTRAINT "order_photos_has_source" CHECK (
      "storage_path" IS NOT NULL OR btrim("gradient_seed") <> ''
    ),
    CONSTRAINT "order_photos_path_scoped" CHECK (
      "storage_path" IS NULL OR "storage_path" LIKE ("order_id"::text || '/%')
    )
);

COMMENT ON TABLE  "public"."order_photos" IS
  'Fotos do item (Foto, src/types.ts:40). Hard delete: o front remove definitivamente.';
COMMENT ON COLUMN "public"."order_photos"."storage_path" IS
  'Caminho no bucket order-photos, sempre prefixado por <order_id>/ (a policy de Storage depende disso).';
COMMENT ON COLUMN "public"."order_photos"."gradient_seed" IS
  'Fallback de render sem binário (FotoBox, dominio.tsx:132). Usado pelo seed de demo.';

CREATE INDEX "order_photos_order_idx" ON "public"."order_photos" ("order_id", "created_at");
CREATE UNIQUE INDEX "order_photos_path_unique" ON "public"."order_photos" ("storage_path") WHERE "storage_path" IS NOT NULL;


-- ---------------------------------------------------------------------
-- Pagamentos  ← Pagamento (src/types.ts:82)
-- Exclusão: NENHUMA. O front não oferece excluir pagamento; estorno
-- seria um lançamento novo, não a remoção do histórico.
-- ---------------------------------------------------------------------
CREATE TABLE "public"."order_payments" (
    "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "order_id"    uuid NOT NULL REFERENCES "public"."orders"("id") ON DELETE CASCADE,
    "amount"      numeric(12,2) NOT NULL,
    "method_key"  text NOT NULL REFERENCES "public"."payment_methods"("key") ON DELETE RESTRICT,
    "received_by_staff_id" uuid REFERENCES "public"."staff"("id") ON DELETE SET NULL,
    "note"        text NOT NULL DEFAULT '',
    "paid_at"     timestamptz NOT NULL DEFAULT now(),
    "created_at"  timestamptz NOT NULL DEFAULT now(),
    "created_by"  uuid REFERENCES "public"."profiles"("id") ON DELETE SET NULL,

    -- Regra 16: pagamento de valor zero/negativo não existe.
    CONSTRAINT "order_payments_amount_positive" CHECK ("amount" > 0)
);

COMMENT ON TABLE "public"."order_payments" IS
  'Pagamentos posteriores à entrada (Pagamento, src/types.ts:82). Append-only: sem UPDATE nem DELETE.';

CREATE INDEX "order_payments_order_idx"  ON "public"."order_payments" ("order_id", "paid_at");
CREATE INDEX "order_payments_paid_idx"   ON "public"."order_payments" ("paid_at" DESC);
CREATE INDEX "order_payments_method_idx" ON "public"."order_payments" ("method_key");


-- ---------------------------------------------------------------------
-- Histórico  ← HistoricoEvento (src/types.ts:74)
-- Append-only puro: sem UPDATE, sem DELETE, sem soft delete.
-- ---------------------------------------------------------------------
CREATE TABLE "public"."order_events" (
    "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "order_id"    uuid NOT NULL REFERENCES "public"."orders"("id") ON DELETE CASCADE,
    "title"       text NOT NULL,
    "detail"      text,
    -- Nome congelado no momento do evento: se o funcionário sair, o
    -- histórico continua legível (o front exibe h.autor direto).
    "actor_name"  text NOT NULL DEFAULT 'Sistema',
    "actor_id"    uuid REFERENCES "public"."profiles"("id") ON DELETE SET NULL,
    "created_at"  timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT "order_events_title_min" CHECK (char_length(btrim("title")) > 0)
);

COMMENT ON TABLE  "public"."order_events" IS
  'Timeline da comanda (HistoricoEvento, src/types.ts:74). Append-only — nunca editada nem excluída.';
COMMENT ON COLUMN "public"."order_events"."actor_name" IS
  'Nome do autor congelado. Substitui os autores hardcoded do front (ambiguidade A5).';

CREATE INDEX "order_events_order_idx" ON "public"."order_events" ("order_id", "created_at" DESC);


-- ---------------------------------------------------------------------
-- Helper compartilhado: registra evento na comanda
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."log_order_event"(
    "p_order_id" uuid,
    "p_title"    text,
    "p_detail"   text DEFAULT NULL
) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.order_events ("order_id", "title", "detail", "actor_name", "actor_id")
  VALUES (p_order_id, p_title, p_detail, public.current_actor_name(), auth.uid())
  RETURNING "id" INTO v_id;
  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION "public"."log_order_event"(uuid, text, text) IS
  'Registra evento na timeline com o autor autenticado. Usada pelas RPCs e triggers.';

REVOKE ALL ON FUNCTION "public"."log_order_event"(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."log_order_event"(uuid, text, text) TO "authenticated";


-- ---------------------------------------------------------------------
-- Bloqueio de mutação em tabelas append-only
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."prevent_mutation"() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  RAISE EXCEPTION '% em %.% não é permitido: tabela append-only.',
    TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME
    USING ERRCODE = '42501';
END;
$$;

CREATE TRIGGER "order_events_no_update"
    BEFORE UPDATE ON "public"."order_events"
    FOR EACH ROW EXECUTE FUNCTION "public"."prevent_mutation"();

CREATE TRIGGER "order_payments_no_update"
    BEFORE UPDATE ON "public"."order_payments"
    FOR EACH ROW EXECUTE FUNCTION "public"."prevent_mutation"();


-- =====================================================================
-- RLS
-- =====================================================================
ALTER TABLE "public"."order_photos"   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."order_payments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."order_events"   ENABLE ROW LEVEL SECURITY;

-- Fotos: quem lê comanda vê; quem trabalha na comanda anexa/remove.
CREATE POLICY "order_photos_select" ON "public"."order_photos"
    FOR SELECT TO "authenticated"
    USING (
      "public"."can_read"('orders') OR "public"."can_read"('production')
    );

CREATE POLICY "order_photos_insert" ON "public"."order_photos"
    FOR INSERT TO "authenticated"
    WITH CHECK (
      (
        "public"."can_write"('orders')
        OR "public"."can_write"('production')
        OR "public"."can_write"('service_desk')
      )
      -- Não anexa foto em comanda finalizada/excluída.
      AND EXISTS (
        SELECT 1 FROM "public"."orders" o
        JOIN "public"."order_statuses" st ON st."key" = o."status_key"
        WHERE o."id" = "order_id" AND o."deleted_at" IS NULL AND NOT st."is_final"
      )
    );

CREATE POLICY "order_photos_update" ON "public"."order_photos"
    FOR UPDATE TO "authenticated"
    USING ("public"."can_write"('orders') OR "public"."can_write"('production'))
    WITH CHECK ("public"."can_write"('orders') OR "public"."can_write"('production'));

CREATE POLICY "order_photos_delete" ON "public"."order_photos"
    FOR DELETE TO "authenticated"
    USING ("public"."can_write"('orders') OR "public"."can_write"('production'));

-- Pagamentos: financeiro e balcão registram; quem lê comanda/financeiro vê.
CREATE POLICY "order_payments_select" ON "public"."order_payments"
    FOR SELECT TO "authenticated"
    USING (
      "public"."can_read"('orders')
      OR "public"."can_read"('finance')
      OR "public"."can_read"('customers')
    );

CREATE POLICY "order_payments_insert" ON "public"."order_payments"
    FOR INSERT TO "authenticated"
    WITH CHECK (
      "public"."can_write"('finance')
      OR "public"."can_write"('service_desk')
      OR "public"."can_write"('orders')
    );

-- Sem UPDATE nem DELETE: histórico financeiro é imutável.

-- Eventos: quem lê comanda vê; quem escreve na operação registra.
CREATE POLICY "order_events_select" ON "public"."order_events"
    FOR SELECT TO "authenticated"
    USING ("public"."can_read"('orders') OR "public"."can_read"('production'));

CREATE POLICY "order_events_insert" ON "public"."order_events"
    FOR INSERT TO "authenticated"
    WITH CHECK (
      "public"."can_write"('orders')
      OR "public"."can_write"('production')
      OR "public"."can_write"('service_desk')
      OR "public"."can_write"('finance')
    );
