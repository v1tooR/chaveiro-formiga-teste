#!/usr/bin/env bash
# =====================================================================
# reset-to-prod.sh — apaga os dados de demonstração e deixa o banco
#                    pronto para a operação real. NÃO toca no schema.
# ---------------------------------------------------------------------
# Uso:
#   ./scripts/reset-to-prod.sh                    # pede confirmação
#   ./scripts/reset-to-prod.sh --yes              # sem confirmação (CI)
#   ./scripts/reset-to-prod.sh --db-url postgres://...
#
# Variáveis (ou .env na raiz):
#   SUPABASE_DB_URL        conexão do Postgres
#   SEED_ADMIN_EMAIL       e-mail do admin inicial
#   SEED_ADMIN_PASSWORD    senha do admin inicial
# =====================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

RED=$'\033[0;31m'; GREEN=$'\033[0;32m'; YELLOW=$'\033[1;33m'; BLUE=$'\033[0;34m'; NC=$'\033[0m'

info()  { printf '%s==>%s %s\n' "$BLUE"   "$NC" "$*"; }
ok()    { printf '%s  ✓%s %s\n' "$GREEN"  "$NC" "$*"; }
warn()  { printf '%s  !%s %s\n' "$YELLOW" "$NC" "$*"; }
die()   { printf '%s  ✗%s %s\n' "$RED"    "$NC" "$*" >&2; exit 1; }

ASSUME_YES=0
DB_URL_ARG=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --yes|-y)  ASSUME_YES=1; shift ;;
    --db-url)  DB_URL_ARG="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *)         die "Opção desconhecida: $1" ;;
  esac
done

# .env não é rastreado no git; carregado aqui só para pegar a conexão.
if [[ -f .env ]]; then
  set -a; # shellcheck disable=SC1091
  source .env; set +a
fi

DB_URL="${DB_URL_ARG:-${SUPABASE_DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}}"

source "$(dirname "${BASH_SOURCE[0]}")/lib/alvo.sh"
descrever_alvo "$DB_URL"
# O --yes existe para CI contra o banco descartável. Ele NÃO libera alvo
# remoto: apagar a base da loja não pode depender de uma flag genérica
# que alguém copiou de um exemplo.
exigir_confirmacao_remota "$DB_URL" "APAGAR TODOS OS DADOS"


source "$(dirname "${BASH_SOURCE[0]}")/lib/psql.sh"

# Ver nota em scripts/migrate.sh: supautils reatribui a posse dos objetos
# para supabase_admin, então é com ele que conectamos.
if [[ -z "$DB_URL_ARG" && -n "${POSTGRES_PASSWORD:-}" ]]; then
  PORTA=54322
  [[ -n "${EM_CONTAINER:-}" ]] && PORTA=5432   # de dentro, a porta é a nativa
  DB_URL="postgresql://supabase_admin:${POSTGRES_PASSWORD}@127.0.0.1:${PORTA}/${POSTGRES_DB:-postgres}"
fi

info "Verificando conexão"
PSQL "$DB_URL" -qtAc 'SELECT 1' >/dev/null 2>&1 \
  || die "Não foi possível conectar em $DB_URL"
ok "conectado"

# --- inventário antes -------------------------------------------------
read -r N_ORDERS N_CUSTOMERS N_LEDGER < <(PSQL "$DB_URL" -qtAF' ' -c "
  SELECT
    (SELECT count(*) FROM public.orders),
    (SELECT count(*) FROM public.customers),
    (SELECT count(*) FROM public.ledger_entries);
")

info "Estado atual: ${N_ORDERS} comandas · ${N_CUSTOMERS} clientes · ${N_LEDGER} lançamentos"

if [[ "$ASSUME_YES" -ne 1 ]]; then
  printf '\n%sIsto apaga TODOS os dados de operação. O schema permanece intacto.%s\n' "$YELLOW" "$NC"
  printf 'Digite %sZERAR%s para confirmar: ' "$RED" "$NC"
  read -r ANSWER
  [[ "$ANSWER" == "ZERAR" ]] || die "Cancelado."
fi

# --- reset ------------------------------------------------------------
info "Apagando dados de demonstração"
PSQL "$DB_URL" -v ON_ERROR_STOP=1 -q < supabase/seeds/reset_to_prod.sql \
  || die "Falha no reset."
ok "dados de demonstração removidos"

# --- reaplicação do seed de produção ---------------------------------
# Idempotente: garante domínio, equipe, integrações e admin, caso o
# reset tenha sido rodado sobre um banco parcialmente configurado.
info "Reaplicando seed de produção"
PGOPTIONS="-c seed.admin_email=${SEED_ADMIN_EMAIL:-wallace@chaveiroformiga.com.br} -c seed.admin_password=${SEED_ADMIN_PASSWORD:-ChaveiroFormiga@2026}" \
  PSQL "$DB_URL" -v ON_ERROR_STOP=1 -q < supabase/seeds/seed_prod.sql \
  || die "Falha ao aplicar o seed de produção."
ok "configuração de produção aplicada"

# --- trilha de auditoria: zerar por último ----------------------------
# O seed_prod acima faz UPSERT em tabelas auditadas (equipe, categorias,
# configuração, integrações) e gera ~80 linhas de auditoria descrevendo o
# próprio provisionamento. Elas não dizem nada sobre a operação da loja e
# atrapalhariam a leitura da trilha no primeiro mês.
#
# Precisa ser DEPOIS do seed: o reset_to_prod.sql também trunca, mas o
# re-seed acontece em seguida e repovoa.
info "Zerando a trilha de auditoria"
PSQL "$DB_URL" -v ON_ERROR_STOP=1 -q -c 'TRUNCATE TABLE public.audit_logs;' \
  || die "Falha ao limpar a auditoria."
ok "auditoria zerada — a trilha começa na primeira ação real"

# --- verificação final ------------------------------------------------
info "Verificando"
FAIL=$(PSQL "$DB_URL" -qtAc "
  SELECT string_agg(msg, ' | ') FROM (
    SELECT 'ainda há comandas'        AS msg WHERE EXISTS (SELECT 1 FROM public.orders)
    UNION ALL
    SELECT 'ainda há clientes'              WHERE EXISTS (SELECT 1 FROM public.customers)
    UNION ALL
    SELECT 'ainda há lançamentos'           WHERE EXISTS (SELECT 1 FROM public.ledger_entries)
    UNION ALL
    SELECT 'ainda há logins de demo'        WHERE EXISTS (SELECT 1 FROM auth.users WHERE email LIKE '%@demo.chaveiroformiga.com.br')
    UNION ALL
    SELECT 'sem administrador ativo'        WHERE NOT EXISTS (SELECT 1 FROM public.profiles WHERE role_key = 'owner' AND is_active)
    UNION ALL
    SELECT 'matriz de permissões vazia'     WHERE NOT EXISTS (SELECT 1 FROM public.role_modules)
    UNION ALL
    SELECT 'equipe vazia'                   WHERE NOT EXISTS (SELECT 1 FROM public.staff WHERE deleted_at IS NULL)
    UNION ALL
    SELECT 'numeração não voltou para 1'    WHERE EXISTS (SELECT 1 FROM public.app_settings WHERE order_next_number <> 1)
    UNION ALL
    SELECT 'integração habilitada'          WHERE EXISTS (SELECT 1 FROM public.integrations WHERE enabled)
    UNION ALL
    SELECT 'trilha de auditoria não vazia'   WHERE EXISTS (SELECT 1 FROM public.audit_logs)
  ) t;
")

[[ -z "$FAIL" ]] || die "Verificação falhou: $FAIL"
ok "banco zerado e íntegro"

NEXT=$(PSQL "$DB_URL" -qtAc "SELECT order_prefix || '-' || lpad(order_next_number::text, 4, '0') FROM public.app_settings;")
ADMIN=$(PSQL "$DB_URL" -qtAc "SELECT email FROM public.profiles WHERE role_key = 'owner' AND is_active ORDER BY created_at LIMIT 1;")

printf '\n%s================================================%s\n' "$GREEN" "$NC"
printf '%s  Sistema pronto para a operação real%s\n' "$GREEN" "$NC"
printf '%s================================================%s\n' "$GREEN" "$NC"
printf '  Login do responsável : %s\n' "$ADMIN"
printf '  Primeira comanda     : %s\n' "$NEXT"
printf '\n  Próximos passos:\n'
printf '    1. Entrar no sistema e TROCAR A SENHA\n'
printf '    2. Configurações → Empresa: conferir dados impressos\n'
printf '    3. Serviços: cadastrar o catálogo real\n'
printf '    4. Configurações → Integrações: configurar WhatsApp\n'
printf '    5. Criar a primeira comanda\n\n'
