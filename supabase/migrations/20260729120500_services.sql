-- =====================================================================
-- 20260729120500 — Catálogo de serviços
-- ---------------------------------------------------------------------
-- Espelha Servico (src/types.ts:62). Telas: Serviços, etapa 2 de
-- NovoAtendimento, aba Serviços de Configurações.
--
-- Exclusão: SOFT DELETE. O front NÃO exclui — só arquiva (`active=false`),
-- porque comandas antigas referenciam o serviço (Servicos.tsx:274).
-- `deleted_at` existe para o responsável limpar erros de cadastro.
-- =====================================================================

CREATE TABLE "public"."services" (
    "id"                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "name"              text NOT NULL,
    "category_key"      text NOT NULL
                          REFERENCES "public"."service_categories"("key") ON DELETE RESTRICT,
    "description"       text NOT NULL DEFAULT '',
    "base_price"        numeric(12,2) NOT NULL DEFAULT 0,
    "lead_time_days"    integer NOT NULL DEFAULT 1,
    "default_staff_id"  uuid REFERENCES "public"."staff"("id") ON DELETE SET NULL,
    "active"            boolean NOT NULL DEFAULT true,
    "notes"             text NOT NULL DEFAULT '',

    "created_at"  timestamptz NOT NULL DEFAULT now(),
    "updated_at"  timestamptz NOT NULL DEFAULT now(),
    "deleted_at"  timestamptz,
    "created_by"  uuid REFERENCES "public"."profiles"("id") ON DELETE SET NULL,

    -- Regra 5 (Servicos.tsx:335)
    CONSTRAINT "services_name_min"   CHECK (char_length(btrim("name")) > 2),
    -- Regra 6 (Servicos.tsx:411)
    CONSTRAINT "services_price_min"  CHECK ("base_price" >= 0),
    -- Regra 7 (Servicos.tsx:424) — 0 = "no ato"
    CONSTRAINT "services_lead_min"   CHECK ("lead_time_days" >= 0)
);

COMMENT ON TABLE  "public"."services" IS
  'Catálogo de serviços (Servico, src/types.ts:62). `active=false` = arquivado, sai do atendimento (regra 25).';
COMMENT ON COLUMN "public"."services"."lead_time_days"   IS '0 = executado no ato (Servicos.tsx:208).';
COMMENT ON COLUMN "public"."services"."default_staff_id" IS 'Responsável sugerido ao escolher o serviço (NovoAtendimento.tsx:124).';

-- Índices ------------------------------------------------------------

CREATE UNIQUE INDEX "services_name_unique"
    ON "public"."services" (lower(btrim("name"))) WHERE "deleted_at" IS NULL;

-- Busca (Servicos.tsx:62): nome, descrição, categoria.
CREATE INDEX "services_search_idx"
    ON "public"."services"
    USING gin (
      ("public"."normalize_search"("name") || ' ' || "public"."normalize_search"("description"))
      extensions.gin_trgm_ops
    )
    WHERE "deleted_at" IS NULL;

-- Grade do atendimento: categoria + ativos (NovoAtendimento.tsx:112).
CREATE INDEX "services_category_active_idx"
    ON "public"."services" ("category_key", "name") WHERE "deleted_at" IS NULL AND "active";
CREATE INDEX "services_staff_idx"
    ON "public"."services" ("default_staff_id") WHERE "deleted_at" IS NULL;

CREATE TRIGGER "services_set_updated_at"
    BEFORE UPDATE ON "public"."services"
    FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();

CREATE OR REPLACE FUNCTION "public"."normalize_service"() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  NEW."name" := btrim(NEW."name");
  IF TG_OP = 'INSERT' AND NEW."created_by" IS NULL THEN
    NEW."created_by" := auth.uid();
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "services_normalize"
    BEFORE INSERT OR UPDATE ON "public"."services"
    FOR EACH ROW EXECUTE FUNCTION "public"."normalize_service"();


-- ---------------------------------------------------------------------
-- Regra 26 — duplicar serviço  ← duplicarServico() (useApp.ts:142)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."duplicate_service"("p_service_id" uuid)
    RETURNS "public"."services"
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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
    RAISE EXCEPTION 'Serviço % não encontrado.', p_service_id USING ERRCODE = 'P0002';
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
$$;

COMMENT ON FUNCTION "public"."duplicate_service"(uuid) IS
  'Regra 26: duplica o serviço com sufixo "(cópia)", resolvendo colisão de nome.';

REVOKE ALL ON FUNCTION "public"."duplicate_service"(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."duplicate_service"(uuid) TO "authenticated";


-- =====================================================================
-- RLS — módulo `services`
-- owner: r w | production: r w | attendant: — | finance: — | viewer: —
-- =====================================================================
ALTER TABLE "public"."services" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "services_select" ON "public"."services"
    FOR SELECT TO "authenticated"
    USING (
      "deleted_at" IS NULL
      AND (
        "public"."can_read"('services')
        -- Atendimento não tem o módulo Serviços, mas precisa do catálogo
        -- para abrir a comanda (etapa 2 de NovoAtendimento).
        OR "public"."can_read"('service_desk')
        OR "public"."can_read"('orders')
      )
    );

CREATE POLICY "services_insert" ON "public"."services"
    FOR INSERT TO "authenticated" WITH CHECK ("public"."can_write"('services'));

CREATE POLICY "services_update" ON "public"."services"
    FOR UPDATE TO "authenticated"
    USING ("deleted_at" IS NULL AND "public"."can_write"('services'))
    WITH CHECK ("public"."can_write"('services'));

CREATE POLICY "services_delete" ON "public"."services"
    FOR DELETE TO "authenticated" USING ("public"."is_owner"());
