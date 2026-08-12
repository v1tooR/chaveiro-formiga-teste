-- =====================================================================
-- 20260729121400 — Realtime
-- ---------------------------------------------------------------------
-- Critério de inclusão: TODA tela que dois usuários olham ao mesmo tempo.
-- Não só chat e notificação — o Kanban da Produção é o caso mais crítico
-- do sistema: Diego arrasta um card e Camila precisa ver, senão os dois
-- trabalham na mesma peça.
--
-- Telas cobertas:
--   Produção (kanban)  → orders, order_photos
--   Comandas (lista)   → orders
--   ComandaDetalhe     → orders, order_photos, order_payments, order_events
--   Dashboard/sino     → orders, ledger_entries
--   Etiquetas (fila)   → orders
--   Financeiro         → ledger_entries, order_payments
--   Clientes           → customers
--   Serviços           → services
--   Configurações      → app_settings
--
-- REPLICA IDENTITY FULL: sem isso, o payload de UPDATE/DELETE traz só a
-- PK, e o front não consegue decidir se a linha ainda passa no filtro.
-- =====================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "pg_publication" WHERE "pubname" = 'supabase_realtime') THEN
    CREATE PUBLICATION "supabase_realtime";
  END IF;
END
$$;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'orders',
    'order_photos',
    'order_payments',
    'order_events',
    'ledger_entries',
    'customers',
    'services',
    'staff',
    'app_settings'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY FULL', t);

    IF NOT EXISTS (
      SELECT 1 FROM "pg_publication_tables"
      WHERE "pubname" = 'supabase_realtime' AND "schemaname" = 'public' AND "tablename" = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END
$$;

-- ---------------------------------------------------------------------
-- Nota de segurança do Realtime
-- ---------------------------------------------------------------------
-- O Realtime do Supabase aplica a RLS de SELECT da tabela a cada
-- mensagem: um `viewer` não recebe evento de tabela que não pode ler.
-- ledger_entries só chega para quem tem `can_read('finance')`.
-- Nenhuma configuração extra é necessária — mas isso depende das
-- policies de SELECT, que por isso nunca devem ser `USING (true)` em
-- tabela de negócio.
