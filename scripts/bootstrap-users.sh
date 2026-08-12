#!/usr/bin/env bash
# =====================================================================
# bootstrap-users.sh — provisionamento PÓS-SUBIDA do stack
#                      (logins + limites do bucket de fotos)
# ---------------------------------------------------------------------
# POR QUE PELA API E NÃO POR SQL
#
# O schema `auth` é contrato interno do GoTrue e muda entre versões. Na
# primeira subida do docker compose, o db-init roda ANTES do GoTrue
# migrar o schema — `auth.identities` ainda não existe. Criar usuário por
# SQL nesse momento é impossível (e frágil depois).
#
# A Admin API é estável e versionada. Este script é idempotente: usuário
# existente é mantido, com a senha preservada.
#
# Uso:
#   ./scripts/bootstrap-users.sh              # admin + logins de demo
#   ./scripts/bootstrap-users.sh --prod-only  # somente o admin
# =====================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

RED=$'\033[0;31m'; GREEN=$'\033[0;32m'; YELLOW=$'\033[1;33m'; BLUE=$'\033[0;34m'; NC=$'\033[0m'
info() { printf '%s==>%s %s\n' "$BLUE" "$NC" "$*"; }
ok()   { printf '%s  ✓%s %s\n' "$GREEN" "$NC" "$*"; }
warn() { printf '%s  !%s %s\n' "$YELLOW" "$NC" "$*"; }
die()  { printf '%s  ✗%s %s\n' "$RED" "$NC" "$*" >&2; exit 1; }

PROD_ONLY=0
[[ "${1:-}" == "--prod-only" ]] && PROD_ONLY=1

if [[ -f .env ]]; then
  set -a; # shellcheck disable=SC1091
  source .env; set +a
fi

API="${API_EXTERNAL_URL:-http://localhost:8000}"
KEY="${SERVICE_ROLE_KEY:-}"
DB_URL="${SUPABASE_DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"

[[ -n "$KEY" ]] || die "SERVICE_ROLE_KEY não definida (.env). É necessária para a Admin API."
command -v curl >/dev/null || die "curl não encontrado."

# --- espera o GoTrue ficar de pé ------------------------------------
info "Aguardando o serviço de autenticação em $API"
for i in $(seq 1 60); do
  if curl -fsS "$API/auth/v1/health" -H "apikey: $KEY" >/dev/null 2>&1; then
    ok "autenticação disponível (${i}s)"
    break
  fi
  [[ "$i" -eq 60 ]] && die "Timeout: o serviço de autenticação não respondeu em 60s."
  sleep 1
done

# ---------------------------------------------------------------------
# create_user <email> <senha> <nome> <papel> [staff]
# ---------------------------------------------------------------------
create_user() {
  local email="$1" password="$2" name="$3" role="$4" staff="${5:-}"
  local user_meta app_meta body http

  user_meta=$(printf '{"full_name":"%s"}' "$name")
  if [[ -n "$staff" ]]; then
    app_meta=$(printf '{"role_key":"%s","staff_name":"%s"}' "$role" "$staff")
  else
    app_meta=$(printf '{"role_key":"%s"}' "$role")
  fi

  body=$(printf \
    '{"email":"%s","password":"%s","email_confirm":true,"user_metadata":%s,"app_metadata":%s}' \
    "$email" "$password" "$user_meta" "$app_meta")

  http=$(curl -sS -o /tmp/cf-user.json -w '%{http_code}' \
              -X POST "$API/auth/v1/admin/users" \
              -H "apikey: $KEY" \
              -H "Authorization: Bearer $KEY" \
              -H 'Content-Type: application/json' \
              -d "$body")

  case "$http" in
    200|201)
      ok "$email criado ($role)"
      ;;
    422)
      # Já existe: mantém a senha atual, mas garante o papel no perfil.
      if grep -qi 'already been registered\|already exists' /tmp/cf-user.json; then
        warn "$email já existe — senha preservada"
      else
        die "$email: $(cat /tmp/cf-user.json)"
      fi
      ;;
    *)
      die "$email: HTTP $http — $(cat /tmp/cf-user.json)"
      ;;
  esac

  # O trigger handle_new_user cria o perfil a partir do metadata. Para
  # usuários pré-existentes, força o papel correto aqui.
  if command -v psql >/dev/null 2>&1; then
    psql "$DB_URL" -qtAc "
      UPDATE public.profiles p
      SET role_key = '$role',
          is_active = true,
          staff_id = COALESCE(
            p.staff_id,
            (SELECT id FROM public.staff WHERE deleted_at IS NULL AND lower(name) = lower('${staff:-~none~}'))
          )
      WHERE p.email = '$email';
    " >/dev/null 2>&1 || warn "não foi possível reconciliar o perfil de $email"
  fi
}

# ---------------------------------------------------------------------
# Limites do bucket de fotos
# ---------------------------------------------------------------------
# As colunas `public`, `file_size_limit` e `allowed_mime_types` de
# storage.buckets são criadas pelas migrations do storage-api, que rodam
# quando o CONTAINER sobe — depois do db-init. Na primeira subida a
# migration de Storage encontra a tabela antiga, cria o bucket sem
# limites, e eles ficam NULL (upload de qualquer tamanho e tipo).
#
# Aqui o storage-api já migrou, então a função reaplica os limites.
info "Aplicando limites do bucket order-photos"
if command -v psql >/dev/null 2>&1; then
  PSQL_CMD=(psql "${SUPABASE_DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}")
elif docker exec "${DB_CONTAINER:-chaveiro-db}" true >/dev/null 2>&1; then
  PSQL_CMD=(docker exec -i "${DB_CONTAINER:-chaveiro-db}" psql
            "postgresql://supabase_admin:${POSTGRES_PASSWORD}@127.0.0.1:5432/${POSTGRES_DB:-postgres}")
else
  PSQL_CMD=()
  warn "sem psql e sem container — limites do bucket não aplicados"
fi

if [[ ${#PSQL_CMD[@]} -gt 0 ]]; then
  "${PSQL_CMD[@]}" -qtAc "SELECT public.ensure_order_photos_bucket();" >/dev/null 2>&1 \
    && ok "bucket privado com limite de 10 MB e MIME restrito" \
    || warn "não foi possível aplicar os limites do bucket"
fi

# --- administrador ----------------------------------------------------
info "Criando administrador"
create_user \
  "${SEED_ADMIN_EMAIL:-wallace@chaveiroformiga.com.br}" \
  "${SEED_ADMIN_PASSWORD:-ChaveiroFormiga@2026}" \
  "Wallace" "owner" "Wallace"

# --- logins de demonstração ------------------------------------------
if [[ "$PROD_ONLY" -eq 0 ]]; then
  info "Criando logins de demonstração (senha: demo1234)"
  create_user "wallace@demo.chaveiroformiga.com.br"  "demo1234" "Wallace"   "owner"      "Wallace"
  create_user "camila@demo.chaveiroformiga.com.br"   "demo1234" "Camila"    "attendant"  "Camila"
  create_user "diego@demo.chaveiroformiga.com.br"    "demo1234" "Diego"     "production" "Diego"
  create_user "sandra@demo.chaveiroformiga.com.br"   "demo1234" "Sandra"    "finance"    "Sandra"
  create_user "consulta@demo.chaveiroformiga.com.br" "demo1234" "Visitante" "viewer"     ""
fi

# --- conferência ------------------------------------------------------
if command -v psql >/dev/null 2>&1; then
  info "Perfis provisionados"
  psql "$DB_URL" -c "
    SELECT p.email, r.label AS papel, s.name AS equipe, p.is_active
    FROM public.profiles p
    JOIN public.roles r ON r.key = p.role_key
    LEFT JOIN public.staff s ON s.id = p.staff_id
    ORDER BY r.sort_order, p.email;
  "
fi

printf '\n%s✓ Logins provisionados%s\n\n' "$GREEN" "$NC"
