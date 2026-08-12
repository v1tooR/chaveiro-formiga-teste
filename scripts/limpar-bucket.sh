#!/usr/bin/env bash
# =====================================================================
# limpar-bucket.sh — esvazia o bucket order-photos pela Storage API.
# ---------------------------------------------------------------------
# Uso:  bash scripts/limpar-bucket.sh [--sim]
#       (sem --sim só lista o que apagaria)
#
# POR QUE EXISTE, E POR QUE RODA ANTES DO RESET
#
# 1. O Supabase Cloud recusa DELETE direto em storage.objects — a trigger
#    `storage.protect_delete()` manda usar a Storage API.
#
# 2. A policy `order_photos_storage_delete` só autoriza apagar foto cujo
#    caminho aponta para uma comanda VIVA. Depois do TRUNCATE do reset não
#    existe comanda nenhuma, a policy nega tudo, e as fotos viram binário
#    órfão que nem o responsável remove pela aplicação. Medido: HTTP 400
#    com a sessão do owner, 200 só com a service key.
#
# Por isso este script usa a SERVICE KEY (que ignora a RLS) e deve rodar
# ANTES do reset, enquanto as comandas ainda existem — ou depois, para
# recolher órfãos deixados por um reset antigo.
#
# Precisa no .env:
#   SUPABASE_PROJECT_REF
#   SUPABASE_SECRET_KEY     (sb_secret_… — ignora TODA a RLS)
# =====================================================================
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
[[ -f .env ]] && { set -a; source .env; set +a; }

RED=$'\033[0;31m'; GREEN=$'\033[0;32m'; YELLOW=$'\033[1;33m'; NC=$'\033[0m'
die() { printf '%s  ✗%s %s\n' "$RED" "$NC" "$*" >&2; exit 1; }

SIM=0
[[ "${1:-}" == "--sim" ]] && SIM=1

: "${SUPABASE_PROJECT_REF:?falta SUPABASE_PROJECT_REF no .env}"
: "${SUPABASE_SECRET_KEY:?falta SUPABASE_SECRET_KEY no .env (Settings → API Keys)}"

URL="https://${SUPABASE_PROJECT_REF}.supabase.co/storage/v1"
BUCKET="${BUCKET:-order-photos}"

# A Storage API lista por prefixo e não desce sozinha na árvore; o
# caminho é <order_id>/<arquivo>, então são dois níveis.
listar() {
  curl -s -X POST "$URL/object/list/$BUCKET" \
    -H "apikey: $SUPABASE_SECRET_KEY" -H "Authorization: Bearer $SUPABASE_SECRET_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"prefix\":\"${1:-}\",\"limit\":1000}"
}

ARQUIVOS=()
while read -r pasta; do
  [[ -z "$pasta" ]] && continue
  while read -r arq; do
    [[ -z "$arq" ]] && continue
    ARQUIVOS+=("$pasta/$arq")
  done < <(listar "$pasta/" | python3 -c 'import sys,json
try:
    for o in json.load(sys.stdin):
        if o.get("id"): print(o["name"])
except Exception: pass')
done < <(listar "" | python3 -c 'import sys,json
try:
    for o in json.load(sys.stdin): print(o["name"])
except Exception: pass')

if [[ ${#ARQUIVOS[@]} -eq 0 ]]; then
  printf '%s  ✓%s bucket %s já está vazio\n' "$GREEN" "$NC" "$BUCKET"; exit 0
fi

printf '  %s objeto(s) em %s:\n' "${#ARQUIVOS[@]}" "$BUCKET"
printf '    %s\n' "${ARQUIVOS[@]}"

if [[ $SIM -eq 0 ]]; then
  printf '\n%s  !%s simulação — nada foi apagado. Rode com --sim para apagar de verdade.\n' "$YELLOW" "$NC"
  exit 0
fi

CORPO=$(printf '%s\n' "${ARQUIVOS[@]}" | python3 -c 'import sys,json; print(json.dumps({"prefixes":[l.strip() for l in sys.stdin if l.strip()]}))')
COD=$(curl -s -o /tmp/cf-del.json -w '%{http_code}' -X DELETE "$URL/object/$BUCKET" \
  -H "apikey: $SUPABASE_SECRET_KEY" -H "Authorization: Bearer $SUPABASE_SECRET_KEY" \
  -H "Content-Type: application/json" -d "$CORPO")

[[ "$COD" == "200" ]] || die "Storage API devolveu $COD: $(head -c 200 /tmp/cf-del.json)"
rm -f /tmp/cf-del.json
printf '%s  ✓%s %s objeto(s) removido(s)\n' "$GREEN" "$NC" "${#ARQUIVOS[@]}"
