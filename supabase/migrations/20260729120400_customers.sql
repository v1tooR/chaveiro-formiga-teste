-- =====================================================================
-- 20260729120400 — Clientes
-- ---------------------------------------------------------------------
-- Espelha Cliente (src/types.ts:50). Telas: Clientes, ClienteDetalhe,
-- etapa 1 de NovoAtendimento.
-- Exclusão: SOFT DELETE — o cliente carrega histórico financeiro.
-- =====================================================================

CREATE TABLE "public"."customers" (
    "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "name"        text NOT NULL,
    "phone"       text NOT NULL,
    "whatsapp"    text NOT NULL DEFAULT '',
    "email"       text NOT NULL DEFAULT '',
    "city"        text NOT NULL DEFAULT 'Formiga',
    "status_key"  text NOT NULL DEFAULT 'novo'
                    REFERENCES "public"."customer_statuses"("key") ON DELETE RESTRICT,
    "notes"       text NOT NULL DEFAULT '',

    "created_at"  timestamptz NOT NULL DEFAULT now(),
    "updated_at"  timestamptz NOT NULL DEFAULT now(),
    "deleted_at"  timestamptz,
    "created_by"  uuid REFERENCES "public"."profiles"("id") ON DELETE SET NULL,

    -- Regra 1 (Clientes.tsx:347, NovoAtendimento.tsx:144)
    CONSTRAINT "customers_name_min"     CHECK (char_length(btrim("name")) > 2),
    -- Regra 2: telefone é normalizado para dígitos e precisa de 8 a 15
    CONSTRAINT "customers_phone_digits" CHECK ("phone" ~ '^[0-9]{8,15}$'),
    CONSTRAINT "customers_whatsapp_digits" CHECK ("whatsapp" = '' OR "whatsapp" ~ '^[0-9]{8,15}$'),
    -- E-mail é opcional no front; quando vem, precisa parecer e-mail.
    CONSTRAINT "customers_email_format" CHECK ("email" = '' OR "email" ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')
);

COMMENT ON TABLE  "public"."customers" IS 'Clientes da loja (Cliente, src/types.ts:50). Soft delete: preserva histórico.';
COMMENT ON COLUMN "public"."customers"."phone"      IS 'Somente dígitos. Formatação é do front (telefoneFmt, utils.ts:104).';
COMMENT ON COLUMN "public"."customers"."status_key" IS 'Derivado do histórico por trigger, exceto `bloqueado` (manual, regra 27).';

-- Índices ------------------------------------------------------------

-- Telefone é o identificador real no balcão: duplicar cliente é o erro
-- mais comum de operação, então é único entre os ativos.
CREATE UNIQUE INDEX "customers_phone_unique"
    ON "public"."customers" ("phone") WHERE "deleted_at" IS NULL;

-- Busca por nome/e-mail/cidade (Clientes.tsx:51, NovoAtendimento.tsx:134).
CREATE INDEX "customers_search_idx"
    ON "public"."customers"
    USING gin (
      (
        "public"."normalize_search"("name") || ' ' ||
        "public"."normalize_search"("email") || ' ' ||
        "public"."normalize_search"("city") || ' ' ||
        "phone"
      ) extensions.gin_trgm_ops
    )
    WHERE "deleted_at" IS NULL;

-- Ordenações do front (Clientes.tsx:54): recentes, nome.
CREATE INDEX "customers_created_at_idx" ON "public"."customers" ("created_at" DESC) WHERE "deleted_at" IS NULL;
CREATE INDEX "customers_name_idx"       ON "public"."customers" ("public"."normalize_search"("name")) WHERE "deleted_at" IS NULL;
CREATE INDEX "customers_status_idx"     ON "public"."customers" ("status_key") WHERE "deleted_at" IS NULL;

-- Triggers -----------------------------------------------------------

CREATE TRIGGER "customers_set_updated_at"
    BEFORE UPDATE ON "public"."customers"
    FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();

-- Regras 2, 3 e 4: normaliza telefone, herda whatsapp, default de cidade,
-- e preenche created_by. Espelha criarCliente() (useApp.ts:112).
CREATE OR REPLACE FUNCTION "public"."normalize_customer"() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  NEW."name"     := btrim(NEW."name");
  NEW."phone"    := public.digits_only(NEW."phone");
  NEW."whatsapp" := public.digits_only(NEW."whatsapp");
  NEW."email"    := lower(btrim(coalesce(NEW."email", '')));
  NEW."city"     := btrim(coalesce(NULLIF(btrim(NEW."city"), ''), 'Formiga'));

  -- Regra 3: whatsapp vazio herda o telefone (useApp.ts:119).
  IF NEW."whatsapp" = '' THEN
    NEW."whatsapp" := NEW."phone";
  END IF;

  IF TG_OP = 'INSERT' AND NEW."created_by" IS NULL THEN
    NEW."created_by" := auth.uid();
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "customers_normalize"
    BEFORE INSERT OR UPDATE ON "public"."customers"
    FOR EACH ROW EXECUTE FUNCTION "public"."normalize_customer"();


-- =====================================================================
-- RLS — módulo `customers`
-- owner: r w | attendant: r w | finance: r w | production: — | viewer: —
-- =====================================================================
ALTER TABLE "public"."customers" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "customers_select" ON "public"."customers"
    FOR SELECT TO "authenticated"
    USING (
      "deleted_at" IS NULL
      AND (
        "public"."can_read"('customers')
        -- Produção e consulta não têm o módulo Clientes, mas as telas de
        -- Comandas/Produção mostram o NOME do cliente no card. A leitura é
        -- liberada para quem lê comandas; a tela é que esconde a ficha
        -- completa (podeVerCliente, ComandaDetalhe.tsx:58).
        OR "public"."can_read"('orders')
        OR "public"."can_read"('production')
      )
    );

CREATE POLICY "customers_insert" ON "public"."customers"
    FOR INSERT TO "authenticated"
    WITH CHECK (
      -- O balcão cadastra cliente dentro do fluxo de atendimento
      -- (modoNovoCli, NovoAtendimento.tsx:163).
      "public"."can_write"('customers') OR "public"."can_write"('service_desk')
    );

CREATE POLICY "customers_update" ON "public"."customers"
    FOR UPDATE TO "authenticated"
    USING ("deleted_at" IS NULL AND "public"."can_write"('customers'))
    WITH CHECK ("public"."can_write"('customers'));

-- Soft delete é UPDATE. DELETE físico fica só para o responsável (LGPD).
CREATE POLICY "customers_delete" ON "public"."customers"
    FOR DELETE TO "authenticated"
    USING ("public"."is_owner"());
