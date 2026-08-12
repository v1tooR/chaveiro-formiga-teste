#!/usr/bin/env bash
# =====================================================================
# testes.sh — regressão das regras de negócio pela API real.
# ---------------------------------------------------------------------
# Cada suíte fala com Kong → PostgREST → RPC, com token de usuário de
# verdade. NÃO usa psql, e isso é o ponto: o que quebra na prática é o
# caminho HTTP, não o SQL.
#
# O que só aparece aqui:
#   • resolução de sobrecarga da RPC (duas versões vivas = requisito
#     furado, porque o PostgREST escolhe a de menos argumentos)
#   • RLS por papel — atendente não escreve em `services`, financeiro não
#     muda status
#   • a mensagem que chega ao operador (mensagemErro, supabase.ts:115, só
#     repassa a frase da RPC quando ela tem acento)
#   • policy do Storage com token de atendente, e as constraints de
#     caminho do bucket
#
# Roda contra o ambiente LOCAL. Precisa da stack no ar:
#   npm run db:up && npm run db:seed:demo
#
# Uso:
#   npm run test:api            todas
#   npm run test:api entrega    só uma
# =====================================================================
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
[[ -f .env ]] && { set -a; source .env; set +a; }

source "$(dirname "${BASH_SOURCE[0]}")/lib/psql.sh"

: "${ANON_KEY:?falta ANON_KEY no .env — rode npm run keys}"
export ANON_KEY

API="${SUPABASE_URL_LOCAL:-http://localhost:8000}"

# Kong devolve 401 sem o header `apikey`, então um curl cru "falha" mesmo
# com a stack no ar — checar isso aqui evita 5 suítes morrendo com erro de
# conexão e nenhuma pista.
if ! curl -sf -o /dev/null -H "apikey: $ANON_KEY" "$API/rest/v1/"; then
  echo "A API não respondeu em $API."
  echo "Suba a stack:  npm run db:up"
  exit 1
fi

SUITES=("$@")
if [[ ${#SUITES[@]} -eq 0 ]]; then
  SUITES=(entrega itens aprovacao garantia camera abandono qr)
fi

falhas=0
for s in "${SUITES[@]}"; do
  arquivo="scripts/testes/${s}.mjs"
  if [[ ! -f "$arquivo" ]]; then
    echo "suíte desconhecida: $s"
    exit 1
  fi
  printf '\n\033[1m═══ %s ═══\033[0m\n' "$s"
  node "$arquivo" || falhas=$((falhas + 1))
done

# ---------------------------------------------------------------------
# Limpeza — as suítes NÃO conseguem se limpar sozinhas
# ---------------------------------------------------------------------
# Apagar comanda pelo PostgREST é impossível: `orders_select` tem
# `deleted_at IS NULL` no USING, e o PostgREST embrulha todo UPDATE num
# `RETURNING`, então a policy de leitura julga a linha NOVA e rejeita com
# 403 (a migration 20260730160000 documenta o mesmo caso em
# `ledger_entries`, e resolveu lá com uma RPC — para `orders` nunca houve
# uma, porque a interface não oferece excluir comanda).
#
# O resultado é que cada execução deixava comandas de teste no banco de
# demonstração, com fotos de 1 pixel. Quem abrisse uma delas concluiria,
# com razão, que o upload de fotos está quebrado.
#
# A limpeza vai por SQL, que não passa por RLS.
#
# ⚠️ E é EXCLUSÃO LÓGICA, não DELETE. Tentar apagar de verdade esbarra em
# `ledger_entries_auto_has_order`: a FK de `ledger_entries.order_id` é
# ON DELETE SET NULL, e a constraint exige que lançamento automático tenha
# comanda. Ou seja, o banco recusa apagar comanda que já mexeu no caixa —
# é o registro financeiro se protegendo, e está certo. Aqui é o mesmo
# "excluir" que a aplicação faz.
#
# As FOTOS saem de vez, porque não têm valor contábil e a trigger
# `order_photos_cleanup_storage` limpa o binário do bucket junto. Sem
# isso o bucket cresceria a cada execução.
DB="${SUPABASE_DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
[[ -n "${POSTGRES_PASSWORD:-}" ]] && \
  DB="postgresql://supabase_admin:${POSTGRES_PASSWORD}@127.0.0.1:54322/${POSTGRES_DB:-postgres}"

APAGADAS=$(PSQL "$DB" -At -c "
  WITH alvo AS (
    SELECT o.\"id\" FROM public.orders o
    WHERE o.\"notes\" = '[teste-automatizado]' AND o.\"deleted_at\" IS NULL
    UNION
    -- Retrabalho aberto a partir de um item de teste: create_rework não
    -- copia \`notes\`, então o vínculo é pelo item pai.
    SELECT i.\"order_id\"
    FROM public.order_items i
    JOIN public.order_items pai ON pai.\"id\" = i.\"parent_item_id\"
    JOIN public.orders po ON po.\"id\" = pai.\"order_id\"
    WHERE po.\"notes\" = '[teste-automatizado]'
  ), fotos AS (
    DELETE FROM public.order_photos WHERE \"order_id\" IN (SELECT \"id\" FROM alvo)
  ), caixa AS (
    UPDATE public.ledger_entries SET \"deleted_at\" = now()
    WHERE \"order_id\" IN (SELECT \"id\" FROM alvo) AND \"deleted_at\" IS NULL
  ), comandas AS (
    UPDATE public.orders SET \"deleted_at\" = now()
    WHERE \"id\" IN (SELECT \"id\" FROM alvo) RETURNING 1
  )
  SELECT count(*) FROM comandas;
" 2>/dev/null | tr -d '\r' || echo '?')

echo
if [[ "${APAGADAS:-0}" != "0" && -n "${APAGADAS:-}" ]]; then
  printf '  \033[2mlimpeza: %s comanda(s) de teste removida(s)\033[0m\n' "$APAGADAS"
fi

if [[ $falhas -eq 0 ]]; then
  printf '\033[32mTodas as suítes passaram.\033[0m\n'
else
  printf '\033[31m%d suíte(s) com falha.\033[0m\n' "$falhas"
  exit 1
fi
