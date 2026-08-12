-- =====================================================================
-- 20260812204350 — metadados de autorização controlados pelo servidor
-- ---------------------------------------------------------------------
-- `raw_user_meta_data` é editável pelo próprio usuário. Papel e vínculo
-- com a equipe são autorização e, portanto, precisam vir de
-- `raw_app_meta_data`, que somente a Admin API/service role altera.
-- Contas criadas sem provisionamento administrativo nascem inativas.
-- =====================================================================

-- Preserva os acessos legítimos de instalações já existentes antes de
-- trocar a origem dos metadados. O perfil é o estado confiável atual.
UPDATE auth.users u
SET raw_app_meta_data = coalesce(u.raw_app_meta_data, '{}'::jsonb)
  || jsonb_strip_nulls(jsonb_build_object(
       'role_key', p.role_key,
       'staff_name', s.name
     ))
FROM public.profiles p
LEFT JOIN public.staff s ON s.id = p.staff_id
WHERE p.id = u.id;


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_role       text;
  v_staff      uuid;
  v_authorized boolean;
BEGIN
  v_role := NEW.raw_app_meta_data->>'role_key';

  SELECT EXISTS (
    SELECT 1 FROM public.roles WHERE "key" = v_role
  ) INTO v_authorized;

  IF NOT v_authorized THEN
    v_role := 'viewer';
  END IF;

  SELECT s."id" INTO v_staff
  FROM public.staff s
  WHERE s."deleted_at" IS NULL
    AND lower(btrim(s."name")) = lower(btrim(coalesce(NEW.raw_app_meta_data->>'staff_name', '')))
  LIMIT 1;

  INSERT INTO public.profiles
    ("id", "full_name", "email", "role_key", "staff_id", "is_active")
  VALUES (
    NEW."id",
    coalesce(NULLIF(btrim(NEW.raw_user_meta_data->>'full_name'), ''), split_part(NEW."email", '@', 1)),
    NEW."email",
    v_role,
    v_staff,
    v_authorized
  )
  ON CONFLICT ("id") DO NOTHING;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION "public"."handle_new_user"() IS
  'Cria perfil usando app_metadata para autorização; usuários não provisionados ficam inativos.';

REVOKE ALL ON FUNCTION "public"."handle_new_user"() FROM PUBLIC, "anon", "authenticated";


-- Mantém o bootstrap SQL compatível com a mesma regra. `full_name` é
-- dado de apresentação; papel e vínculo ficam em app_metadata.
CREATE OR REPLACE FUNCTION "private"."create_auth_user"(
    "p_email"      text,
    "p_password"   text,
    "p_full_name"  text,
    "p_role_key"   text,
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
        $4, $5, now(), now()
      )
    $sql$
    USING
      v_uid,
      p_email,
      p_password,
      jsonb_strip_nulls(jsonb_build_object(
        'provider', 'email',
        'providers', jsonb_build_array('email'),
        'role_key', p_role_key,
        'staff_name', p_staff_name
      )),
      jsonb_build_object('full_name', p_full_name);

    PERFORM private.auth_user_tokens_vazios(v_uid);

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
  'Cria usuário + identidade + perfil; autorização fica em app_metadata.';

REVOKE ALL ON FUNCTION "private"."create_auth_user"(text, text, text, text, text) FROM PUBLIC;
