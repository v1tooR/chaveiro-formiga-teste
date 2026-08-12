-- =====================================================================
-- 20260729120100 — Papéis, perfis e matriz de permissões
-- ---------------------------------------------------------------------
-- Origem no front:
--   PERFIS            → src/lib/constants.ts:98
--   Protegida/modulos → src/App.tsx:22, src/components/Layout.tsx:65
--
-- A matriz módulo × papel vira DADO (`role_modules`), não código. RLS e
-- front leem da mesma fonte, então não há como divergirem.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Papéis
-- ---------------------------------------------------------------------
CREATE TABLE "public"."roles" (
    "key"          text PRIMARY KEY,
    "label"        text NOT NULL,
    "description"  text NOT NULL DEFAULT '',
    "sort_order"   integer NOT NULL DEFAULT 0,
    "is_readonly"  boolean NOT NULL DEFAULT false,
    "created_at"   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "roles_key_format" CHECK ("key" ~ '^[a-z_]{3,32}$')
);

COMMENT ON TABLE "public"."roles" IS 'Papéis do sistema. Espelha PERFIS do front (src/lib/constants.ts:98).';
COMMENT ON COLUMN "public"."roles"."is_readonly" IS 'true = papel de consulta; nenhuma escrita, independente de role_modules.';


-- ---------------------------------------------------------------------
-- Módulos (as 10 telas protegidas)
-- ---------------------------------------------------------------------
CREATE TABLE "public"."modules" (
    "key"         text PRIMARY KEY,
    "label"       text NOT NULL,
    "route"       text NOT NULL,
    "nav_group"   text NOT NULL,
    "sort_order"  integer NOT NULL DEFAULT 0,
    "created_at"  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "modules_key_format"  CHECK ("key" ~ '^[a-z_]{3,32}$'),
    CONSTRAINT "modules_group_valid" CHECK ("nav_group" IN ('overview', 'operation', 'management'))
);

COMMENT ON TABLE "public"."modules" IS 'Módulos navegáveis. `route` e `nav_group` alimentam o NAV do front (Layout.tsx:41).';


-- ---------------------------------------------------------------------
-- Matriz de permissões — a fonte de verdade
-- ---------------------------------------------------------------------
CREATE TABLE "public"."role_modules" (
    "role_key"    text    NOT NULL REFERENCES "public"."roles"("key")   ON DELETE CASCADE,
    "module_key"  text    NOT NULL REFERENCES "public"."modules"("key") ON DELETE CASCADE,
    "can_read"    boolean NOT NULL DEFAULT true,
    "can_write"   boolean NOT NULL DEFAULT false,
    PRIMARY KEY ("role_key", "module_key"),
    -- Escrever sem poder ler não faz sentido em nenhuma tela do front.
    CONSTRAINT "role_modules_write_implies_read" CHECK (NOT "can_write" OR "can_read")
);

COMMENT ON TABLE "public"."role_modules" IS
  'Matriz módulo × papel (docs/01-analise-frontend.md §5). Lida pela RLS e pelo front — única fonte de verdade.';


-- ---------------------------------------------------------------------
-- Equipe (pessoas que executam serviços)
-- ---------------------------------------------------------------------
-- Ambiguidade A1: RESPONSAVEIS (constants.ts:96) e PERFIS (constants.ts:98)
-- são listas diferentes. Marcelo e Rita executam serviços e não têm login;
-- Camila abre comandas e não executa. Daí `staff` separado de `profiles`.
CREATE TABLE "public"."staff" (
    "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "name"        text NOT NULL,
    "initials"    text NOT NULL DEFAULT '',
    "job_title"   text NOT NULL DEFAULT '',
    "can_execute" boolean NOT NULL DEFAULT true,
    "active"      boolean NOT NULL DEFAULT true,
    "sort_order"  integer NOT NULL DEFAULT 0,
    "created_at"  timestamptz NOT NULL DEFAULT now(),
    "updated_at"  timestamptz NOT NULL DEFAULT now(),
    "deleted_at"  timestamptz,
    CONSTRAINT "staff_name_min" CHECK (char_length(btrim("name")) > 1)
);

COMMENT ON TABLE  "public"."staff" IS 'Equipe da loja. can_execute = aparece na lista de responsáveis (RESPONSAVEIS).';
COMMENT ON COLUMN "public"."staff"."can_execute" IS 'Camila (atendimento) é staff mas não executa serviços → false.';

CREATE UNIQUE INDEX "staff_name_unique_active"
    ON "public"."staff" (lower(btrim("name"))) WHERE "deleted_at" IS NULL;
CREATE INDEX "staff_executors_idx"
    ON "public"."staff" ("sort_order") WHERE "deleted_at" IS NULL AND "active" AND "can_execute";

CREATE TRIGGER "staff_set_updated_at"
    BEFORE UPDATE ON "public"."staff"
    FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();


-- ---------------------------------------------------------------------
-- Perfis (1:1 com auth.users)
-- ---------------------------------------------------------------------
CREATE TABLE "public"."profiles" (
    "id"          uuid PRIMARY KEY REFERENCES "auth"."users"("id") ON DELETE CASCADE,
    "full_name"   text NOT NULL,
    "email"       text,
    "role_key"    text NOT NULL REFERENCES "public"."roles"("key") ON DELETE RESTRICT,
    "staff_id"    uuid REFERENCES "public"."staff"("id") ON DELETE SET NULL,
    "is_active"   boolean NOT NULL DEFAULT true,
    "created_at"  timestamptz NOT NULL DEFAULT now(),
    "updated_at"  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "profiles_name_min" CHECK (char_length(btrim("full_name")) > 1)
);

COMMENT ON TABLE  "public"."profiles" IS 'Perfil do usuário autenticado. Criado por trigger em auth.users.';
COMMENT ON COLUMN "public"."profiles"."staff_id" IS 'Liga o login à pessoa da equipe. NULL para logins sem execução de serviço.';

CREATE INDEX "profiles_role_idx"  ON "public"."profiles" ("role_key");
CREATE INDEX "profiles_staff_idx" ON "public"."profiles" ("staff_id");

CREATE TRIGGER "profiles_set_updated_at"
    BEFORE UPDATE ON "public"."profiles"
    FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();


-- =====================================================================
-- Helpers de autorização (agora com a implementação real)
-- ---------------------------------------------------------------------
-- SECURITY DEFINER + search_path fixo: sem isso, uma policy que consulta
-- `profiles` dispararia a RLS de `profiles` e entraria em recursão.
-- =====================================================================

CREATE OR REPLACE FUNCTION "public"."current_role_key"() RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT p."role_key"
  FROM public.profiles p
  WHERE p."id" = auth.uid() AND p."is_active"
  LIMIT 1;
$$;

COMMENT ON FUNCTION "public"."current_role_key"() IS 'Papel do usuário autenticado, ou NULL se inativo/anônimo.';


CREATE OR REPLACE FUNCTION "public"."current_staff_id"() RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT p."staff_id"
  FROM public.profiles p
  WHERE p."id" = auth.uid() AND p."is_active"
  LIMIT 1;
$$;


CREATE OR REPLACE FUNCTION "public"."current_actor_name"() RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT coalesce(
    (SELECT p."full_name" FROM public.profiles p WHERE p."id" = auth.uid() LIMIT 1),
    'Sistema'
  );
$$;

COMMENT ON FUNCTION "public"."current_actor_name"() IS
  'Nome do autor para order_events e audit_logs. Substitui os autores hardcoded do front (ambiguidade A5).';


-- Pode LER o módulo?
CREATE OR REPLACE FUNCTION "public"."can_read"("p_module" text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.role_modules rm ON rm."role_key" = p."role_key"
    WHERE p."id" = auth.uid()
      AND p."is_active"
      AND rm."module_key" = p_module
      AND rm."can_read"
  );
$$;

COMMENT ON FUNCTION "public"."can_read"(text) IS 'Predicado de SELECT das policies. Lê role_modules.';


-- Pode ESCREVER no módulo?
CREATE OR REPLACE FUNCTION "public"."can_write"("p_module" text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.roles        r  ON r."key"       = p."role_key"
    JOIN public.role_modules rm ON rm."role_key" = p."role_key"
    WHERE p."id" = auth.uid()
      AND p."is_active"
      AND NOT r."is_readonly"          -- trava dura do papel de consulta (ambiguidade A2)
      AND rm."module_key" = p_module
      AND rm."can_write"
  );
$$;

COMMENT ON FUNCTION "public"."can_write"(text) IS
  'Predicado de INSERT/UPDATE/DELETE. roles.is_readonly vence role_modules — viewer nunca escreve.';


-- Atalho de leitura para o dono da loja (módulo settings).
CREATE OR REPLACE FUNCTION "public"."is_owner"() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT public.can_write('settings');
$$;


-- ---------------------------------------------------------------------
-- Provisionamento de perfil ao criar usuário no Auth
-- ---------------------------------------------------------------------
-- O papel vem de raw_user_meta_data.role_key (definido por quem convida).
-- Default `viewer`: um usuário criado sem metadados nasce sem poder escrever.
CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_role  text;
  v_staff uuid;
BEGIN
  v_role := coalesce(NEW.raw_user_meta_data->>'role_key', 'viewer');

  IF NOT EXISTS (SELECT 1 FROM public.roles WHERE "key" = v_role) THEN
    v_role := 'viewer';
  END IF;

  -- Vincula à pessoa da equipe pelo nome, quando informado.
  SELECT s."id" INTO v_staff
  FROM public.staff s
  WHERE s."deleted_at" IS NULL
    AND lower(btrim(s."name")) = lower(btrim(coalesce(NEW.raw_user_meta_data->>'staff_name', '')))
  LIMIT 1;

  INSERT INTO public.profiles ("id", "full_name", "email", "role_key", "staff_id")
  VALUES (
    NEW."id",
    coalesce(NULLIF(btrim(NEW.raw_user_meta_data->>'full_name'), ''), split_part(NEW."email", '@', 1)),
    NEW."email",
    v_role,
    v_staff
  )
  ON CONFLICT ("id") DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "on_auth_user_created" ON "auth"."users";
CREATE TRIGGER "on_auth_user_created"
    AFTER INSERT ON "auth"."users"
    FOR EACH ROW EXECUTE FUNCTION "public"."handle_new_user"();


-- =====================================================================
-- RLS
-- =====================================================================
ALTER TABLE "public"."roles"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."modules"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."role_modules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."staff"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."profiles"     ENABLE ROW LEVEL SECURITY;

-- Catálogo de papéis/módulos/matriz: legível por qualquer autenticado
-- (o front precisa para montar o menu). Escrita só pelo responsável.
CREATE POLICY "roles_select" ON "public"."roles"
    FOR SELECT TO "authenticated" USING (true);
CREATE POLICY "roles_write" ON "public"."roles"
    FOR ALL TO "authenticated" USING ("public"."is_owner"()) WITH CHECK ("public"."is_owner"());

CREATE POLICY "modules_select" ON "public"."modules"
    FOR SELECT TO "authenticated" USING (true);
CREATE POLICY "modules_write" ON "public"."modules"
    FOR ALL TO "authenticated" USING ("public"."is_owner"()) WITH CHECK ("public"."is_owner"());

CREATE POLICY "role_modules_select" ON "public"."role_modules"
    FOR SELECT TO "authenticated" USING (true);
CREATE POLICY "role_modules_write" ON "public"."role_modules"
    FOR ALL TO "authenticated" USING ("public"."is_owner"()) WITH CHECK ("public"."is_owner"());

-- Equipe: todo autenticado lê (selects de responsável em várias telas).
-- Escrita só pelo responsável (módulo settings).
CREATE POLICY "staff_select" ON "public"."staff"
    FOR SELECT TO "authenticated" USING ("deleted_at" IS NULL);
CREATE POLICY "staff_write" ON "public"."staff"
    FOR ALL TO "authenticated" USING ("public"."is_owner"()) WITH CHECK ("public"."is_owner"());

-- Perfis: cada um vê o seu; o responsável vê todos.
CREATE POLICY "profiles_select_self" ON "public"."profiles"
    FOR SELECT TO "authenticated" USING ("id" = auth.uid() OR "public"."is_owner"());
-- Ninguém muda o próprio papel: quem altera role_key/is_active é o responsável.
CREATE POLICY "profiles_update_self" ON "public"."profiles"
    FOR UPDATE TO "authenticated"
    USING ("id" = auth.uid())
    WITH CHECK (
      "id" = auth.uid()
      AND "role_key"  = "public"."current_role_key"()
      AND "is_active" = true
    );
CREATE POLICY "profiles_admin_all" ON "public"."profiles"
    FOR ALL TO "authenticated" USING ("public"."is_owner"()) WITH CHECK ("public"."is_owner"());
