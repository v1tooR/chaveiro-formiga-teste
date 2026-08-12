#!/usr/bin/env bash
# Regenera src/types/database.ts a partir do schema atual.
# RODE DEPOIS DE QUALQUER MIGRATION — os tipos do front dependem disso.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
[[ -f .env ]] && { set -a; source .env; set +a; }
DB="${SUPABASE_DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
# supabase_admin vê tudo; postgres é demovido nesta imagem.
if [[ -n "${POSTGRES_PASSWORD:-}" ]]; then
  DB="postgresql://supabase_admin:${POSTGRES_PASSWORD}@127.0.0.1:54322/${POSTGRES_DB:-postgres}"
fi

DEST=src/types/database.ts
TMP=$(mktemp)

{
  echo '// ====================================================================='
  echo '// GERADO AUTOMATICAMENTE — NÃO EDITE À MÃO'
  echo '// ---------------------------------------------------------------------'
  echo '// Regenere depois de QUALQUER migration:'
  echo '//     npm run db:types'
  echo '// ====================================================================='
  echo ''
} > "$TMP"

npx supabase gen types typescript --db-url "$DB" --schema public >> "$TMP"

mv "$TMP" "$DEST"
echo "$DEST regenerado ($(wc -l < "$DEST") linhas)."
echo "Rode 'npm run typecheck' para ver o que quebrou."
