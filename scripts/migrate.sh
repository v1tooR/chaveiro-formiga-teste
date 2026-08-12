#!/usr/bin/env bash
# =====================================================================
# migrate.sh — aplica as migrations em ordem cronológica.
# ---------------------------------------------------------------------
# NÃO é idempotente: cada migration roda uma vez, em banco novo.
# Rebuild completo do local:  npm run db:nuke && npm run db:up
#
# Para a NUVEM use `npm run cloud:deploy`, que passa pela CLI do Supabase
# e registra o histórico em supabase_migrations.schema_migrations — este
# script aqui não controla o que já foi aplicado.
# =====================================================================
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
[[ -f .env ]] && { set -a; source .env; set +a; }

source "$(dirname "${BASH_SOURCE[0]}")/lib/psql.sh"
source "$(dirname "${BASH_SOURCE[0]}")/lib/alvo.sh"

DB="${SUPABASE_DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"

# ⚠️ CONEXÃO COMO supabase_admin
#
# A imagem supabase/postgres carrega a extensão `supautils`, que REATRIBUI
# a posse de todo objeto criado por `postgres` para `supabase_admin`. E
# `postgres` NÃO é membro de `supabase_admin` — nem consegue `SET ROLE`.
#
# Efeito prático: a primeira migration passa, e qualquer migration futura
# com CREATE OR REPLACE falha com "must be owner of function ...". Como
# toda alteração de schema vira uma migration nova, isso travaria o
# projeto na segunda alteração.
#
# Isto vale para o self-hosted. No Supabase Cloud `postgres` já é o dono e
# não há troca de posse — mais um motivo para a nuvem ir pela CLI.
if [[ -n "${SUPABASE_DB_ADMIN_URL:-}" ]]; then
  DB="$SUPABASE_DB_ADMIN_URL"
elif [[ -n "${POSTGRES_PASSWORD:-}" ]]; then
  DB="postgresql://supabase_admin:${POSTGRES_PASSWORD}@127.0.0.1:54322/${POSTGRES_DB:-postgres}"
fi

descrever_alvo "$DB"
echo "  psql: $PSQL_ORIGEM"
exigir_confirmacao_remota "$DB" "aplicar migrations"

for f in $(ls supabase/migrations/*.sql | sort); do
  printf '  → %s\n' "$(basename "$f")"
  PSQL "$DB" -v ON_ERROR_STOP=1 -q < "$f"
done
echo "migrations aplicadas."
