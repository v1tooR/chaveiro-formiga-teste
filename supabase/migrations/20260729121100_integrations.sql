-- =====================================================================
-- 20260729121100 — Módulo central de integrações
-- ---------------------------------------------------------------------
-- Registro de integrações externas: nome, provedor, config NÃO sensível
-- e flag enabled.
--
-- SEGREDOS NUNCA ENTRAM AQUI. `secret_ref` guarda apenas o NOME da
-- variável onde o segredo vive:
--   • Edge Functions  → `supabase secrets set WHATSAPP_TOKEN=...`
--   • Postgres        → Supabase Vault (`vault.create_secret`)
-- Uma constraint impede que qualquer chave suspeita entre no JSON.
--
-- A lista de integrações vem de docs/01-analise-frontend.md §8 — todos os
-- pontos "(simulado)" que existem hoje no front. Nada inventado.
--
-- A TELA de administração destas integrações é a ÚLTIMA etapa da
-- implementação (Etapa 3, item 3).
-- =====================================================================

CREATE TABLE "public"."integrations" (
    "id"        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "key"       text NOT NULL,
    "name"      text NOT NULL,
    "kind"      text NOT NULL,
    "provider"  text NOT NULL DEFAULT '',
    "description" text NOT NULL DEFAULT '',

    -- Config NÃO sensível: número do remetente, template, formato, etc.
    "config"    jsonb NOT NULL DEFAULT '{}'::jsonb,
    "enabled"   boolean NOT NULL DEFAULT false,

    -- Nome da variável de ambiente / chave do Vault. Nunca o valor.
    "secret_ref"  text,

    -- Última verificação de saúde (preenchida pela Edge Function).
    "last_status"      text,
    "last_error"      text,
    "last_checked_at"  timestamptz,

    "created_at"  timestamptz NOT NULL DEFAULT now(),
    "updated_at"  timestamptz NOT NULL DEFAULT now(),
    "created_by"  uuid REFERENCES "public"."profiles"("id") ON DELETE SET NULL,

    CONSTRAINT "integrations_key_format" CHECK ("key" ~ '^[a-z][a-z0-9_]{2,40}$'),
    CONSTRAINT "integrations_kind_valid" CHECK ("kind" IN ('messaging', 'document', 'export')),
    CONSTRAINT "integrations_status_valid" CHECK (
      "last_status" IS NULL OR "last_status" IN ('ok', 'error', 'unconfigured')
    ),
    CONSTRAINT "integrations_secret_ref_format" CHECK (
      "secret_ref" IS NULL OR "secret_ref" ~ '^[A-Z][A-Z0-9_]{2,60}$'
    ),
    -- Integração habilitada precisa saber ONDE está o segredo.
    CONSTRAINT "integrations_enabled_needs_secret" CHECK (NOT "enabled" OR "secret_ref" IS NOT NULL)
);

COMMENT ON TABLE  "public"."integrations" IS
  'Registro de integrações externas. Config não sensível apenas — segredos ficam no Vault/secrets.';
COMMENT ON COLUMN "public"."integrations"."config" IS
  'JSON não sensível. Chaves com aparência de segredo são rejeitadas por trigger.';
COMMENT ON COLUMN "public"."integrations"."secret_ref" IS
  'NOME da variável do segredo (ex.: WHATSAPP_API_TOKEN). Nunca o valor.';
COMMENT ON COLUMN "public"."integrations"."kind" IS
  'messaging (WhatsApp) | document (PDF) | export (CSV/XLSX, link de relatório).';

CREATE UNIQUE INDEX "integrations_key_unique" ON "public"."integrations" ("key");
CREATE INDEX "integrations_enabled_idx" ON "public"."integrations" ("kind") WHERE "enabled";

CREATE TRIGGER "integrations_set_updated_at"
    BEFORE UPDATE ON "public"."integrations"
    FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();


-- ---------------------------------------------------------------------
-- Guarda: nenhum segredo no banco
-- ---------------------------------------------------------------------
-- Barreira de defesa, não decoração: sem ela, basta um desenvolvedor
-- distraído colar `{"api_key": "..."}` na config e o token vai para o
-- backup, para o log de auditoria e para o REST.
CREATE OR REPLACE FUNCTION "public"."guard_integration_config"() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
DECLARE
  v_key      text;
  v_forbidden text[] := ARRAY[
    'token', 'secret', 'password', 'passwd', 'apikey', 'api_key',
    'access_key', 'private_key', 'client_secret', 'credential',
    'authorization', 'bearer', 'senha', 'chave'
  ];
  v_bad text;
BEGIN
  IF jsonb_typeof(NEW."config") <> 'object' THEN
    RAISE EXCEPTION 'integrations.config deve ser um objeto JSON.' USING ERRCODE = '23514';
  END IF;

  FOR v_key IN SELECT jsonb_object_keys(NEW."config") LOOP
    FOREACH v_bad IN ARRAY v_forbidden LOOP
      IF lower(v_key) LIKE '%' || v_bad || '%' THEN
        RAISE EXCEPTION
          'Chave "%" não é permitida em integrations.config: segredos vão para o Vault ou para os secrets da Edge Function, com o NOME em secret_ref.',
          v_key
          USING ERRCODE = '42501';
      END IF;
    END LOOP;
  END LOOP;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "integrations_guard_config"
    BEFORE INSERT OR UPDATE ON "public"."integrations"
    FOR EACH ROW EXECUTE FUNCTION "public"."guard_integration_config"();

CREATE TRIGGER "audit_integrations"
    AFTER INSERT OR UPDATE OR DELETE ON "public"."integrations"
    FOR EACH ROW EXECUTE FUNCTION "public"."trg_audit"();


-- ---------------------------------------------------------------------
-- Leitura pública (para o front saber se pode mostrar o botão)
-- ---------------------------------------------------------------------
-- O operador precisa saber se "Avisar cliente" está disponível, mas não
-- precisa ver provider, config nem secret_ref.
--
-- Deliberadamente SEM `security_invoker`: a view roda com as permissões
-- do seu owner (postgres) e contorna a RLS de `integrations`. É o que
-- permite liberar o STATUS para todos sem liberar a TABELA para ninguém.
CREATE OR REPLACE VIEW "public"."integration_status" AS
SELECT
  i."key",
  i."name",
  i."kind",
  i."enabled",
  i."last_status",
  i."last_checked_at"
FROM "public"."integrations" i;

COMMENT ON VIEW "public"."integration_status" IS
  'Projeção sem dados de configuração: só diz se a integração está ativa.';


-- =====================================================================
-- RLS — só o responsável (módulo settings)
-- =====================================================================
ALTER TABLE "public"."integrations" ENABLE ROW LEVEL SECURITY;

-- Única policy da tabela: nem `config` nem `secret_ref` saem daqui para
-- quem não administra o sistema.
CREATE POLICY "integrations_owner_all" ON "public"."integrations"
    FOR ALL TO "authenticated"
    USING ("public"."can_write"('settings'))
    WITH CHECK ("public"."can_write"('settings'));

-- O status (colunas seguras) é liberado pela view, não pela tabela.
REVOKE ALL ON "public"."integrations" FROM "anon";
GRANT SELECT ON "public"."integration_status" TO "authenticated";
