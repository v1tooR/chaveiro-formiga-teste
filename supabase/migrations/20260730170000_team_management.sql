-- =====================================================================
-- 20260730170000 — Gestão de equipe pela interface
-- ---------------------------------------------------------------------
-- Configurações → Equipe era só leitura: contratar ou desligar alguém
-- exigia abrir o Supabase Studio. As policies já permitiam a escrita
-- (`profiles_admin_all` com `is_owner()`), faltava a API e a tela.
--
-- Esta migration entrega duas RPCs com as guardas que um `if` no React
-- não pode garantir, e fecha um buraco de auto-lockout que existia desde
-- a 20260729120100.
--
-- FORA DE ESCOPO, por decisão: CONVIDAR usuário. Criar linha em
-- `auth.users` exige `service_role`, que não pode passar pelo browser —
-- precisaria de uma Edge Function, e `supabase/functions/` está vazia. O
-- provisionamento segue por `scripts/bootstrap-users.sh`.
-- =====================================================================


-- ---------------------------------------------------------------------
-- Trava de auto-rebaixamento
-- ---------------------------------------------------------------------
-- Buraco real que existe hoje: policies PERMISSIVAS se combinam por OR, e
-- `profiles_admin_all` é `FOR ALL USING is_owner()`. Então o responsável
-- passa por ela e consegue gravar `is_active = false` ou
-- `role_key = 'viewer'` em si mesmo — a `profiles_update_self`, que
-- proibiria, é simplesmente contornada pelo outro ramo do OR.
--
-- O estrago é irreversível pela interface: o único caminho para conceder
-- `settings:write` é `role_modules`, que também exige `is_owner()`. Um
-- clique errado deixa o sistema sem nenhum administrador, e a saída passa
-- a ser `psql`.
--
-- RESTRICTIVE porque precisa valer JUNTO com a permissiva, não em
-- alternativa a ela. Não afeta as RPCs abaixo (SECURITY DEFINER roda como
-- dono da tabela, e `profiles` não tem FORCE ROW LEVEL SECURITY), e não
-- impede o responsável de editar o próprio `full_name`.
CREATE POLICY "profiles_self_role_lock" ON "public"."profiles"
    AS RESTRICTIVE FOR UPDATE TO "authenticated"
    USING (true)
    WITH CHECK (
      "id" <> auth.uid()
      OR ("role_key" = "public"."current_role_key"() AND "is_active")
    );


-- ---------------------------------------------------------------------
-- Quantos responsáveis ativos existem além de um dado perfil
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "private"."other_active_owners"("p_except" uuid)
    RETURNS integer
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT count(*)::integer
  FROM public.profiles p
  JOIN public.role_modules rm ON rm."role_key" = p."role_key"
  WHERE p."id" <> p_except
    AND p."is_active"
    AND rm."module_key" = 'settings'
    AND rm."can_write";
$$;


-- ---------------------------------------------------------------------
-- Trocar o papel de acesso
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."set_profile_role"(
  "p_profile_id" uuid,
  "p_role_key"   text
)
    RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_nome     text;
  v_era      text;
  v_vai_ter  boolean;
BEGIN
  IF NOT public.is_owner() THEN
    RAISE EXCEPTION 'Somente o responsável pode alterar papéis de acesso.' USING ERRCODE = '42501';
  END IF;

  IF p_profile_id = auth.uid() THEN
    RAISE EXCEPTION 'Você não pode alterar o próprio papel de acesso.' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.roles WHERE "key" = p_role_key) THEN
    RAISE EXCEPTION 'Papel "%" não existe.', p_role_key USING ERRCODE = '23514';
  END IF;

  SELECT p."full_name", p."role_key" INTO v_nome, v_era
  FROM public.profiles p WHERE p."id" = p_profile_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Usuário não encontrado.' USING ERRCODE = 'P0002';
  END IF;

  IF v_era = p_role_key THEN
    RETURN; -- idempotente
  END IF;

  -- Cinto de segurança: hoje inalcançável (a guarda de auto-alteração já
  -- barra), mas sobrevive a uma mudança futura de policy.
  SELECT rm."can_write" INTO v_vai_ter
  FROM public.role_modules rm
  WHERE rm."role_key" = p_role_key AND rm."module_key" = 'settings';

  IF NOT coalesce(v_vai_ter, false) AND private.other_active_owners(p_profile_id) = 0 THEN
    RAISE EXCEPTION
      '% é o único responsável ativo. Promova outra pessoa antes de rebaixá-lo.', v_nome
      USING ERRCODE = '23514';
  END IF;

  UPDATE public.profiles SET "role_key" = p_role_key WHERE "id" = p_profile_id;
END;
$$;

COMMENT ON FUNCTION "public"."set_profile_role"(uuid, text) IS
  'Troca o papel de acesso. Recusa auto-alteração e rebaixamento do último responsável ativo.';

REVOKE ALL ON FUNCTION "public"."set_profile_role"(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."set_profile_role"(uuid, text) TO "authenticated";


-- ---------------------------------------------------------------------
-- Ativar / desativar acesso
-- ---------------------------------------------------------------------
-- Não toca `auth.users`: o desativado ainda consegue autenticar, mas
-- `carregarPerfil` derruba a sessão e `can_read`/`can_write`/
-- `current_role_key` filtram `is_active`, então a RLS nega tudo mesmo com
-- JWT válido. Reversível, que é o que se quer de um desligamento.
CREATE OR REPLACE FUNCTION "public"."set_profile_active"(
  "p_profile_id" uuid,
  "p_active"     boolean
)
    RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_nome  text;
  v_atual boolean;
BEGIN
  IF NOT public.is_owner() THEN
    RAISE EXCEPTION 'Somente o responsável pode ativar ou desativar acessos.' USING ERRCODE = '42501';
  END IF;

  IF p_profile_id = auth.uid() AND NOT p_active THEN
    RAISE EXCEPTION 'Você não pode desativar o próprio acesso.' USING ERRCODE = '42501';
  END IF;

  SELECT p."full_name", p."is_active" INTO v_nome, v_atual
  FROM public.profiles p WHERE p."id" = p_profile_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Usuário não encontrado.' USING ERRCODE = 'P0002';
  END IF;

  IF v_atual = p_active THEN
    RETURN; -- idempotente
  END IF;

  IF NOT p_active AND private.other_active_owners(p_profile_id) = 0 THEN
    RAISE EXCEPTION
      '% é o único responsável ativo: desativá-lo deixaria o sistema sem administrador.', v_nome
      USING ERRCODE = '23514';
  END IF;

  UPDATE public.profiles SET "is_active" = p_active WHERE "id" = p_profile_id;
END;
$$;

COMMENT ON FUNCTION "public"."set_profile_active"(uuid, boolean) IS
  'Ativa/desativa o acesso. Recusa auto-desativação e a desativação do último responsável ativo.';

REVOKE ALL ON FUNCTION "public"."set_profile_active"(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."set_profile_active"(uuid, boolean) TO "authenticated";


-- ---------------------------------------------------------------------
-- Correção de dado: Sandra não executa serviço
-- ---------------------------------------------------------------------
-- Sandra é do Financeiro — o papel `finance` sequer tem o módulo
-- `production`. Com `can_execute = true` ela entrava em `EXECUTORES`,
-- aparecia como responsável no seletor da Produção, no filtro de
-- Comandas e no badge "Executa serviço" da tela de Equipe. O seed_demo
-- ainda sorteia executores `WHERE can_execute`, então ela chegou a
-- receber comandas de produção atribuídas.
--
-- ⚠️ A correção precisa dos DOIS lugares. `seed_prod.sql` tem
-- `ON CONFLICT ... DO UPDATE SET can_execute = EXCLUDED.can_execute` e
-- `reset-to-prod.sh` roda o seed DEPOIS das migrations: corrigir só aqui
-- faria o próximo reset reintroduzir o bug. O literal também foi
-- corrigido no seed, no mesmo commit.
--
-- Estreito e idempotente: não redefine estrutura, repara um valor que uma
-- migration anterior deveria ter gravado certo.
UPDATE "public"."staff"
SET "can_execute" = false
WHERE lower(btrim("name")) = 'sandra'
  AND "job_title" = 'Financeiro'
  AND "deleted_at" IS NULL
  AND "can_execute";

NOTIFY pgrst, 'reload schema';
