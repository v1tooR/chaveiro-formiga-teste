-- =====================================================================
-- 20260729120000 — Extensões e funções auxiliares
-- ---------------------------------------------------------------------
-- Base de todo o resto: extensões, o schema `private` (nada exposto na
-- API REST) e os helpers de autorização usados por TODAS as policies.
--
-- Sistema single-tenant (uma loja). Ver docs/01-analise-frontend.md §2.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";
CREATE EXTENSION IF NOT EXISTS "unaccent" WITH SCHEMA "extensions";
CREATE EXTENSION IF NOT EXISTS "pg_trgm" WITH SCHEMA "extensions";

-- Schema privado: helpers e tabelas que nunca devem sair pela API.
CREATE SCHEMA IF NOT EXISTS "private";
REVOKE ALL ON SCHEMA "private" FROM "anon", "authenticated";


-- ---------------------------------------------------------------------
-- updated_at automático (regra: toda tabela mutável usa este trigger)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION "public"."set_updated_at"() IS
  'Trigger BEFORE UPDATE: mantém updated_at. Aplicado em toda tabela mutável.';


-- ---------------------------------------------------------------------
-- Normalização de busca acento-insensível
-- Espelha normaliza()/matchBusca() de src/lib/utils.ts
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."normalize_search"("value" text) RETURNS text
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    SET search_path TO ''
    AS $$
  SELECT lower(extensions.unaccent(coalesce(value, '')));
$$;

COMMENT ON FUNCTION "public"."normalize_search"(text) IS
  'Minúsculas + remoção de acentos. Base dos índices de busca textual.';


-- ---------------------------------------------------------------------
-- Normalização de telefone (só dígitos)
-- Espelha telefone.replace(/\D/g, '') do front
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."digits_only"("value" text) RETURNS text
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    SET search_path TO ''
    AS $$
  SELECT regexp_replace(coalesce(value, ''), '[^0-9]', '', 'g');
$$;


-- =====================================================================
-- Helpers de autorização
-- ---------------------------------------------------------------------
-- Todos são STABLE + SECURITY DEFINER + search_path fixo. Sem isso, a
-- policy consultaria `profiles`, que tem RLS, e entraria em recursão.
-- As definições reais chegam na migration de profiles/role_modules;
-- aqui só criamos os stubs para que a ordem de dependência não trave.
-- =====================================================================

CREATE OR REPLACE FUNCTION "public"."current_actor_name"() RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT 'Sistema'::text;
$$;

COMMENT ON FUNCTION "public"."current_actor_name"() IS
  'Nome legível do usuário autenticado, para eventos e auditoria. Redefinida em 20260729120100.';
