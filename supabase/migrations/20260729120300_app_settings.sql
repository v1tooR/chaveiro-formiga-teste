-- =====================================================================
-- 20260729120300 — Configurações da loja (singleton)
-- ---------------------------------------------------------------------
-- Espelha o objeto Config (src/types.ts:131), editado em Configurações.
-- Single-tenant: UMA linha, garantida pela PK booleana com CHECK.
-- Ver docs/01-analise-frontend.md §2 para o caminho de migração multi-org.
-- =====================================================================

CREATE TABLE "public"."app_settings" (
    -- Truque do singleton: PK boolean travada em true → no máximo 1 linha.
    "id" boolean PRIMARY KEY DEFAULT true,

    -- config.empresa
    "company_name"     text NOT NULL DEFAULT 'Chaveiro Formiga',
    "company_phone"    text NOT NULL DEFAULT '',
    "company_address"  text NOT NULL DEFAULT '',
    "company_hours"    text NOT NULL DEFAULT '',
    "company_owner"    text NOT NULL DEFAULT '',

    -- config.comandas
    "order_prefix"       text    NOT NULL DEFAULT 'CF',
    "order_next_number"  integer NOT NULL DEFAULT 1,
    "order_show_notes"   boolean NOT NULL DEFAULT true,
    "order_show_photo"   boolean NOT NULL DEFAULT true,
    "order_footer_text"  text    NOT NULL DEFAULT '',

    -- config.etiquetas
    "label_default_size"  text    NOT NULL DEFAULT 'media',
    "labels_per_sheet"    integer NOT NULL DEFAULT 12,
    "label_show_qr"       boolean NOT NULL DEFAULT true,
    "label_show_staff"    boolean NOT NULL DEFAULT true,

    "created_at"  timestamptz NOT NULL DEFAULT now(),
    "updated_at"  timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT "app_settings_singleton"     CHECK ("id"),
    -- Regra 18: prefixo maiúsculo, até 4 caracteres (Configuracoes.tsx:223).
    CONSTRAINT "app_settings_prefix_format" CHECK ("order_prefix" ~ '^[A-Z]{1,4}$'),
    -- Regra 19 (Configuracoes.tsx:239).
    CONSTRAINT "app_settings_next_number"   CHECK ("order_next_number" >= 1),
    -- Regra 20 (Configuracoes.tsx:325).
    CONSTRAINT "app_settings_per_sheet"     CHECK ("labels_per_sheet" BETWEEN 1 AND 60),
    CONSTRAINT "app_settings_label_size"    CHECK ("label_default_size" IN ('pequena', 'media', 'grande')),
    CONSTRAINT "app_settings_company_name"  CHECK (char_length(btrim("company_name")) > 1)
);

COMMENT ON TABLE  "public"."app_settings" IS
  'Configuração única da loja (Config, src/types.ts:131). PK booleana garante linha única.';
COMMENT ON COLUMN "public"."app_settings"."order_next_number" IS
  'Próximo número de comanda. Consumido com SELECT ... FOR UPDATE em create_order (regra 17).';
COMMENT ON COLUMN "public"."app_settings"."label_default_size" IS
  'pequena 40×25mm | media 60×40mm | grande 80×50mm (TAMANHOS, ImprimirEtiqueta.tsx:11).';

CREATE TRIGGER "app_settings_set_updated_at"
    BEFORE UPDATE ON "public"."app_settings"
    FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();

-- Ninguém apaga a configuração da loja.
CREATE OR REPLACE FUNCTION "public"."prevent_app_settings_delete"() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  RAISE EXCEPTION 'app_settings não pode ser excluída — apenas atualizada.';
END;
$$;

CREATE TRIGGER "app_settings_no_delete"
    BEFORE DELETE ON "public"."app_settings"
    FOR EACH ROW EXECUTE FUNCTION "public"."prevent_app_settings_delete"();


-- =====================================================================
-- RLS
-- ---------------------------------------------------------------------
-- Leitura: todo autenticado — prefixo/etiquetas são usados em telas de
-- todos os papéis (Comandas, Etiquetas, Produção).
-- Escrita: só quem tem `w` no módulo settings (owner).
-- =====================================================================
ALTER TABLE "public"."app_settings" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "app_settings_select" ON "public"."app_settings"
    FOR SELECT TO "authenticated" USING (true);

CREATE POLICY "app_settings_update" ON "public"."app_settings"
    FOR UPDATE TO "authenticated"
    USING ("public"."can_write"('settings'))
    WITH CHECK ("public"."can_write"('settings'));

CREATE POLICY "app_settings_insert" ON "public"."app_settings"
    FOR INSERT TO "authenticated"
    WITH CHECK ("public"."can_write"('settings'));
