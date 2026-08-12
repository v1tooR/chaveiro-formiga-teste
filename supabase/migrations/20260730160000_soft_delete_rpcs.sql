-- =====================================================================
-- 20260730160000 — RPCs de soft delete (lançamento e cliente)
-- ---------------------------------------------------------------------
-- PROBLEMA: soft delete era IMPOSSÍVEL via PostgREST
--
-- Excluir um lançamento no Financeiro abria o modal, confirmava, fechava
-- — e o registro continuava lá, sem erro nenhum na tela. O log do
-- Postgres tinha a resposta:
--
--   ERROR: new row violates row-level security policy
--          for table "ledger_entries"
--   STATEMENT: WITH pgrst_source AS (UPDATE "public"."ledger_entries"
--              SET "deleted_at" = ... RETURNING 1) ...
--
-- A causa é uma regra do Postgres que passa despercebida: num
-- `UPDATE ... RETURNING`, as policies de **SELECT** são aplicadas também
-- sobre a linha NOVA. E o PostgREST SEMPRE embrulha o update num CTE com
-- `RETURNING`, porque precisa da contagem de linhas afetadas.
--
-- Como `ledger_entries_select` tem `deleted_at IS NULL` no `USING`
-- (20260729120800_ledger_entries.sql:137-139), gravar `deleted_at` produz
-- uma linha nova que a própria policy de leitura rejeita. Ou seja:
--
--   TODA coluna que aparece no USING de uma policy de SELECT é
--   IMUTÁVEL por PostgREST.
--
-- O mesmo vale para `customers_select`, `orders_select` e
-- `services_select`, que usam o mesmo predicado.
--
-- POR QUE RPC E NÃO MEXER NA POLICY
--
-- Tirar `deleted_at IS NULL` do USING resolveria em uma linha, mas
-- transferiria a responsabilidade de filtrar excluídos para TODO call
-- site — e vários não passam pelas views (`buscarClientes` lê `customers`
-- direto, por exemplo). Um esquecimento faria lançamento excluído
-- reaparecer no caixa. A RPC mantém o invariante no banco e ainda ganha
-- três coisas que a policy não daria: mensagem de negócio em português,
-- idempotência, e a guarda de histórico do `delete_customer`.
-- =====================================================================


-- ---------------------------------------------------------------------
-- Lançamento financeiro
-- ---------------------------------------------------------------------
-- Ganho lateral sobre o código antigo: `removerLancamento` filtrava
-- `auto_generated = false` no próprio UPDATE, então tentar excluir um
-- lançamento gerado por comanda afetava 0 linhas e RETORNAVA SUCESSO. A
-- RPC transforma isso numa mensagem que explica o caminho certo.
CREATE OR REPLACE FUNCTION "public"."delete_ledger_entry"("p_id" uuid)
    RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_row public.ledger_entries;
  v_num integer;
BEGIN
  IF NOT public.can_write('finance') THEN
    RAISE EXCEPTION 'Sem permissão para excluir lançamentos.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_row FROM public.ledger_entries WHERE "id" = p_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lançamento não encontrado.' USING ERRCODE = 'P0002';
  END IF;

  -- Idempotente: dois cliques no botão não viram erro na cara do operador.
  IF v_row."deleted_at" IS NOT NULL THEN
    RETURN;
  END IF;

  IF v_row."auto_generated" THEN
    SELECT o."number" INTO v_num FROM public.orders o WHERE o."id" = v_row."order_id";
    RAISE EXCEPTION
      'Este lançamento foi gerado automaticamente pela comanda %. Para anular o valor, cancele ou ajuste a comanda.',
      coalesce(v_num::text, 'vinculada')
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.ledger_entries SET "deleted_at" = now() WHERE "id" = p_id;
END;
$$;

COMMENT ON FUNCTION "public"."delete_ledger_entry"(uuid) IS
  'Soft delete de lançamento manual. Existe porque UPDATE de deleted_at via PostgREST bate na policy de SELECT.';

REVOKE ALL ON FUNCTION "public"."delete_ledger_entry"(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."delete_ledger_entry"(uuid) TO "authenticated";


-- ---------------------------------------------------------------------
-- Cliente
-- ---------------------------------------------------------------------
-- A guarda de histórico não é conservadorismo: `order_list_view` faz
-- INNER JOIN em `customers` e é `security_invoker`. Soft-deletar um
-- cliente com comandas faria TODAS as comandas dele sumirem de Comandas,
-- Produção e Etiquetas — enquanto `report_by_category` e
-- `report_top_services`, que leem `orders` direto, continuariam
-- contando. Listagem e relatório passariam a discordar em silêncio.
--
-- Para cliente com histórico o caminho é o status `bloqueado`, que já
-- existe em `customer_statuses` com `is_derived = false` e é respeitado
-- por `recalc_customer_status` — um UPDATE comum, sem RPC.
CREATE OR REPLACE FUNCTION "public"."delete_customer"("p_id" uuid)
    RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_row      public.customers;
  v_comandas integer;
BEGIN
  IF NOT public.can_write('customers') THEN
    RAISE EXCEPTION 'Sem permissão para excluir clientes.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_row FROM public.customers WHERE "id" = p_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cliente não encontrado.' USING ERRCODE = 'P0002';
  END IF;

  IF v_row."deleted_at" IS NOT NULL THEN
    RETURN;
  END IF;

  SELECT count(*) INTO v_comandas
  FROM public.orders
  WHERE "customer_id" = p_id AND "deleted_at" IS NULL;

  IF v_comandas > 0 THEN
    RAISE EXCEPTION
      'Cliente tem % comanda(s) no histórico e não pode ser excluído. Use "Bloquear" para tirá-lo do atendimento sem perder o histórico.',
      v_comandas
      USING ERRCODE = '23514';
  END IF;

  -- `customers_phone_unique` é índice parcial (WHERE deleted_at IS NULL),
  -- então excluir libera o telefone para recadastro.
  UPDATE public.customers SET "deleted_at" = now() WHERE "id" = p_id;
END;
$$;

COMMENT ON FUNCTION "public"."delete_customer"(uuid) IS
  'Soft delete de cliente SEM histórico. Cliente com comandas usa status "bloqueado" — excluir sumiria com as comandas dele nas listagens.';

REVOKE ALL ON FUNCTION "public"."delete_customer"(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."delete_customer"(uuid) TO "authenticated";

NOTIFY pgrst, 'reload schema';
