-- =====================================================================
-- seed_demo.sql — dados de demonstração
-- ---------------------------------------------------------------------
-- Porte do buildDataset() (src/data/seed.ts:563), que era gerado em
-- runtime no navegador. Volumes idênticos:
--   35 serviços · 80 clientes · 120 comandas · ~250 lançamentos
--   + 1 usuário de teste POR PAPEL (5 logins)
--
-- Determinístico: usa setseed(), então o mesmo dataset sai em qualquer
-- máquina. Sem isso, "funciona no meu ambiente" seria literal.
--
-- PRÉ-REQUISITO: seed_prod.sql já aplicado (papéis, domínio, equipe).
-- Este arquivo NUNCA vai para produção — o reset o remove por completo.
-- =====================================================================

BEGIN;

-- Marca as comandas de demonstração para o reset saber o que apagar.
-- (Todas as linhas criadas aqui têm created_by = NULL ou um dos usuários
--  @demo.chaveiroformiga.com.br — ver scripts/reset-to-prod.sh.)

-- ---------------------------------------------------------------------
-- 1. Usuários de teste — um por papel
-- ---------------------------------------------------------------------
-- Senha única para toda a demo: demo1234
-- (o Login antigo já sugeria "demo1234", src/pages/Login.tsx:16)
-- Em volume novo do docker compose o schema `auth` ainda é o stub, então
-- private.create_auth_user() devolve NULL e scripts/bootstrap-users.sh
-- cria os logins pela Admin API. Os dados de negócio abaixo não dependem
-- disso — a demo carrega igual.
DO $$
DECLARE
  v_user  record;
  v_uid   uuid;
  v_ok    integer := 0;
  v_skip  integer := 0;
BEGIN
  FOR v_user IN
    SELECT * FROM (VALUES
      ('wallace@demo.chaveiroformiga.com.br',  'Wallace',   'owner',      'Wallace'),
      ('camila@demo.chaveiroformiga.com.br',   'Camila',    'attendant',  'Camila'),
      ('diego@demo.chaveiroformiga.com.br',    'Diego',     'production', 'Diego'),
      ('sandra@demo.chaveiroformiga.com.br',   'Sandra',    'finance',    'Sandra'),
      ('consulta@demo.chaveiroformiga.com.br', 'Visitante', 'viewer',     NULL)
    ) AS t("email", "name", "role", "staff_name")
  LOOP
    v_uid := private.create_auth_user(
      v_user."email", 'demo1234', v_user."name", v_user."role", v_user."staff_name"
    );

    IF v_uid IS NULL THEN
      v_skip := v_skip + 1;
    ELSE
      v_ok := v_ok + 1;
    END IF;
  END LOOP;

  IF v_skip > 0 THEN
    RAISE NOTICE '% login(s) de demo pendente(s) — rode scripts/bootstrap-users.sh.', v_skip;
  ELSE
    RAISE NOTICE '% login(s) de demonstração prontos.', v_ok;
  END IF;
END
$$;


-- ---------------------------------------------------------------------
-- 2. Catálogo de serviços (35)  ← CHAVEIRO/SAPATARIA/COSTURA (seed.ts:21-63)
-- ---------------------------------------------------------------------
INSERT INTO "public"."services"
  ("name", "category_key", "description", "base_price", "lead_time_days", "default_staff_id", "active")
SELECT
  s."name", s."cat", s."descr", s."price", s."days",
  (SELECT "id" FROM "public"."staff" WHERE "name" = s."staff" AND "deleted_at" IS NULL),
  s."active"
FROM (VALUES
  -- Chaveiro (15)
  ('Cópia de chave simples',      'chaveiro',  'Cópia imediata de chave comum de porta ou cadeado.',      12.00,  0, 'Wallace', true),
  ('Cópia de chave tetra',        'chaveiro',  'Cópia de chave tetra com fresagem de precisão.',          45.00,  1, 'Diego',   true),
  ('Chave codificada automotiva', 'chaveiro',  'Chave com transponder, codificação e teste no veículo.', 180.00,  2, 'Wallace', true),
  ('Chave canivete',              'chaveiro',  'Confecção de chave canivete com lâmina e controle.',     260.00,  3, 'Diego',   true),
  ('Cópia de controle de portão', 'chaveiro',  'Clonagem de controle remoto 433MHz.',                     75.00,  1, 'Wallace', true),
  ('Troca de segredo',            'chaveiro',  'Troca do segredo da fechadura mantendo o corpo.',         90.00,  1, 'Diego',   true),
  ('Abertura de porta',           'chaveiro',  'Abertura sem dano com técnica de impressão.',            130.00,  0, 'Wallace', true),
  ('Abertura de veículo',         'chaveiro',  'Abertura de porta automotiva sem dano à lataria.',       160.00,  0, 'Wallace', true),
  ('Abertura de cofre',           'chaveiro',  'Abertura técnica de cofre residencial.',                 320.00,  1, 'Diego',   true),
  ('Reparo de fechadura',         'chaveiro',  'Desmontagem, limpeza e substituição de peças internas.', 110.00,  2, 'Wallace', true),
  ('Troca de cilindro',           'chaveiro',  'Substituição completa do cilindro da fechadura.',         95.00,  1, 'Diego',   true),
  ('Instalação de fechadura',     'chaveiro',  'Instalação de fechadura nova com ajuste de batente.',    145.00,  2, 'Wallace', true),
  ('Fechadura digital',           'chaveiro',  'Instalação e configuração de fechadura eletrônica.',     480.00,  3, 'Diego',   true),
  ('Afiação de chave',            'chaveiro',  'Correção e afiação de chave com desgaste.',               25.00,  0, 'Wallace', true),
  ('Chave de mala e cadeado',     'chaveiro',  'Confecção de chave para malas, cadeados e armários.',     35.00,  1, 'Diego',   true),
  -- Sapataria (11)
  ('Colagem de sola',             'sapataria', 'Colagem profissional com adesivo de poliuretano.',        45.00,  2, 'Marcelo', true),
  ('Costura de sapato',           'sapataria', 'Costura reforçada em máquina de coluna.',                 60.00,  3, 'Marcelo', true),
  ('Troca de sola completa',      'sapataria', 'Substituição integral da sola com acabamento.',          130.00,  5, 'Marcelo', true),
  ('Troca de salto',              'sapataria', 'Troca de salto com alinhamento e capa nova.',             70.00,  3, 'Marcelo', true),
  ('Troca de capa de salto',      'sapataria', 'Substituição apenas da capa do salto.',                   30.00,  1, 'Marcelo', true),
  ('Meia sola',                   'sapataria', 'Aplicação de meia sola em couro ou borracha.',            85.00,  4, 'Marcelo', true),
  ('Ajuste de numeração',         'sapataria', 'Alargamento ou redução no molde.',                        55.00,  3, 'Marcelo', true),
  ('Pintura e tingimento',        'sapataria', 'Recuperação de cor com tinta específica para couro.',     90.00,  4, 'Marcelo', true),
  ('Limpeza e hidratação',        'sapataria', 'Limpeza profunda e hidratação do couro.',                 40.00,  2, 'Marcelo', true),
  ('Reparo de bota',              'sapataria', 'Reparo estrutural em bota de trabalho ou social.',       120.00,  5, 'Marcelo', true),
  ('Troca de zíper de bota',      'sapataria', 'Substituição do zíper lateral com costura.',              80.00,  4, 'Marcelo', true),
  -- Costura (9)
  ('Barra simples',               'costura',   'Barra em calça, saia ou vestido.',                        25.00,  2, 'Rita',    true),
  ('Barra original de jeans',     'costura',   'Barra mantendo o acabamento original da peça.',           40.00,  3, 'Rita',    true),
  ('Troca de zíper',              'costura',   'Substituição de zíper em calça, jaqueta ou vestido.',     45.00,  3, 'Rita',    true),
  ('Ajuste de cintura',           'costura',   'Redução ou alargamento de cintura.',                      55.00,  3, 'Rita',    true),
  ('Ajuste de manga',             'costura',   'Encurtar ou afinar mangas.',                              45.00,  3, 'Rita',    true),
  ('Ajuste de tamanho completo',  'costura',   'Ajuste de peça inteira ao corpo do cliente.',            120.00,  5, 'Rita',    true),
  -- Um arquivado, para a aba "Arquivados" da tela de Serviços ter conteúdo.
  ('Reforma de peça',             'costura',   'Remodelagem completa da peça.',                          160.00,  7, 'Rita',    false),
  ('Conserto de rasgo',           'costura',   'Cerzido ou remendo invisível.',                           35.00,  2, 'Rita',    true),
  ('Troca de forro',              'costura',   'Substituição do forro interno.',                         110.00,  6, 'Rita',    true)
) AS s("name", "cat", "descr", "price", "days", "staff", "active")
ON CONFLICT (lower(btrim("name"))) WHERE "deleted_at" IS NULL DO NOTHING;


-- ---------------------------------------------------------------------
-- 3. Clientes (80)  ← NOMES / CIDADES / OBS_CLIENTE (seed.ts:103-137)
-- ---------------------------------------------------------------------
SELECT setseed(0.4242);

INSERT INTO "public"."customers" ("name", "phone", "whatsapp", "email", "city", "notes", "created_at", "status_key")
SELECT
  n."name",
  -- DDD 37 (Formiga) com 15% de 35 (região de Divinópolis).
  CASE WHEN random() > 0.85 THEN '35' ELSE '37' END
    || '9' || lpad((10000000 + floor(random() * 89999999))::bigint::text, 8, '0'),
  '',
  -- 72% dos clientes têm e-mail (seed.ts:153).
  CASE WHEN random() > 0.28
       THEN lower(
              extensions.unaccent(split_part(n."name", ' ', 1)) || '.' ||
              extensions.unaccent(regexp_replace(n."name", '^.* ', '')) || '@email.com.br'
            )
       ELSE '' END,
  (ARRAY['Formiga','Formiga','Formiga','Córrego Fundo','Pains','Arcos','Pimenta','Divinópolis'])
    [1 + floor(random() * 8)::int],
  (ARRAY[
    'Prefere ser avisado por WhatsApp.',
    'Costuma retirar no fim da tarde.',
    'Cliente antigo, atendimento prioritário.',
    'Deixa peças em nome da esposa.',
    'Pede sempre nota de serviço.',
    '', '', ''
  ])[1 + floor(random() * 8)::int],
  -- Cadastro entre 5 e 705 dias atrás (seed.ts:143).
  now() - ((5 + floor(random() * 700))::int || ' days')::interval,
  'novo'
FROM (VALUES
  ('Ana Beatriz Rocha'),('Carlos Eduardo Lima'),('Mariana Prado'),('José Antônio Silva'),
  ('Fernanda Couto'),('Rodrigo Menezes'),('Patrícia Alves'),('Bruno Tavares'),
  ('Juliana Ferraz'),('Marcos Vinícius Dias'),('Cláudia Bernardes'),('Eduardo Ramalho'),
  ('Letícia Moraes'),('Paulo Henrique Souza'),('Camila Nogueira'),('Rafael Andrade'),
  ('Simone Barros'),('Thiago Peixoto'),('Vanessa Cardoso'),('Gustavo Pereira'),
  ('Renata Villela'),('Alexandre Fontes'),('Bianca Teixeira'),('Leonardo Braga'),
  ('Cristiane Amaral'),('Fábio Junqueira'),('Débora Castilho'),('Márcio Rezende'),
  ('Adriana Pimentel'),('Vinícius Carvalho'),('Tatiane Freitas'),('Roberto Nunes'),
  ('Elaine Gonçalves'),('Sérgio Batista'),('Priscila Marinho'),('André Luiz Correia'),
  ('Michele Pontes'),('Danilo Aguiar'),('Sabrina Lopes'),('Wagner Estrela'),
  ('Aline Quintana'),('Felipe Bandeira'),('Rosana Delgado'),('Otávio Sampaio'),
  ('Karina Belmonte'),('Nelson Vasques'),('Isabela Cunha'),('Marcelo Furtado'),
  ('Larissa Bonfim'),('Ricardo Salgado'),('Natália Veiga'),('Henrique Portela'),
  ('Sônia Machado'),('Diego Valente'),('Regina Caldeira'),('Anderson Rios'),
  ('Milena Duarte'),('Everton Guimarães'),('Carla Assunção'),('Luiz Fernando Braz'),
  ('Jéssica Prates'),('Rogério Bastos'),('Amanda Siqueira'),('Fernando Vieira'),
  ('Talita Monteiro'),('Cesar Aparecido Melo'),('Viviane Rangel'),('Douglas Sardinha'),
  ('Bruna Villar'),('Ivan Petrucci'),('Sheila Antunes'),('Márcia Del Rey'),
  ('Gabriel Espíndola'),('Luciana Bittencourt'),('Nathan Ferrari'),('Eliane Padovani'),
  ('Sandro Malaquias'),('Yara Constantino'),('Hugo Vasconcelos'),('Rita de Cássia Pinho')
) AS n("name")
ON CONFLICT DO NOTHING;


-- ---------------------------------------------------------------------
-- 4. Comandas (120)  ← buildComandas() (seed.ts:248)
-- ---------------------------------------------------------------------
-- Escrita direta nas tabelas (não via create_order): o seed precisa
-- controlar datas passadas e a distribuição de status, o que a RPC — que
-- sempre cria em `recebida` com data de hoje — não permite.
SELECT setseed(0.1337);

DO $$
DECLARE
  v_mix        text[];
  v_i          integer;
  v_status     text;
  v_final      boolean;
  v_delivered  boolean;
  v_service    record;
  v_customer   uuid;
  v_created    timestamptz;
  v_due        timestamptz;
  v_qty        integer;
  v_total      numeric(12,2);
  v_down       numeric(12,2);
  v_method     text;
  v_staff      uuid;
  v_order_id   uuid;
  v_number     integer;
  v_photos     integer;
  v_p          integer;
  v_kind       text;
  v_no_photo   boolean;
  v_methods    text[] := ARRAY['pix','dinheiro','cartao','transferencia'];
  v_captions   text[];
BEGIN
  -- Distribuição alvo de status (MIX, seed.ts:234): garante que TODA
  -- tela da demo tenha conteúdo — inclusive atrasadas, sem foto e
  -- entregues sem pagamento.
  v_mix := ARRAY[]::text[];
  v_mix := v_mix || array_fill('entregue'::text,  ARRAY[34]);
  v_mix := v_mix || array_fill('execucao'::text,  ARRAY[23]);  -- 18 + 5 do bucket "outro"
  v_mix := v_mix || array_fill('pronta'::text,    ARRAY[14]);
  v_mix := v_mix || array_fill('recebida'::text,  ARRAY[10]);
  v_mix := v_mix || array_fill('avisado'::text,   ARRAY[9]);
  v_mix := v_mix || array_fill('material'::text,  ARRAY[8]);
  v_mix := v_mix || array_fill('analise'::text,   ARRAY[7]);
  v_mix := v_mix || array_fill('aprovacao'::text, ARRAY[6]);
  v_mix := v_mix || array_fill('pausada'::text,   ARRAY[5]);
  v_mix := v_mix || array_fill('cancelada'::text, ARRAY[4]);

  -- Numeração da demo começa em 1204, como no mock (seed.ts:259).
  v_number := 1204;

  FOR v_i IN 1..120 LOOP
    v_status    := v_mix[v_i];
    v_final     := v_status IN ('entregue', 'cancelada');
    v_delivered := v_status = 'entregue';

    SELECT s."id", s."name", s."category_key", s."base_price", s."lead_time_days", s."default_staff_id"
    INTO v_service
    FROM public.services s
    WHERE s."deleted_at" IS NULL
    ORDER BY random() LIMIT 1;

    SELECT c."id" INTO v_customer
    FROM public.customers c WHERE c."deleted_at" IS NULL
    ORDER BY random() LIMIT 1;

    -- Finalizadas ficam no passado; abertas, perto de hoje (seed.ts:264).
    v_created := date_trunc('minute',
      now() - (CASE WHEN v_final THEN (8 + floor(random() * 150)) ELSE floor(random() * 22) END || ' days')::interval
            - (floor(random() * 10) || ' hours')::interval
    );

    v_due := v_created + (greatest(1, v_service."lead_time_days" + floor(random() * 3)) || ' days')::interval;

    -- Força ~5 atrasadas visíveis entre as abertas (seed.ts:276).
    IF NOT v_final AND v_i % 26 = 3 THEN
      v_due := now() - ((1 + floor(random() * 4)) || ' days')::interval;
    ELSIF NOT v_final AND v_due < now() THEN
      v_due := now() + (floor(random() * 5) || ' days')::interval;
    END IF;

    v_qty   := CASE WHEN random() > 0.82 THEN 2 ELSE 1 END;
    v_total := greatest(1, round(v_service."base_price" * v_qty * (0.9 + random() * 0.45)));

    -- Entregues: 55% quitadas no ato, 45% com sinal parcial.
    -- O mock usava 88% quitadas no ato (seed.ts:292), o que gerava só 2-3
    -- pagamentos posteriores em 120 comandas — a aba Financeiro da
    -- comanda e a aba Pagamentos do cliente ficavam vazias na demo.
    IF v_delivered THEN
      v_down := CASE WHEN random() > 0.45 THEN v_total ELSE round(v_total * 0.5, 2) END;
    ELSIF random() > 0.45 THEN
      v_down := round(v_total * CASE WHEN random() > 0.5 THEN 0.5 ELSE 0.3 END, 2);
    ELSE
      v_down := 0;
    END IF;

    v_method := CASE WHEN v_down > 0 THEN v_methods[1 + floor(random() * 4)::int] ELSE NULL END;

    v_staff := CASE
      WHEN random() > 0.25 THEN v_service."default_staff_id"
      ELSE (SELECT "id" FROM public.staff
            WHERE "deleted_at" IS NULL AND "can_execute" ORDER BY random() LIMIT 1)
    END;

    INSERT INTO public.orders (
      "number", "customer_id", "category_key", "service_id", "service_name",
      "description", "quantity", "notes", "due_date", "assigned_staff_id",
      "status_key", "total_amount", "down_payment", "down_payment_method_key",
      "created_at", "updated_at", "delivered_at"
    )
    VALUES (
      v_number, v_customer, v_service."category_key", v_service."id", v_service."name",
      (ARRAY[
        'Cliente informou que a peça está travando.',
        'Manter o acabamento original.',
        'Conferir alcance e funcionamento após o serviço.',
        'Peça de uso diário, reforçar o ponto de tensão.',
        'Avaliar viabilidade e retornar com orçamento.'
      ])[1 + floor(random() * 5)::int],
      v_qty,
      (ARRAY[
        'Cliente pediu para avisar assim que ficar pronto.',
        'Retirada somente após as 14h.',
        'Cliente autorizou orçamento até R$ 150,00.',
        'Peça frágil, manusear com cuidado.',
        'Aguardando cliente confirmar a cor.',
        '', '', ''
      ])[1 + floor(random() * 8)::int],
      v_due, v_staff, v_status, v_total, v_down, v_method,
      v_created, v_created,
      CASE WHEN v_delivered THEN v_due ELSE NULL END
    )
    RETURNING "id" INTO v_order_id;

    -- Fotos: 1 em cada ~9 comandas abertas fica sem foto, para alimentar
    -- o alerta "comandas sem foto" do dashboard (seed.ts:284).
    v_no_photo := (v_i % 9 = 4) AND NOT v_final;
    v_photos := CASE
      WHEN v_no_photo    THEN 0
      WHEN v_delivered   THEN 3
      WHEN random() > 0.55 THEN 3
      WHEN random() > 0.25 THEN 2
      ELSE 1
    END;

    v_captions := CASE v_service."category_key"
      WHEN 'chaveiro'  THEN ARRAY['Chave recebida','Fechadura do cliente','Segredo desmontado','Chave finalizada','Cilindro novo']
      WHEN 'sapataria' THEN ARRAY['Calçado na entrada','Sola desgastada','Salto solto','Detalhe da costura','Peça finalizada']
      WHEN 'costura'   THEN ARRAY['Peça recebida','Marcação da barra','Zíper danificado','Ajuste alinhavado','Peça pronta']
      ELSE ARRAY['Item recebido','Detalhe do item','Serviço concluído']
    END;

    FOR v_p IN 1..v_photos LOOP
      v_kind := CASE
        WHEN v_p = 1 THEN 'antes'
        WHEN v_p = v_photos AND v_photos > 2 THEN 'depois'
        ELSE 'detalhe'
      END;

      INSERT INTO public.order_photos ("order_id", "kind", "caption", "gradient_seed", "created_at")
      VALUES (
        v_order_id, v_kind,
        v_captions[1 + ((v_p - 1) % array_length(v_captions, 1))],
        -- Sem binário: o front renderiza o gradiente a partir do seed.
        v_service."category_key" || '-' || floor(random() * 999)::int,
        v_created + ((v_p - 1) || ' hours')::interval
      );
    END LOOP;

    -- Das entregues com sinal parcial, 75% quitam na retirada (gera
    -- order_payment) e 25% ficam como "entregue sem pagamento", que é o
    -- alerta vermelho do Financeiro (Financeiro.tsx:270).
    IF v_delivered AND v_down < v_total AND random() > 0.25 THEN
      INSERT INTO public.order_payments ("order_id", "amount", "method_key", "received_by_staff_id", "note", "paid_at")
      VALUES (
        v_order_id, v_total - v_down, v_method,
        (SELECT "id" FROM public.staff WHERE "name" = 'Sandra' AND "deleted_at" IS NULL),
        'Saldo quitado na retirada', v_due
      );
    END IF;

    -- Impressão: nem tudo foi impresso, para a fila de Etiquetas ter conteúdo.
    UPDATE public.orders
    SET "label_printed" = (NOT v_no_photo AND random() > 0.3),
        "order_printed" = random() > 0.4
    WHERE "id" = v_order_id;

    v_number := v_number + 1;
  END LOOP;

  -- A próxima comanda criada pela UI continua a numeração da demo.
  UPDATE public.app_settings SET "order_next_number" = v_number WHERE "id";
END
$$;


-- ---------------------------------------------------------------------
-- 5. Histórico das comandas  ← historico (seed.ts:297)
-- ---------------------------------------------------------------------
INSERT INTO "public"."order_events" ("order_id", "title", "detail", "actor_name", "created_at")
SELECT o."id", 'Comanda criada',
       o."service_name" || ' · ' || c."name",
       'Camila', o."created_at"
FROM "public"."orders" o
JOIN "public"."customers" c ON c."id" = o."customer_id";

INSERT INTO "public"."order_events" ("order_id", "title", "detail", "actor_name", "created_at")
SELECT o."id", 'Entrada registrada',
       'Entrada de R$ ' || to_char(o."down_payment", 'FM999999990.00'),
       'Camila', o."created_at"
FROM "public"."orders" o
WHERE o."down_payment" > 0;

INSERT INTO "public"."order_events" ("order_id", "title", "detail", "actor_name", "created_at")
SELECT o."id", 'Status alterado', 'Comanda entrou em análise técnica',
       coalesce(st."name", 'Wallace'), o."created_at" + interval '1 day'
FROM "public"."orders" o
LEFT JOIN "public"."staff" st ON st."id" = o."assigned_staff_id"
WHERE o."status_key" <> 'recebida';

INSERT INTO "public"."order_events" ("order_id", "title", "detail", "actor_name", "created_at")
SELECT o."id", 'Serviço entregue', 'Cliente retirou no balcão',
       coalesce(st."name", 'Wallace'), o."delivered_at"
FROM "public"."orders" o
LEFT JOIN "public"."staff" st ON st."id" = o."assigned_staff_id"
WHERE o."status_key" = 'entregue' AND o."delivered_at" IS NOT NULL;

INSERT INTO "public"."order_events" ("order_id", "title", "detail", "actor_name", "created_at")
SELECT p."order_id", 'Pagamento registrado',
       'R$ ' || to_char(p."amount", 'FM999999990.00') || ' · ' || upper(p."method_key"),
       'Sandra', p."paid_at"
FROM "public"."order_payments" p;


-- ---------------------------------------------------------------------
-- 6. Lançamentos derivados das comandas  ← buildLancamentos() (seed.ts:405)
-- ---------------------------------------------------------------------
-- Entradas (sinal pago no balcão)
INSERT INTO "public"."ledger_entries" (
  "kind", "description", "category_id", "amount", "entry_date", "status_key",
  "method_key", "order_id", "customer_id", "staff_id", "note", "auto_generated", "auto_role"
)
SELECT
  'income', 'Entrada · ' || o."service_name",
  (SELECT "id" FROM "public"."ledger_categories" WHERE "name" = 'Entrada de comanda' AND "deleted_at" IS NULL),
  o."down_payment", o."created_at", 'recebido',
  o."down_payment_method_key", o."id", o."customer_id",
  (SELECT "id" FROM "public"."staff" WHERE "name" = 'Camila' AND "deleted_at" IS NULL),
  'Cliente ' || c."name", true, 'down_payment'
FROM "public"."orders" o
JOIN "public"."customers" c ON c."id" = o."customer_id"
WHERE o."down_payment" > 0 AND o."status_key" <> 'cancelada';

-- Pagamentos posteriores
INSERT INTO "public"."ledger_entries" (
  "kind", "description", "category_id", "amount", "entry_date", "status_key",
  "method_key", "order_id", "customer_id", "staff_id", "note", "auto_generated", "auto_role"
)
SELECT
  'income', 'Saldo · ' || o."service_name",
  (SELECT "id" FROM "public"."ledger_categories" WHERE "name" = 'Saldo final' AND "deleted_at" IS NULL),
  p."amount", p."paid_at", 'recebido',
  p."method_key", o."id", o."customer_id", p."received_by_staff_id",
  p."note", true, 'payment'
FROM "public"."order_payments" p
JOIN "public"."orders" o ON o."id" = p."order_id"
WHERE o."status_key" <> 'cancelada';

-- Saldo em aberto: pendente / parcial / vencido (seed.ts:452)
INSERT INTO "public"."ledger_entries" (
  "kind", "description", "category_id", "amount", "entry_date", "status_key",
  "method_key", "order_id", "customer_id", "staff_id", "note", "auto_generated", "auto_role"
)
SELECT
  'income',
  CASE WHEN o."status_key" = 'entregue'
       THEN 'Entregue sem pagamento · ' || o."service_name"
       ELSE 'Saldo a receber · ' || o."service_name" END,
  coalesce(
    (SELECT "id" FROM "public"."ledger_categories"
      WHERE "auto_for_service_category" = o."category_key" AND "deleted_at" IS NULL LIMIT 1),
    (SELECT "id" FROM "public"."ledger_categories"
      WHERE "name" = 'Outros recebimentos' AND "deleted_at" IS NULL)
  ),
  o."balance", o."due_date",
  CASE
    WHEN o."status_key" = 'entregue' THEN 'vencido'
    WHEN o."amount_paid" > 0         THEN 'parcial'
    ELSE 'pendente'
  END,
  NULL, o."id", o."customer_id", o."assigned_staff_id",
  'Cliente ' || c."name", true, 'receivable'
FROM "public"."orders" o
JOIN "public"."customers" c ON c."id" = o."customer_id"
WHERE o."balance" > 0.01 AND o."status_key" <> 'cancelada';


-- ---------------------------------------------------------------------
-- 7. Despesas dos últimos 12 meses  ← DESC_SAIDA (seed.ts:379)
-- ---------------------------------------------------------------------
SELECT setseed(0.777);

INSERT INTO "public"."ledger_entries" (
  "kind", "description", "category_id", "amount", "entry_date", "status_key",
  "method_key", "staff_id", "auto_generated"
)
SELECT
  'expense', d."descr",
  (SELECT "id" FROM "public"."ledger_categories" WHERE "name" = d."cat" AND "deleted_at" IS NULL),
  -- `random()` é double precision; round(double, int) não existe.
  round((d."base" * (0.75 + random() * 0.6))::numeric, 2),
  date_trunc('month', now()) - (m || ' months')::interval
    + ((floor(random() * 27))::int || ' days')::interval + interval '10 hours',
  'pago',
  (ARRAY['pix','dinheiro','cartao','transferencia'])[1 + floor(random() * 4)::int],
  (SELECT "id" FROM "public"."staff" WHERE "name" = 'Wallace' AND "deleted_at" IS NULL),
  false
FROM generate_series(0, 11) AS m
CROSS JOIN LATERAL (
  SELECT * FROM (VALUES
    ('Compra de chaves virgens',            'Material',            320.00),
    ('Lâminas para máquina de cópia',       'Material',            180.00),
    ('Cola de poliuretano (5un)',           'Material',            240.00),
    ('Solados e meia-sola',                 'Material',            410.00),
    ('Linhas e zíperes',                    'Material',            165.00),
    ('Manutenção da máquina de costura',    'Manutenção',          280.00),
    ('Afiação de ferramentas',              'Manutenção',          120.00),
    ('Fresa nova para duplicadora',         'Ferramenta',          540.00),
    ('Alicate de bico profissional',        'Ferramenta',           95.00),
    ('Energia elétrica',                    'Despesa operacional', 430.00),
    ('Água',                                'Despesa operacional', 110.00),
    ('Internet da loja',                    'Despesa operacional', 129.00),
    ('Material de limpeza',                 'Outros custos',        85.00),
    ('Embalagens e etiquetas',              'Outros custos',       140.00)
  ) AS x("descr", "cat", "base")
  ORDER BY random()
  LIMIT (6 + floor(random() * 4))::int
) AS d
-- Não gera despesa com data futura (seed.ts:477).
WHERE date_trunc('month', now()) - (m || ' months')::interval <= now();


-- ---------------------------------------------------------------------
-- 8. Recalcula o status derivado dos clientes  ← aplicarStatusClientes()
-- ---------------------------------------------------------------------
-- As comandas foram inseridas em massa; a trigger já rodou por linha,
-- mas o recálculo final garante consistência independente da ordem.
DO $$
DECLARE
  v_id uuid;
BEGIN
  FOR v_id IN SELECT "id" FROM public.customers WHERE "deleted_at" IS NULL LOOP
    PERFORM public.recalc_customer_status(v_id);
  END LOOP;
END
$$;

COMMIT;


-- ---------------------------------------------------------------------
-- Conferência: a demo tem que cobrir TODAS as telas
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_overdue    integer;
  v_no_photo   integer;
  v_unpaid     integer;
  v_labels     integer;
  v_kanban     integer;
BEGIN
  SELECT count(*) INTO v_overdue  FROM public.order_list_view WHERE "is_overdue";
  SELECT count(*) INTO v_no_photo FROM public.order_list_view WHERE "photo_count" = 0 AND "status_key" NOT IN ('entregue','cancelada');
  SELECT count(*) INTO v_unpaid   FROM public.orders WHERE "status_key" = 'entregue' AND "balance" > 0.01 AND "deleted_at" IS NULL;
  SELECT count(*) INTO v_labels   FROM public.orders WHERE NOT "label_printed" AND "status_key" NOT IN ('entregue','cancelada') AND "deleted_at" IS NULL;
  SELECT count(DISTINCT "status_key") INTO v_kanban FROM public.orders WHERE "deleted_at" IS NULL;

  RAISE NOTICE '--- seed_demo aplicado ---';
  RAISE NOTICE 'clientes: %  serviços: %  comandas: %  fotos: %  pagamentos: %  lançamentos: %',
    (SELECT count(*) FROM public.customers      WHERE "deleted_at" IS NULL),
    (SELECT count(*) FROM public.services       WHERE "deleted_at" IS NULL),
    (SELECT count(*) FROM public.orders         WHERE "deleted_at" IS NULL),
    (SELECT count(*) FROM public.order_photos),
    (SELECT count(*) FROM public.order_payments),
    (SELECT count(*) FROM public.ledger_entries WHERE "deleted_at" IS NULL);
  RAISE NOTICE 'cobertura de tela — atrasadas: %  sem foto: %  entregues sem pagar: %  etiquetas pendentes: %  status distintos: %',
    v_overdue, v_no_photo, v_unpaid, v_labels, v_kanban;

  IF v_overdue = 0 OR v_no_photo = 0 OR v_labels = 0 THEN
    RAISE WARNING 'A demo não cobre todos os alertas do dashboard — confira a distribuição de status.';
  END IF;

  RAISE NOTICE 'logins de teste (senha demo1234):';
  RAISE NOTICE '  wallace@demo.chaveiroformiga.com.br  → Responsável (acesso total)';
  RAISE NOTICE '  camila@demo.chaveiroformiga.com.br   → Atendimento';
  RAISE NOTICE '  diego@demo.chaveiroformiga.com.br    → Produção';
  RAISE NOTICE '  sandra@demo.chaveiroformiga.com.br   → Financeiro';
  RAISE NOTICE '  consulta@demo.chaveiroformiga.com.br → Consulta (somente leitura)';
END
$$;

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

-- ---------------------------------------------------------------------
-- Comandas com mais de um item (migration 20260807100000)
-- ---------------------------------------------------------------------
-- Sem isto a demo mostraria 120 comandas de um item só, e o recurso que o
-- bloco 3 entregou ficaria invisível para quem avalia o sistema.
--
-- Só mexe em comanda AINDA ABERTA e SEM NENHUM PAGAMENTO: acrescentar
-- item muda `orders.total_amount`, e mudar o total de uma comanda já paga
-- reabriria saldo que a loja já recebeu. Depois de inserir, o lançamento
-- automático de "saldo a receber" é reajustado para o novo saldo — senão
-- o financeiro passa a divergir da comanda.
DO $multi$
DECLARE
  v_order   record;
  v_service record;
  v_pos     integer;
  v_extras  integer;
  v_n       integer := 0;
  v_itens   integer := 0;
BEGIN
  IF to_regclass('public.order_items') IS NULL THEN
    RETURN;
  END IF;

  FOR v_order IN
    SELECT o."id", o."number"
    FROM public.orders o
    JOIN public.order_statuses s ON s."key" = o."status_key"
    WHERE o."deleted_at" IS NULL
      AND NOT s."is_final"
      AND o."amount_paid" = 0
      AND (SELECT count(*) FROM public.order_items i WHERE i."order_id" = o."id") = 1
    ORDER BY o."number"
    LIMIT 8
  LOOP
    -- 1 ou 2 itens extras, alternando de forma determinística (sem random:
    -- seed precisa dar o mesmo banco toda vez).
    v_extras := 1 + (v_n % 2);

    SELECT coalesce(max(i."position"), 0) INTO v_pos
    FROM public.order_items i WHERE i."order_id" = v_order."id";

    FOR v_service IN
      SELECT s."id", s."name", s."category_key", s."base_price", s."lead_time_days", s."default_staff_id"
      FROM public.services s
      WHERE s."deleted_at" IS NULL AND s."active"
        AND s."category_key" <> (
          SELECT i."category_key" FROM public.order_items i
          WHERE i."order_id" = v_order."id" ORDER BY i."position" LIMIT 1
        )
      ORDER BY md5(s."id"::text || v_order."id"::text)
      LIMIT v_extras
    LOOP
      v_pos := v_pos + 1;
      INSERT INTO public.order_items (
        "order_id", "position", "category_key", "service_id", "service_name",
        "description", "quantity", "total_amount", "due_date", "assigned_staff_id", "status_key"
      )
      VALUES (
        v_order."id", v_pos, v_service."category_key", v_service."id", v_service."name",
        '', 1, v_service."base_price",
        now() + (v_service."lead_time_days" || ' days')::interval,
        v_service."default_staff_id",
        -- O segundo item fica um passo atrás: é o que faz o Kanban mostrar
        -- a mesma comanda em duas colunas, que é o ponto da decisão 2.
        CASE WHEN v_pos = 2 THEN 'execucao' ELSE 'recebida' END
      );
      v_itens := v_itens + 1;
    END LOOP;

    v_n := v_n + 1;
  END LOOP;

  -- Reajusta a pendência automática ao novo saldo da comanda.
  UPDATE public.ledger_entries le
  SET "amount" = o."balance"
  FROM public.orders o
  WHERE o."id" = le."order_id"
    AND le."auto_generated"
    AND le."auto_role" = 'receivable'
    AND le."deleted_at" IS NULL
    AND le."amount" IS DISTINCT FROM o."balance";

  RAISE NOTICE 'comandas multi-item na demo: % (com % itens extras)', v_n, v_itens;
END
$multi$;
