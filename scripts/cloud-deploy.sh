#!/usr/bin/env bash
# =====================================================================
# cloud-deploy.sh — leva o schema e a configuração de produção para um
#                   projeto no Supabase Cloud.
# ---------------------------------------------------------------------
# Uso:
#   npm run cloud:deploy            # migrations + seed_prod + admin
#   npm run cloud:deploy -- --so-migrations
#
# Precisa no .env (nunca versionado):
#   SUPABASE_PROJECT_REF    ref do projeto (ex.: sezhelwhnejrtwixwrpa)
#   SUPABASE_DB_URL_CLOUD   URI completa de Settings → Database → URI
#   SUPABASE_SECRET_KEY     sb_secret_… de Settings → API Keys
#   SEED_ADMIN_EMAIL        e-mail do responsável
#   SEED_ADMIN_PASSWORD     senha inicial dele
#
# POR QUE A CLI, E NÃO O migrate.sh
#
# `supabase db push` registra o que aplicou em
# supabase_migrations.schema_migrations. Sem esse histórico, a próxima
# migration não teria como saber o que já rodou e o deploy seguinte
# tentaria recriar tudo. O migrate.sh serve ao banco local, que é
# descartável; a nuvem não é.
# =====================================================================
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

RED=$'\033[0;31m'; GREEN=$'\033[0;32m'; YELLOW=$'\033[1;33m'; BLUE=$'\033[0;34m'; NC=$'\033[0m'
info() { printf '%s==>%s %s\n' "$BLUE" "$NC" "$*"; }
ok()   { printf '%s  ✓%s %s\n' "$GREEN" "$NC" "$*"; }
warn() { printf '%s  !%s %s\n' "$YELLOW" "$NC" "$*"; }
die()  { printf '%s  ✗%s %s\n' "$RED" "$NC" "$*" >&2; exit 1; }

SO_MIGRATIONS=0
[[ "${1:-}" == "--so-migrations" ]] && SO_MIGRATIONS=1

[[ -f .env ]] && { set -a; source .env; set +a; }
source "$ROOT/scripts/lib/psql.sh"

: "${SUPABASE_PROJECT_REF:?falta SUPABASE_PROJECT_REF no .env}"
: "${SUPABASE_DB_URL_CLOUD:?falta SUPABASE_DB_URL_CLOUD no .env (Settings → Database → URI)}"

case "$SUPABASE_DB_URL_CLOUD" in
  *127.0.0.1*|*localhost*) die "SUPABASE_DB_URL_CLOUD aponta para o LOCAL. Use a URI da nuvem." ;;
  *'[YOUR-PASSWORD]'*|*'[SUA-SENHA]'*) die "Troque o marcador [YOUR-PASSWORD] pela senha real." ;;
esac

# `db push --db-url` exige a URI percent-encoded. Senha com @ / # ? ou :
# parte a URI em lugar errado e o erro que sai é de host inválido, que não
# aponta para a causa. Melhor barrar aqui com a instrução.
# `%@*` corta no ÚLTIMO @ (o separador real do host). Usar `%%@*`, que
# corta no primeiro, esconderia justamente a senha com @ que se quer pegar.
SENHA_URI="${SUPABASE_DB_URL_CLOUD#*://}"; SENHA_URI="${SENHA_URI%@*}"; SENHA_URI="${SENHA_URI#*:}"
case "$SENHA_URI" in
  *[@/?\#]*)
    die "A senha na URI tem caractere especial sem escapar.
     Troque na própria URI:  @ → %40   / → %2F   # → %23   ? → %3F   : → %3A
     (a URI copiada do painel já vem escapada — refaça a cópia de lá)" ;;
esac

echo
info "Projeto ....... $SUPABASE_PROJECT_REF"
info "Banco ......... $(printf '%s' "$SUPABASE_DB_URL_CLOUD" | sed -E 's#^([a-z+]+://[^:]+):[^@]*@#\1:****@#')"
info "psql .......... $PSQL_ORIGEM"
info "Migrations .... $(ls supabase/migrations/*.sql | wc -l | tr -d ' ') arquivos"
echo

# ---------------------------------------------------------------------
# 1. Conectividade — falhar aqui é muito melhor que falhar no meio
# ---------------------------------------------------------------------
info "Testando conexão…"
PSQL "$SUPABASE_DB_URL_CLOUD" -tAc "SELECT 1" >/dev/null 2>&1 \
  || die "não conectou. Confira a senha e se o IP está liberado em Settings → Database → Network."
ok "conectado"

EXISTE=$(PSQL "$SUPABASE_DB_URL_CLOUD" -tAc \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'" | tr -d '[:space:]')
if [[ "$EXISTE" != "0" ]]; then
  warn "o schema public já tem $EXISTE tabela(s) — o push aplica só o que faltar"
fi

# ---------------------------------------------------------------------
# 2. Migrations pela CLI (com histórico)
# ---------------------------------------------------------------------
info "Aplicando migrations…"
npx --yes supabase@2 db push --db-url "$SUPABASE_DB_URL_CLOUD" --include-all \
  || die "db push falhou — veja o erro acima"
ok "migrations aplicadas"

APLICADAS=$(PSQL "$SUPABASE_DB_URL_CLOUD" -tAc \
  "SELECT count(*) FROM supabase_migrations.schema_migrations" 2>/dev/null | tr -d '[:space:]' || echo '?')
ok "histórico: $APLICADAS registradas"

if [[ $SO_MIGRATIONS -eq 1 ]]; then
  echo; ok "pronto (só migrations)"; exit 0
fi

# ---------------------------------------------------------------------
# 3. Seed de produção
# ---------------------------------------------------------------------
# Idempotente: papéis, módulos, matriz de permissão, tabelas de domínio,
# equipe, configuração da empresa e as integrações. NENHUM cliente ou
# comanda — a primeira comanda da loja nasce CF-0001.
: "${SEED_ADMIN_EMAIL:?falta SEED_ADMIN_EMAIL no .env}"
: "${SEED_ADMIN_PASSWORD:?falta SEED_ADMIN_PASSWORD no .env}"

info "Aplicando seed de produção…"
PGOPTIONS="-c seed.admin_email=$SEED_ADMIN_EMAIL -c seed.admin_password=$SEED_ADMIN_PASSWORD" \
  PSQL "$SUPABASE_DB_URL_CLOUD" -v ON_ERROR_STOP=1 -q < supabase/seeds/seed_prod.sql \
  || die "seed_prod falhou"
ok "seed aplicado"

# ---------------------------------------------------------------------
# 4. Admin pela Admin API
# ---------------------------------------------------------------------
# O seed_prod tenta criar o admin com INSERT direto em auth.users. Na
# nuvem isso pode esbarrar em permissão, e o caminho suportado é a Admin
# API — a mesma que o bootstrap-users.sh usa no local.
if [[ -n "${SUPABASE_SECRET_KEY:-}" ]]; then
  EMAIL="${SEED_ADMIN_EMAIL:?falta SEED_ADMIN_EMAIL}"
  SENHA="${SEED_ADMIN_PASSWORD:?falta SEED_ADMIN_PASSWORD}"
  URL="https://${SUPABASE_PROJECT_REF}.supabase.co"

  info "Garantindo o login do responsável…"
  JA=$(PSQL "$SUPABASE_DB_URL_CLOUD" -tAc \
    "SELECT count(*) FROM auth.users WHERE email = '$EMAIL'" | tr -d '[:space:]')

  if [[ "$JA" == "0" ]]; then
    CODIGO=$(curl -s -o /tmp/cf-admin.json -w '%{http_code}' -X POST "$URL/auth/v1/admin/users" \
      -H "apikey: $SUPABASE_SECRET_KEY" \
      -H "Authorization: Bearer $SUPABASE_SECRET_KEY" \
      -H "Content-Type: application/json" \
      -d "{\"email\":\"$EMAIL\",\"password\":\"$SENHA\",\"email_confirm\":true,
           \"user_metadata\":{\"full_name\":\"Wallace\"},
           \"app_metadata\":{\"role_key\":\"owner\",\"staff_name\":\"Wallace\"}}")
    if [[ "$CODIGO" == "200" || "$CODIGO" == "201" ]]; then
      ok "admin criado: $EMAIL"
    else
      warn "Admin API devolveu $CODIGO: $(head -c 200 /tmp/cf-admin.json)"
    fi
    rm -f /tmp/cf-admin.json
  else
    ok "admin já existia: $EMAIL (senha preservada)"
  fi

  # O trigger handle_new_user monta o perfil; isto religa a equipe, que
  # pode ter sido semeada depois.
  PSQL "$SUPABASE_DB_URL_CLOUD" -tAc "SELECT private.reconcile_profiles()" >/dev/null 2>&1 \
    && ok "perfis reconciliados" || warn "reconcile_profiles não rodou"
else
  warn "SUPABASE_SECRET_KEY ausente — crie o login em Authentication → Users"
fi

# ---------------------------------------------------------------------
# 5. Conferência
# ---------------------------------------------------------------------
echo
info "Estado do projeto:"
PSQL "$SUPABASE_DB_URL_CLOUD" -tAc "
SELECT '  papéis .......... ' || (SELECT count(*) FROM public.roles)
    || E'\n  módulos ......... ' || (SELECT count(*) FROM public.modules)
    || E'\n  permissões ...... ' || (SELECT count(*) FROM public.role_modules)
    || E'\n  equipe .......... ' || (SELECT count(*) FROM public.staff)
    || E'\n  integrações ..... ' || (SELECT count(*) FROM public.integrations)
    || E'\n  clientes ........ ' || (SELECT count(*) FROM public.customers)
    || E'\n  comandas ........ ' || (SELECT count(*) FROM public.orders)
    || E'\n  próxima comanda . ' || (SELECT order_prefix || '-' || lpad(order_next_number::text, 4, '0')
                                     FROM public.app_settings LIMIT 1)
    || E'\n  logins .......... ' || (SELECT count(*) FROM auth.users);"

echo
ok "deploy concluído"
echo
echo "  Front: aponte o .env para a nuvem —"
echo "    VITE_SUPABASE_URL=https://${SUPABASE_PROJECT_REF}.supabase.co"
echo "    VITE_SUPABASE_ANON_KEY=<a publishable key>"
echo
echo "  Storage: confirme o bucket 'order-photos' como PRIVADO no painel."
