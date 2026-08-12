-- =====================================================================
-- 20260730210000 — create_auth_user: colunas de token vazias, não NULL
-- ---------------------------------------------------------------------
-- SINTOMA
--
-- Depois de rodar `npm run db:seed:demo` com a stack já no ar, TODO login
-- de demonstração passava a devolver 500:
--
--   POST /auth/v1/token → {"code":500,"error_code":"unexpected_failure",
--                          "msg":"Database error querying schema"}
--
-- E no log do container de auth:
--
--   error finding user: sql: Scan error on column index 3,
--   name "confirmation_token": converting NULL to string is unsupported
--
-- CAUSA
--
-- O GoTrue mapeia `confirmation_token`, `recovery_token`, `email_change`
-- e afins como `string` em Go — não `sql.NullString`. Qualquer NULL
-- nessas colunas quebra a leitura do usuário INTEIRO, mesmo que o login
-- não tenha nada a ver com confirmação de e-mail.
--
-- O INSERT de `create_auth_user` (20260729121600) não preenchia nenhuma
-- delas. O bug ficava escondido porque, no boot normal, o schema `auth`
-- ainda não existe quando os seeds rodam: a função detecta isso, avisa e
-- devolve NULL, e quem cria os usuários de verdade é
-- `scripts/bootstrap-users.sh` pela Admin API do GoTrue — que preenche
-- tudo com string vazia.
--
-- Ou seja: só aparecia para quem re-semeasse a demonstração depois de a
-- stack subir. Que é exatamente o que `npm run db:seed:demo` faz.
--
-- CORREÇÃO
--
-- A lista de colunas varia entre versões do GoTrue, então o preenchimento
-- é defensivo: só toca no que existe em `information_schema`.
-- =====================================================================


-- ---------------------------------------------------------------------
-- Zera as colunas de token de um usuário recém-criado
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "private"."auth_user_tokens_vazios"("p_uid" uuid)
    RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_col  text;
  v_sets text[] := '{}';
BEGIN
  FOREACH v_col IN ARRAY ARRAY[
    'confirmation_token',
    'recovery_token',
    'email_change',
    'email_change_token_new',
    'email_change_token_current',
    'phone_change',
    'phone_change_token',
    'reauthentication_token'
  ] LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'auth' AND table_name = 'users' AND column_name = v_col
    ) THEN
      v_sets := v_sets || format('%I = coalesce(%I, %L)', v_col, v_col, '');
    END IF;
  END LOOP;

  IF array_length(v_sets, 1) IS NULL THEN
    RETURN;
  END IF;

  EXECUTE format('UPDATE auth.users SET %s WHERE "id" = $1', array_to_string(v_sets, ', '))
  USING p_uid;
END;
$$;

COMMENT ON FUNCTION "private"."auth_user_tokens_vazios"(uuid) IS
  'GoTrue lê as colunas de token como string não-anulável: NULL nelas quebra o login com 500.';


-- ---------------------------------------------------------------------
-- Passa a chamar depois de cada INSERT
-- ---------------------------------------------------------------------
-- Só o trecho do INSERT muda; o resto do corpo é o da 20260729121600.
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

    -- ⚠️ Sem isto o usuário nasce com os tokens NULL e TODO login dele
    -- devolve 500 no GoTrue. Ver o cabeçalho desta migration.
    PERFORM private.auth_user_tokens_vazios(v_uid);

    -- A identidade só existe a partir de certas versões do GoTrue.
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'auth' AND table_name = 'identities' AND column_name = 'provider_id'
    ) INTO v_has_provider;

    IF v_has_provider THEN
      EXECUTE $sql$
        INSERT INTO auth.identities
          ("id", "user_id", "provider_id", "identity_data", "provider", "last_sign_in_at",
           "created_at", "updated_at")
        VALUES (gen_random_uuid(), $1, $1::text,
                jsonb_build_object('sub', $1::text, 'email', $2, 'email_verified', true),
                'email', now(), now(), now())
        ON CONFLICT DO NOTHING
      $sql$ USING v_uid, p_email;
    ELSE
      EXECUTE $sql$
        INSERT INTO auth.identities
          ("id", "user_id", "identity_data", "provider", "last_sign_in_at", "created_at", "updated_at")
        VALUES (gen_random_uuid(), $1,
                jsonb_build_object('sub', $1::text, 'email', $2, 'email_verified', true),
                'email', now(), now(), now())
        ON CONFLICT DO NOTHING
      $sql$ USING v_uid, p_email;
    END IF;
  END IF;

  -- Perfil (o trigger handle_new_user pode já ter criado).
  SELECT s."id" INTO v_staff
  FROM public.staff s
  WHERE p_staff_name IS NOT NULL
    AND lower(btrim(s."name")) = lower(btrim(p_staff_name))
    AND s."deleted_at" IS NULL;

  INSERT INTO public.profiles ("id", "full_name", "email", "role_key", "staff_id", "is_active")
  VALUES (v_uid, p_full_name, p_email, p_role_key, v_staff, true)
  ON CONFLICT ("id") DO UPDATE
  SET "full_name" = EXCLUDED."full_name",
      "email"     = EXCLUDED."email",
      "role_key"  = EXCLUDED."role_key",
      "staff_id"  = coalesce(EXCLUDED."staff_id", public.profiles."staff_id"),
      "is_active" = true;

  RETURN v_uid;
END;
$$;

COMMENT ON FUNCTION "private"."create_auth_user"(text, text, text, text, text) IS
  'Cria usuário + identidade + perfil, adaptando-se à versão do schema auth. Idempotente; nunca sobrescreve senha existente.';

REVOKE ALL ON FUNCTION "private"."create_auth_user"(text, text, text, text, text) FROM PUBLIC;


-- ---------------------------------------------------------------------
-- Reparo das linhas já quebradas
-- ---------------------------------------------------------------------
-- Alcança os ambientes onde alguém já rodou o seed com a stack no ar.
DO $$
DECLARE r record;
BEGIN
  IF NOT private.auth_schema_is_ready() THEN
    RAISE NOTICE 'Schema auth ainda não migrado — reparo de tokens adiado.';
    RETURN;
  END IF;
  FOR r IN EXECUTE 'SELECT "id" FROM auth.users' LOOP
    PERFORM private.auth_user_tokens_vazios(r."id");
  END LOOP;
END $$;
