-- =====================================================================
-- reset_to_prod.sql — zera os dados, PRESERVA o schema
-- ---------------------------------------------------------------------
-- Este é o arquivo que transforma "sistema testado com dados de demo" em
-- "sistema pronto para a primeira comanda real".
--
-- APAGA: clientes, serviços, comandas, fotos, pagamentos, eventos,
--        lançamentos, auditoria, logins de demonstração, binários do
--        bucket order-photos.
-- MANTÉM: schema, migrations, papéis, módulos, matriz de permissões,
--         tabelas de domínio, equipe, integrações e o usuário admin.
--
-- NENHUM comando DDL. Nada de DROP, ALTER ou CREATE de tabela.
-- Executado por scripts/reset-to-prod.sh, que exige confirmação.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. Dados de operação
-- ---------------------------------------------------------------------
-- TRUNCATE (não DELETE) por dois motivos: contorna os triggers
-- append-only de order_events/order_payments/audit_logs, que impedem
-- DELETE por linha, e resolve a ordem das FKs com CASCADE.
TRUNCATE TABLE
  "public"."order_events",
  "public"."order_payments",
  "public"."order_photos",
  "public"."ledger_entries",
  "public"."orders",
  "public"."customers",
  "public"."services"
CASCADE;

-- ---------------------------------------------------------------------
-- 2. Binários órfãos no Storage
-- ---------------------------------------------------------------------
-- O TRUNCATE acima não dispara o trigger de limpeza (que é FOR EACH ROW
-- em DELETE), então o bucket é limpo explicitamente. Sem isto, as fotos
-- da demonstração continuariam ocupando disco para sempre.
--
-- ⚠️ NO SUPABASE CLOUD ISTO É BLOQUEADO.
--
-- A instância hospedada tem uma trigger `storage.protect_delete()` que
-- recusa DELETE direto em storage.objects:
--
--   42501: Direct deletion from storage tables is not allowed.
--          Use the Storage API instead.
--
-- E como o arquivo inteiro roda em uma transação, o erro abortava o
-- reset TODO — o banco ficava intacto e o operador via só a mensagem do
-- storage, sem relação óbvia com o que ele pediu.
--
-- Aqui a falha é capturada e o reset segue. Quem apaga os binários de
-- verdade é a camada de script (scripts/reset-to-prod.sh), pela Storage
-- API. O metadado já foi embora com o TRUNCATE das tabelas de negócio.
--
-- ⚠️ E A ORDEM IMPORTA: LIMPAR O BUCKET **ANTES** DE RODAR ESTE ARQUIVO.
--
-- `order_photos_storage_delete` só autoriza apagar foto cujo primeiro
-- segmento do caminho é uma comanda VIVA. Depois do TRUNCATE não existe
-- mais comanda nenhuma, então a policy nega o DELETE de todas as fotos —
-- e elas viram binário órfão que nem o responsável remove pela aplicação.
-- Medido na nuvem: HTTP 400 com a sessão do owner, 200 só com a service
-- key, que ignora a RLS.
DO $$
BEGIN
  DELETE FROM "storage"."objects" WHERE "bucket_id" = 'order-photos';
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE
      'Storage protegido (nuvem): os binários de order-photos precisam ser apagados pela Storage API.';
END $$;

-- ---------------------------------------------------------------------
-- 3. Logins de demonstração
-- ---------------------------------------------------------------------
-- Só os @demo.chaveiroformiga.com.br. O admin real é preservado.
-- profiles tem FK ON DELETE CASCADE para auth.users.
DELETE FROM "auth"."users"
WHERE "email" LIKE '%@demo.chaveiroformiga.com.br';

-- ---------------------------------------------------------------------
-- 4. Numeração de comandas volta ao início
-- ---------------------------------------------------------------------
-- A demo terminou em CF-1324; a operação real começa em CF-0001.
UPDATE "public"."app_settings" SET "order_next_number" = 1 WHERE "id";

-- ---------------------------------------------------------------------
-- 5. Integrações desabilitadas
-- ---------------------------------------------------------------------
-- Nada dispara mensagem para cliente real antes de o responsável
-- configurar e habilitar na tela de integrações.
UPDATE "public"."integrations"
SET "enabled" = false, "last_status" = NULL, "last_error" = NULL, "last_checked_at" = NULL;

-- ---------------------------------------------------------------------
-- 6. Trilha de auditoria — POR ÚLTIMO
-- ---------------------------------------------------------------------
-- A auditoria de produção precisa começar limpa: manter as ~500 linhas do
-- seed de demo tornaria a trilha inútil no primeiro mês.
--
-- A ORDEM IMPORTA. Os passos 3-5 acima são eles mesmos auditados (o
-- DELETE em profiles via cascade, o UPDATE em integrations); truncar
-- antes deixaria justamente essas linhas para trás. Truncando depois, a
-- tabela fica realmente vazia.
TRUNCATE TABLE "public"."audit_logs";

COMMIT;


-- ---------------------------------------------------------------------
-- Verificação: o banco tem que estar vazio de operação e íntegro de configuração
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_orders    integer;
  v_customers integer;
  v_services  integer;
  v_ledger    integer;
  v_photos    integer;
  v_audit     integer;
  v_demo      integer;
  v_roles     integer;
  v_perms     integer;
  v_staff     integer;
  v_admins    integer;
  v_next      integer;
BEGIN
  SELECT count(*) INTO v_orders    FROM public.orders;
  SELECT count(*) INTO v_customers FROM public.customers;
  SELECT count(*) INTO v_services  FROM public.services;
  SELECT count(*) INTO v_ledger    FROM public.ledger_entries;
  SELECT count(*) INTO v_photos    FROM storage.objects WHERE "bucket_id" = 'order-photos';
  SELECT count(*) INTO v_audit     FROM public.audit_logs;
  SELECT count(*) INTO v_demo      FROM auth.users WHERE "email" LIKE '%@demo.chaveiroformiga.com.br';
  SELECT count(*) INTO v_roles     FROM public.roles;
  SELECT count(*) INTO v_perms     FROM public.role_modules;
  SELECT count(*) INTO v_staff     FROM public.staff WHERE "deleted_at" IS NULL;
  SELECT count(*) INTO v_admins    FROM public.profiles WHERE "role_key" = 'owner' AND "is_active";
  SELECT "order_next_number" INTO v_next FROM public.app_settings;

  RAISE NOTICE '--- reset para produção ---';
  RAISE NOTICE 'zerado   → comandas: %  clientes: %  serviços: %  lançamentos: %  fotos: %  auditoria: %  logins demo: %',
    v_orders, v_customers, v_services, v_ledger, v_photos, v_audit, v_demo;
  RAISE NOTICE 'mantido  → papéis: %  permissões: %  equipe: %  admins ativos: %  próxima comanda: %',
    v_roles, v_perms, v_staff, v_admins, v_next;

  IF v_orders + v_customers + v_services + v_ledger + v_photos + v_audit + v_demo > 0 THEN
    RAISE EXCEPTION 'Reset incompleto: ainda existem dados de demonstração.';
  END IF;

  IF v_roles = 0 OR v_perms = 0 OR v_staff = 0 THEN
    RAISE EXCEPTION 'Reset destruiu configuração: rode seed_prod.sql.';
  END IF;

  -- Aviso, não erro: este arquivo só ZERA dados. Quem garante o admin é o
  -- seed_prod, reaplicado logo depois por scripts/reset-to-prod.sh — que
  -- então falha de verdade se ainda não houver administrador ativo.
  IF v_admins = 0 THEN
    RAISE WARNING 'Nenhum administrador ativo. Reaplique seeds/seed_prod.sql (ou rode scripts/bootstrap-users.sh).';
  END IF;

  IF v_next <> 1 THEN
    RAISE EXCEPTION 'Numeração não voltou para 1 (está em %).', v_next;
  END IF;

  RAISE NOTICE 'OK: banco pronto para a primeira comanda real.';
END
$$;
