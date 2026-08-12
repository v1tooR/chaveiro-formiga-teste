-- =====================================================================
-- 20260729121600 — Criação de usuários a partir do SQL (com cautela)
-- ---------------------------------------------------------------------
-- POR QUE ISTO EXISTE
--
-- O schema `auth` pertence ao GoTrue, não a este projeto. Na imagem
-- supabase/postgres recém-inicializada, `auth.users` é um STUB antigo
-- (sem `email_confirmed_at`) e `auth.identities` NÃO EXISTE — as duas
-- coisas só aparecem quando o container do GoTrue sobe e roda as
-- próprias migrations, o que acontece DEPOIS do db-init.
--
-- Escrever `INSERT INTO auth.users (...)` direto no seed portanto:
--   • funciona no Supabase CLI (schema completo)
--   • QUEBRA no docker compose em volume novo
--
-- Solução: esta função detecta o estado do schema.
--   • schema moderno → cria o usuário
--   • schema stub    → não cria, avisa, e retorna NULL
-- No segundo caso, scripts/bootstrap-users.sh cria os usuários pela
-- Admin API do GoTrue, que é o caminho suportado e independente de
-- versão. Os seeds toleram os dois cenários.
-- =====================================================================

CREATE OR REPLACE FUNCTION "private"."auth_schema_is_ready"() RETURNS boolean
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  SELECT
    EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'auth' AND table_name = 'users' AND column_name = 'email_confirmed_at'
    )
    AND EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'auth' AND table_name = 'identities'
    );
$$;

COMMENT ON FUNCTION "private"."auth_schema_is_ready"() IS
  'true quando o GoTrue já migrou o schema auth. Falso na primeira subida do volume.';


CREATE OR REPLACE FUNCTION "private"."create_auth_user"(
    "p_email"     text,
    "p_password"  text,
    "p_full_name" text,
    "p_role_key"  text,
    "p_staff_name" text DEFAULT NULL
) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_uid          uuid;
  v_staff        uuid;
  v_has_provider boolean;
BEGIN
  -- Já existe? Preserva a senha e só garante o perfil.
  EXECUTE 'SELECT "id" FROM auth.users WHERE "email" = $1' INTO v_uid USING p_email;

  IF v_uid IS NULL THEN
    IF NOT private.auth_schema_is_ready() THEN
      RAISE NOTICE
        'Schema auth ainda não migrado — usuário % não foi criado aqui. Rode scripts/bootstrap-users.sh.',
        p_email;
      RETURN NULL;
    END IF;

    v_uid := gen_random_uuid();

    EXECUTE $sql$
      INSERT INTO auth.users (
        "id", "instance_id", "aud", "role", "email", "encrypted_password",
        "email_confirmed_at", "raw_app_meta_data", "raw_user_meta_data",
        "created_at", "updated_at"
      )
      VALUES (
        $1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        $2, extensions.crypt($3, extensions.gen_salt('bf')), now(),
        '{"provider": "email", "providers": ["email"]}'::jsonb,
        $4, now(), now()
      )
    $sql$
    USING
      v_uid,
      p_email,
      p_password,
      jsonb_strip_nulls(jsonb_build_object(
        'full_name',  p_full_name,
        'role_key',   p_role_key,
        'staff_name', p_staff_name
      ));

    -- `provider_id` entrou em auth.identities no GoTrue v2.
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'auth' AND table_name = 'identities' AND column_name = 'provider_id'
    ) INTO v_has_provider;

    IF v_has_provider THEN
      EXECUTE $sql$
        INSERT INTO auth.identities
          ("id", "user_id", "provider_id", "provider", "identity_data", "created_at", "updated_at")
        VALUES ($1, $2, $2::text, 'email', $3, now(), now())
      $sql$
      USING gen_random_uuid(), v_uid,
            jsonb_build_object('sub', v_uid::text, 'email', p_email, 'email_verified', true);
    ELSE
      EXECUTE $sql$
        INSERT INTO auth.identities
          ("id", "user_id", "provider", "identity_data", "created_at", "updated_at")
        VALUES ($1, $2, 'email', $3, now(), now())
      $sql$
      USING gen_random_uuid(), v_uid,
            jsonb_build_object('sub', v_uid::text, 'email', p_email, 'email_verified', true);
    END IF;

    RAISE NOTICE 'Usuário criado: % (%)', p_email, p_role_key;
  END IF;

  -- Perfil: o trigger handle_new_user já cuidou disso, mas garantimos o
  -- papel correto quando o usuário veio por outro caminho (Admin API).
  SELECT s."id" INTO v_staff
  FROM public.staff s
  WHERE s."deleted_at" IS NULL
    AND lower(s."name") = lower(coalesce(p_staff_name, '~nenhum~'));

  INSERT INTO public.profiles ("id", "full_name", "email", "role_key", "staff_id", "is_active")
  VALUES (v_uid, p_full_name, p_email, p_role_key, v_staff, true)
  ON CONFLICT ("id") DO UPDATE
  SET "full_name" = EXCLUDED."full_name",
      "email"     = EXCLUDED."email",
      "role_key"  = EXCLUDED."role_key",
      "staff_id"  = coalesce(EXCLUDED."staff_id", profiles."staff_id"),
      "is_active" = true;

  RETURN v_uid;
END;
$$;

COMMENT ON FUNCTION "private"."create_auth_user"(text, text, text, text, text) IS
  'Cria usuário + identidade + perfil, adaptando-se à versão do schema auth. Idempotente; nunca sobrescreve senha existente.';


-- ---------------------------------------------------------------------
-- Reconciliação de perfil para usuários criados pela Admin API
-- ---------------------------------------------------------------------
-- O bootstrap-users.sh cria o usuário pelo GoTrue; o trigger
-- handle_new_user monta o perfil a partir de raw_user_meta_data. Esta
-- função corrige o vínculo com a equipe depois do fato, porque `staff`
-- pode ter sido semeada só depois.
CREATE OR REPLACE FUNCTION "private"."reconcile_profiles"() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_fixed integer := 0;
BEGIN
  WITH linked AS (
    UPDATE public.profiles p
    SET "staff_id" = s."id"
    FROM public.staff s
    WHERE p."staff_id" IS NULL
      AND s."deleted_at" IS NULL
      AND lower(s."name") = lower(split_part(p."full_name", ' ', 1))
    RETURNING 1
  )
  SELECT count(*) INTO v_fixed FROM linked;

  RETURN v_fixed;
END;
$$;

REVOKE ALL ON FUNCTION "private"."create_auth_user"(text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION "private"."reconcile_profiles"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "private"."auth_schema_is_ready"() FROM PUBLIC;
