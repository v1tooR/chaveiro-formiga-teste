#!/usr/bin/env bash
# seed.sh prod|demo
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
[[ -f .env ]] && { set -a; source .env; set +a; }

source "$(dirname "${BASH_SOURCE[0]}")/lib/psql.sh"
source "$(dirname "${BASH_SOURCE[0]}")/lib/alvo.sh"
DB="${SUPABASE_DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
QUAL="${1:-prod}"

descrever_alvo "$DB"
# Semear demo num banco real enche a operação de 80 clientes e 120
# comandas fictícias, e cria 5 logins com senha "demo1234" expostos.
if [[ "$QUAL" == "demo" ]]; then
  exigir_confirmacao_remota "$DB" "inserir DADOS DE DEMONSTRAÇÃO"
fi

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
# Por isso migrations, seeds e reset conectam como `supabase_admin`, cuja
# senha o bootstrap definiu igual a POSTGRES_PASSWORD.
if [[ -n "${SUPABASE_DB_ADMIN_URL:-}" ]]; then
  DB="$SUPABASE_DB_ADMIN_URL"
elif [[ -n "${POSTGRES_PASSWORD:-}" ]]; then
  DB="postgresql://supabase_admin:${POSTGRES_PASSWORD}@127.0.0.1:54322/${POSTGRES_DB:-postgres}"
fi
ROLE_OPT=""

case "$QUAL" in
  prod)
    PGOPTIONS="$ROLE_OPT -c seed.admin_email=${SEED_ADMIN_EMAIL:-wallace@chaveiroformiga.com.br} -c seed.admin_password=${SEED_ADMIN_PASSWORD:-ChaveiroFormiga@2026}" \
      PSQL "$DB" -v ON_ERROR_STOP=1 -f supabase/seeds/seed_prod.sql
    ;;
  demo)
    PGOPTIONS="$ROLE_OPT" PSQL "$DB" -v ON_ERROR_STOP=1 -f supabase/seeds/seed_prod.sql >/dev/null
    PGOPTIONS="$ROLE_OPT" PSQL "$DB" -v ON_ERROR_STOP=1 -f supabase/seeds/seed_demo.sql
    ;;
  *) echo "uso: seed.sh prod|demo" >&2; exit 1 ;;
esac
