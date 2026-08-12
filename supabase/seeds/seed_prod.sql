-- =====================================================================
-- seed_prod.sql — o mínimo para a loja começar do zero
-- ---------------------------------------------------------------------
-- Contém APENAS:
--   • papéis, módulos e a matriz de permissões
--   • tabelas de domínio (status, categorias, formas de pagamento)
--   • equipe da loja
--   • configuração da empresa
--   • registro (desabilitado) das integrações mapeadas no front
--   • UM usuário administrador inicial
--
-- NÃO contém nenhum cliente, serviço, comanda ou lançamento.
--
-- IDEMPOTENTE: pode rodar quantas vezes quiser. É executado tanto no
-- bootstrap quanto pelo scripts/reset-to-prod.sh.
--
-- Credenciais do admin (opcional, via PGOPTIONS):
--   PGOPTIONS="-c seed.admin_email=x@y.com -c seed.admin_password=..." psql -f seed_prod.sql
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- Papéis  ← PERFIS (src/lib/constants.ts:98)
-- ---------------------------------------------------------------------
INSERT INTO "public"."roles" ("key", "label", "description", "sort_order", "is_readonly") VALUES
  ('owner',      'Responsável', 'Acesso total, incluindo configurações e integrações', 1, false),
  ('attendant',  'Atendimento', 'Balcão: recebe itens, abre comandas e cadastra clientes', 2, false),
  ('production', 'Produção',    'Bancada: executa serviços e move o Kanban',              3, false),
  ('finance',    'Financeiro',  'Recebimentos, pendências e despesas',                    4, false),
  ('viewer',     'Consulta',    'Somente leitura — não altera nenhum dado',               5, true)
ON CONFLICT ("key") DO UPDATE
SET "label"       = EXCLUDED."label",
    "description" = EXCLUDED."description",
    "sort_order"  = EXCLUDED."sort_order",
    "is_readonly" = EXCLUDED."is_readonly";


-- ---------------------------------------------------------------------
-- Módulos  ← NAV (src/components/Layout.tsx:41)
-- ---------------------------------------------------------------------
INSERT INTO "public"."modules" ("key", "label", "route", "nav_group", "sort_order") VALUES
  ('dashboard',    'Dashboard',      '/dashboard',     'overview',   1),
  ('service_desk', 'Atendimento',    '/atendimento',   'operation',  2),
  ('customers',    'Clientes',       '/clientes',      'operation',  3),
  ('orders',       'Comandas',       '/comandas',      'operation',  4),
  ('services',     'Serviços',       '/servicos',      'operation',  5),
  ('production',   'Produção',       '/producao',      'operation',  6),
  ('labels',       'Etiquetas',      '/etiquetas',     'management', 7),
  ('finance',      'Financeiro',     '/financeiro',    'management', 8),
  ('reports',      'Relatórios',     '/relatorios',    'management', 9),
  ('settings',     'Configurações',  '/configuracoes', 'management', 10)
ON CONFLICT ("key") DO UPDATE
SET "label"      = EXCLUDED."label",
    "route"      = EXCLUDED."route",
    "nav_group"  = EXCLUDED."nav_group",
    "sort_order" = EXCLUDED."sort_order";


-- ---------------------------------------------------------------------
-- Matriz de permissões  ← docs/01-analise-frontend.md §5
-- ---------------------------------------------------------------------
-- Recriada a cada execução: a matriz é declarativa, não incremental.
DELETE FROM "public"."role_modules";

INSERT INTO "public"."role_modules" ("role_key", "module_key", "can_read", "can_write") VALUES
  -- owner: tudo. `reports` é leitura por natureza (é um relatório).
  ('owner', 'dashboard',    true, false),
  ('owner', 'service_desk', true, true),
  ('owner', 'customers',    true, true),
  ('owner', 'orders',       true, true),
  ('owner', 'services',     true, true),
  ('owner', 'production',   true, true),
  ('owner', 'labels',       true, true),
  ('owner', 'finance',      true, true),
  ('owner', 'reports',      true, false),
  ('owner', 'settings',     true, true),

  -- attendant (Camila): balcão
  ('attendant', 'dashboard',    true, false),
  ('attendant', 'service_desk', true, true),
  ('attendant', 'customers',    true, true),
  ('attendant', 'orders',       true, true),
  ('attendant', 'production',   true, true),
  ('attendant', 'labels',       true, true),

  -- production (Diego): bancada
  ('production', 'dashboard',  true, false),
  ('production', 'orders',     true, true),
  ('production', 'production', true, true),
  ('production', 'services',   true, true),
  ('production', 'labels',     true, true),

  -- finance (Sandra): dinheiro. `orders` só leitura (ambiguidade A3) —
  -- ela registra pagamento, que é escrita em order_payments.
  ('finance', 'dashboard', true, false),
  ('finance', 'customers', true, true),
  ('finance', 'orders',    true, false),
  ('finance', 'finance',   true, true),
  ('finance', 'reports',   true, false),

  -- viewer (Visitante): leitura pura. roles.is_readonly já barra escrita,
  -- mas can_write=false deixa a intenção explícita na matriz.
  ('viewer', 'dashboard',  true, false),
  ('viewer', 'orders',     true, false),
  ('viewer', 'production', true, false),
  ('viewer', 'reports',    true, false);


-- ---------------------------------------------------------------------
-- Categorias de serviço  ← CATEGORIAS (constants.ts:10)
-- ---------------------------------------------------------------------
INSERT INTO "public"."service_categories" ("key", "label", "icon", "color", "bg_color", "sort_order") VALUES
  ('chaveiro',  'Chaveiro',  'KeyRound',   '#A5710E', '#FDF7E9', 1),
  ('sapataria', 'Sapataria', 'Footprints', '#1B4A37', '#EDF5F1', 2),
  ('costura',   'Costura',   'Scissors',   '#5B4CB8', '#F0EEFB', 3),
  ('ajuste',    'Ajuste',    'Ruler',      '#2563EB', '#EFF6FF', 4),
  ('reparo',    'Reparo',    'Wrench',     '#B45309', '#FEF6EB', 5),
  ('outro',     'Outro',     'Package',    '#4B525C', '#F5F6F8', 6)
ON CONFLICT ("key") DO UPDATE
SET "label" = EXCLUDED."label", "icon" = EXCLUDED."icon",
    "color" = EXCLUDED."color", "bg_color" = EXCLUDED."bg_color",
    "sort_order" = EXCLUDED."sort_order";


-- ---------------------------------------------------------------------
-- Status de comanda  ← STATUS (constants.ts:29) + statusTexto (useApp.ts:404)
-- sort_order = ordem das colunas do Kanban (KANBAN_COLS, constants.ts:43)
-- ---------------------------------------------------------------------
INSERT INTO "public"."order_statuses"
  ("key", "label", "description", "color", "bg_color", "border_color", "in_kanban", "is_open", "is_final", "sort_order")
VALUES
  ('recebida',  'Recebida',              'Comanda recebida no balcão',        '#1D4ED8', '#EFF6FF', '#BFDBFE', true,  true,  false, 1),
  ('analise',   'Em análise',            'Serviço em análise técnica',        '#5B4CB8', '#F0EEFB', '#D9D3F5', true,  true,  false, 2),
  ('aprovacao', 'Aguardando aprovação',  'Aguardando aprovação do cliente',   '#A5710E', '#FDF7E9', '#F2D68C', true,  true,  false, 3),
  ('execucao',  'Em execução',           'Serviço entrou em execução',        '#5B4CB8', '#F0EEFB', '#D9D3F5', true,  true,  false, 4),
  ('material',  'Aguardando material',   'Aguardando chegada de material',    '#A5710E', '#FDF7E9', '#F2D68C', true,  true,  false, 5),
  ('pronta',    'Pronta',                'Serviço pronto para retirada',      '#1B4A37', '#EDF5F1', '#C0DED0', true,  true,  false, 6),
  ('avisado',   'Cliente avisado',       'Cliente avisado da retirada',       '#256349', '#EDF5F1', '#C0DED0', true,  true,  false, 7),
  ('entregue',  'Entregue',              'Serviço entregue ao cliente',       '#123527', '#E4EFE9', '#B4D3C3', true,  false, true,  8),
  ('pausada',   'Pausada',               'Serviço pausado',                   '#4B525C', '#F5F6F8', '#E6E9ED', false, true,  false, 9),
  ('cancelada', 'Cancelada',             'Comanda cancelada',                 '#6B7280', '#F5F6F8', '#E6E9ED', false, false, true,  10)
ON CONFLICT ("key") DO UPDATE
SET "label" = EXCLUDED."label", "description" = EXCLUDED."description",
    "color" = EXCLUDED."color", "bg_color" = EXCLUDED."bg_color",
    "border_color" = EXCLUDED."border_color", "in_kanban" = EXCLUDED."in_kanban",
    "is_open" = EXCLUDED."is_open", "is_final" = EXCLUDED."is_final",
    "sort_order" = EXCLUDED."sort_order";


-- ---------------------------------------------------------------------
-- Status de cliente  ← CLIENTE_STATUS (constants.ts:68)
-- ---------------------------------------------------------------------
INSERT INTO "public"."customer_statuses" ("key", "label", "color", "bg_color", "is_derived", "sort_order") VALUES
  ('novo',       'Novo',           '#1D4ED8', '#EFF6FF', true,  1),
  ('ativo',      'Ativo',          '#1B4A37', '#EDF5F1', true,  2),
  ('recorrente', 'Recorrente',     '#A5710E', '#FDF7E9', true,  3),
  ('pendencia',  'Com pendência',  '#B4413D', '#FDEEED', true,  4),
  ('inativo',    'Inativo',        '#6B7280', '#F5F6F8', true,  5),
  -- Único status manual: o recálculo nunca sobrescreve (regra 27).
  ('bloqueado',  'Bloqueado',      '#4B525C', '#E6E9ED', false, 6)
ON CONFLICT ("key") DO UPDATE
SET "label" = EXCLUDED."label", "color" = EXCLUDED."color",
    "bg_color" = EXCLUDED."bg_color", "is_derived" = EXCLUDED."is_derived",
    "sort_order" = EXCLUDED."sort_order";


-- ---------------------------------------------------------------------
-- Formas de pagamento  ← FORMAS (constants.ts:87) + CORES_FORMA (Financeiro.tsx:52)
-- ---------------------------------------------------------------------
INSERT INTO "public"."payment_methods" ("key", "label", "icon", "color", "sort_order") VALUES
  ('pix',           'PIX',            'QrCode',          '#2F7D5F', 1),
  ('dinheiro',      'Dinheiro',       'Banknote',        '#DFA92A', 2),
  ('cartao',        'Cartão',         'CreditCard',      '#5B4CB8', 3),
  ('transferencia', 'Transferência',  'ArrowLeftRight',  '#2563EB', 4)
ON CONFLICT ("key") DO UPDATE
SET "label" = EXCLUDED."label", "icon" = EXCLUDED."icon",
    "color" = EXCLUDED."color", "sort_order" = EXCLUDED."sort_order";


-- ---------------------------------------------------------------------
-- Status de lançamento  ← LANCAMENTO_STATUS (constants.ts:77)
-- A classificação counts_as_* é o que metricas.ts calcula hoje com
-- ['recebido','pago'].includes(...) e ['pendente','parcial','vencido'].
-- ---------------------------------------------------------------------
INSERT INTO "public"."ledger_statuses"
  ("key", "label", "color", "bg_color", "counts_as_received", "counts_as_open", "is_final", "sort_order")
VALUES
  ('previsto',  'Previsto',  '#1D4ED8', '#EFF6FF', false, false, false, 1),
  ('pendente',  'Pendente',  '#A5710E', '#FDF7E9', false, true,  false, 2),
  ('parcial',   'Parcial',   '#A5710E', '#FDF7E9', false, true,  false, 3),
  ('vencido',   'Vencido',   '#B4413D', '#FDEEED', false, true,  false, 4),
  ('recebido',  'Recebido',  '#1B4A37', '#EDF5F1', true,  false, true,  5),
  ('pago',      'Pago',      '#1B4A37', '#EDF5F1', true,  false, true,  6),
  ('cancelado', 'Cancelado', '#6B7280', '#F5F6F8', false, false, true,  7)
ON CONFLICT ("key") DO UPDATE
SET "label" = EXCLUDED."label", "color" = EXCLUDED."color",
    "bg_color" = EXCLUDED."bg_color",
    "counts_as_received" = EXCLUDED."counts_as_received",
    "counts_as_open" = EXCLUDED."counts_as_open",
    "is_final" = EXCLUDED."is_final", "sort_order" = EXCLUDED."sort_order";


-- ---------------------------------------------------------------------
-- Tipos de foto  ← TIPOS / LEGENDA_PADRAO (Fotos.tsx:8)
-- ---------------------------------------------------------------------
INSERT INTO "public"."photo_kinds" ("key", "label", "default_caption", "sort_order") VALUES
  ('antes',   'Antes',   'Item recebido',        1),
  ('detalhe', 'Detalhe', 'Detalhe do serviço',   2),
  ('depois',  'Depois',  'Serviço concluído',    3)
ON CONFLICT ("key") DO UPDATE
SET "label" = EXCLUDED."label", "default_caption" = EXCLUDED."default_caption",
    "sort_order" = EXCLUDED."sort_order";


-- ---------------------------------------------------------------------
-- Categorias de lançamento  ← CAT_ENTRADA / CAT_SAIDA (constants.ts:147)
-- ---------------------------------------------------------------------
-- auto_for_service_category liga a categoria de receita à categoria do
-- serviço (ambiguidade A4). ajuste/reparo/outro ficam sem mapa e caem no
-- fallback "Outros recebimentos" dentro de create_order.
INSERT INTO "public"."ledger_categories"
  ("name", "kind", "auto_for_service_category", "is_system", "sort_order")
VALUES
  ('Serviço de chaveiro',   'income',  'chaveiro',  false, 1),
  ('Serviço de sapataria',  'income',  'sapataria', false, 2),
  ('Serviço de costura',    'income',  'costura',   false, 3),
  ('Entrada de comanda',    'income',  NULL,        true,  4),
  ('Saldo final',           'income',  NULL,        true,  5),
  ('Outros recebimentos',   'income',  NULL,        true,  6),
  ('Material',              'expense', NULL,        false, 7),
  ('Ferramenta',            'expense', NULL,        false, 8),
  ('Manutenção',            'expense', NULL,        false, 9),
  ('Despesa operacional',   'expense', NULL,        false, 10),
  ('Outros custos',         'expense', NULL,        false, 11)
ON CONFLICT (lower(btrim("name"))) WHERE "deleted_at" IS NULL DO UPDATE
SET "kind" = EXCLUDED."kind",
    "auto_for_service_category" = EXCLUDED."auto_for_service_category",
    "is_system" = EXCLUDED."is_system",
    "sort_order" = EXCLUDED."sort_order",
    "active" = true,
    "deleted_at" = NULL;


-- ---------------------------------------------------------------------
-- Equipe  ← RESPONSAVEIS (constants.ts:96) + PERFIS (constants.ts:98)
-- Ambiguidade A1: as duas listas são diferentes; `staff` é a união.
-- ---------------------------------------------------------------------
INSERT INTO "public"."staff" ("name", "initials", "job_title", "can_execute", "sort_order") VALUES
  ('Wallace', 'W', 'Responsável', true,  1),
  -- Camila é do balcão: abre comandas, não executa serviço.
  ('Camila',  'C', 'Atendimento', false, 2),
  ('Diego',   'D', 'Produção',    true,  3),
  ('Marcelo', 'M', 'Sapataria',   true,  4),
  ('Rita',    'R', 'Costura',     true,  5),
  -- Sandra é do financeiro: recebe pagamento, não executa serviço. O papel
  -- `finance` nem tem o módulo `production`. Com `true` ela aparecia como
  -- responsável no Kanban e chegava a receber comandas no seed_demo.
  ('Sandra',  'S', 'Financeiro',  false, 6)
ON CONFLICT (lower(btrim("name"))) WHERE "deleted_at" IS NULL DO UPDATE
SET "initials" = EXCLUDED."initials", "job_title" = EXCLUDED."job_title",
    "can_execute" = EXCLUDED."can_execute", "sort_order" = EXCLUDED."sort_order",
    "active" = true;


-- ---------------------------------------------------------------------
-- Configuração da empresa  ← buildConfig() (src/data/seed.ts:502)
-- ---------------------------------------------------------------------
-- order_next_number = 1: a operação real começa da comanda CF-0001.
INSERT INTO "public"."app_settings" (
  "id",
  "company_name", "company_phone", "company_address", "company_hours", "company_owner",
  "order_prefix", "order_next_number", "order_show_notes", "order_show_photo", "order_footer_text",
  "label_default_size", "labels_per_sheet", "label_show_qr", "label_show_staff"
)
VALUES (
  true,
  'Chaveiro Formiga',
  '(37) 3321-4455',
  'Rua Barão de Piumhi, 340 — Centro, Formiga/MG',
  'Seg a Sex 08:00–18:00 · Sáb 08:00–12:00',
  'Wallace',
  'CF', 1, true, true,
  'A retirada deve ser feita em até 90 dias. Guarde esta via.',
  'media', 12, true, true
)
ON CONFLICT ("id") DO UPDATE
SET "company_name"       = EXCLUDED."company_name",
    "company_phone"      = EXCLUDED."company_phone",
    "company_address"    = EXCLUDED."company_address",
    "company_hours"      = EXCLUDED."company_hours",
    "company_owner"      = EXCLUDED."company_owner",
    "order_prefix"       = EXCLUDED."order_prefix",
    "order_next_number"  = EXCLUDED."order_next_number",
    "order_show_notes"   = EXCLUDED."order_show_notes",
    "order_show_photo"   = EXCLUDED."order_show_photo",
    "order_footer_text"  = EXCLUDED."order_footer_text",
    "label_default_size" = EXCLUDED."label_default_size",
    "labels_per_sheet"   = EXCLUDED."labels_per_sheet",
    "label_show_qr"      = EXCLUDED."label_show_qr",
    "label_show_staff"   = EXCLUDED."label_show_staff";


-- ---------------------------------------------------------------------
-- Integrações  ← docs/01-analise-frontend.md §8
-- ---------------------------------------------------------------------
-- Registradas DESABILITADAS, sem provedor e sem segredo. O front lê
-- `integration_status` e mostra o botão desabilitado, com o motivo no
-- tooltip, enquanto não houver provedor configurado.
--
-- Só entram aqui integrações com TERCEIRO. O que o navegador resolve
-- sozinho (CSV, PDF) não é integração e não deve aparecer nesta tela.
INSERT INTO "public"."integrations" ("key", "name", "kind", "description", "config", "enabled") VALUES
  ('whatsapp_notify',   'WhatsApp — avisar cliente',        'messaging',
   'Mensagem automática quando o serviço fica pronto para retirada.',
   '{"template": "Olá {{cliente}}, seu serviço {{comanda}} está pronto para retirada."}'::jsonb, false),

  ('whatsapp_receipt',  'WhatsApp — enviar comprovante',    'messaging',
   'Envio do comprovante de pagamento ao cliente.',
   '{"template": "Recebemos {{valor}} referente à comanda {{comanda}}. Obrigado!"}'::jsonb, false),

  ('whatsapp_order',    'WhatsApp — compartilhar comanda',  'messaging',
   'Envio da via da comanda ao cliente no momento do recebimento.',
   '{}'::jsonb, false),

  -- `data_export` e `order_pdf` NÃO entram aqui: exportação em CSV e PDF
  -- rodam no cliente (src/lib/exportar.ts e a caixa de impressão), sem
  -- provedor e sem segredo. `integrations` é só para serviço externo.
  ('report_share',      'Compartilhar relatório por link',  'export',
   'Link temporário para o relatório gerado.',
   '{"expires_in_hours": 72}'::jsonb, false)
ON CONFLICT ("key") DO UPDATE
SET "name"        = EXCLUDED."name",
    "kind"        = EXCLUDED."kind",
    "description" = EXCLUDED."description";


-- ---------------------------------------------------------------------
-- Bucket de fotos
-- ---------------------------------------------------------------------
-- Reaplica os limites: na primeira subida, a migration de Storage roda
-- antes de o storage-api adicionar as colunas `public`/`file_size_limit`.
SELECT "public"."ensure_order_photos_bucket"();


-- ---------------------------------------------------------------------
-- Usuário administrador inicial
-- ---------------------------------------------------------------------
-- Único login criado pelo seed de produção. Os demais são criados pelo
-- responsável em Configurações (ou via Supabase Studio).
--
-- Credenciais por PGOPTIONS:
--   PGOPTIONS="-c seed.admin_email=... -c seed.admin_password=..."
--
-- A criação passa por private.create_auth_user(), que se adapta à versão
-- do schema `auth`. Em volume novo do docker compose o GoTrue ainda não
-- migrou o schema — nesse caso a função avisa e não cria nada, e
-- scripts/bootstrap-users.sh assume pela Admin API.
DO $$
DECLARE
  v_email text := coalesce(NULLIF(current_setting('seed.admin_email', true), ''),
                           'wallace@chaveiroformiga.com.br');
  v_pass  text := coalesce(NULLIF(current_setting('seed.admin_password', true), ''),
                           'ChaveiroFormiga@2026');
  v_uid   uuid;
BEGIN
  v_uid := private.create_auth_user(v_email, v_pass, 'Wallace', 'owner', 'Wallace');

  IF v_uid IS NULL THEN
    RAISE NOTICE 'Admin será criado pela Admin API (scripts/bootstrap-users.sh).';
  ELSE
    RAISE NOTICE 'Admin pronto: % — TROQUE A SENHA NO PRIMEIRO ACESSO.', v_email;
  END IF;
END
$$;

COMMIT;

-- ---------------------------------------------------------------------
-- Conferência
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_customers integer;
  v_orders    integer;
  v_ledger    integer;
  v_services  integer;
BEGIN
  SELECT count(*) INTO v_customers FROM public.customers      WHERE "deleted_at" IS NULL;
  SELECT count(*) INTO v_orders    FROM public.orders         WHERE "deleted_at" IS NULL;
  SELECT count(*) INTO v_ledger    FROM public.ledger_entries WHERE "deleted_at" IS NULL;
  SELECT count(*) INTO v_services  FROM public.services       WHERE "deleted_at" IS NULL;

  RAISE NOTICE '--- seed_prod aplicado ---';
  RAISE NOTICE 'papéis: %  módulos: %  permissões: %',
    (SELECT count(*) FROM public.roles),
    (SELECT count(*) FROM public.modules),
    (SELECT count(*) FROM public.role_modules);
  RAISE NOTICE 'equipe: %  integrações: %',
    (SELECT count(*) FROM public.staff WHERE "deleted_at" IS NULL),
    (SELECT count(*) FROM public.integrations);
  RAISE NOTICE 'dados de operação — clientes: %  serviços: %  comandas: %  lançamentos: %',
    v_customers, v_services, v_orders, v_ledger;
  RAISE NOTICE 'próxima comanda: %-%',
    (SELECT "order_prefix" FROM public.app_settings),
    lpad((SELECT "order_next_number" FROM public.app_settings)::text, 4, '0');
END
$$;

-- ---------------------------------------------------------------------
-- Canais de aprovação de orçamento (migration 20260807140000)
-- ---------------------------------------------------------------------
-- A migration também insere: ela é o único caminho até um banco que já
-- roda. Aqui é para o banco novo. ON CONFLICT deixa os dois inofensivos.
DO $canais$
BEGIN
  IF to_regclass('public.approval_channels') IS NOT NULL THEN
    INSERT INTO public.approval_channels ("key", "label", "sort_order") VALUES
      ('presencial', 'Presencial', 1),
      ('telefone',   'Telefone',   2),
      ('whatsapp',   'WhatsApp',   3),
      ('email',      'E-mail',     4)
    ON CONFLICT ("key") DO NOTHING;
  END IF;
END
$canais$;

-- ---------------------------------------------------------------------
-- Itens das comandas (migration 20260807100000)
-- ---------------------------------------------------------------------
-- O db-init aplica migrations ANTES dos seeds, então o backfill de lá
-- roda com o banco vazio. É aqui que as comandas recém-semeadas ganham
-- seu item. Idempotente: só cria para comanda que ainda não tem nenhum.
DO $backfill$
BEGIN
  IF to_regprocedure('public.backfill_order_items()') IS NOT NULL THEN
    RAISE NOTICE 'itens de comanda criados: %', public.backfill_order_items();
  END IF;
  -- Mesma razao (migrations antes dos seeds): sem isto as comandas
  -- semeadas em `pronta` nasceriam sem ready_at e nunca entrariam no
  -- alerta de peca nao retirada. Migration 20260811100000.
  IF to_regprocedure('public.backfill_ready_at()') IS NOT NULL THEN
    RAISE NOTICE 'pecas com data de prateleira: %', public.backfill_ready_at();
  END IF;
END
$backfill$;
