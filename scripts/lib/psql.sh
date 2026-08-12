#!/usr/bin/env bash
# =====================================================================
# psql.sh — define PSQL() usando o cliente local ou o do container.
# ---------------------------------------------------------------------
# A máquina do operador raramente tem o cliente do PostgreSQL instalado —
# esta mesma sessão travou num `psql: command not found` ao rodar
# `npm run db:migrate`. Como o banco de desenvolvimento já roda em
# container, o psql de lá serve, inclusive para falar com o Supabase
# Cloud: psql é só um cliente, o alvo vem da URL.
#
# reset-to-prod.sh já fazia isso; migrate.sh e seed.sh não, e por isso
# quebravam numa instalação limpa. Agora os quatro compartilham daqui.
#
# Uso:
#   source "$(dirname "${BASH_SOURCE[0]}")/lib/psql.sh"
#   PSQL "$DB" -v ON_ERROR_STOP=1 -f arquivo.sql
# =====================================================================

DB_CONTAINER="${DB_CONTAINER:-chaveiro-db}"

# ---------------------------------------------------------------------
# O endereço do banco muda conforme QUEM executa o cliente
# ---------------------------------------------------------------------
# `SUPABASE_DB_URL` aponta para `127.0.0.1:54322`, que é a porta publicada
# no HOST. Mas quando não há psql na máquina, o comando roda DENTRO do
# container do banco — e lá `54322` não existe: o Postgres escuta na 5432.
#
# O sintoma é "Connection refused" numa stack que está no ar, o que manda
# quem depura investigar o container errado. Foi assim que `db:migrate`
# quebrou numa instalação limpa.
#
# A troca vale só para endereço local. URL da nuvem passa intacta — o
# container tem rede e psql é só um cliente.
_alvo_do_cliente() {
  local url="$1"
  case "$url" in
    postgres://*|postgresql://*)
      printf '%s' "$url" | sed -E 's#@(127\.0\.0\.1|localhost):[0-9]+/#@127.0.0.1:5432/#'
      ;;
    *) printf '%s' "$url" ;;
  esac
}

if command -v psql >/dev/null 2>&1; then
  PSQL() { psql "$@"; }
  PG_DUMP() { pg_dump "$@"; }
  PSQL_ORIGEM="cliente local"
elif docker exec "$DB_CONTAINER" true >/dev/null 2>&1; then
  # -i repassa stdin: os .sql chegam por redirecionamento em vários pontos.
  PSQL() {
    local alvo; alvo="$(_alvo_do_cliente "$1")"; shift
    docker exec -i -e PGOPTIONS="${PGOPTIONS:-}" "$DB_CONTAINER" psql "$alvo" "$@"
  }
  # Sem -t: com TTY o docker traduz LF em CRLF e o dump sai corrompido.
  PG_DUMP() {
    local alvo; alvo="$(_alvo_do_cliente "$1")"; shift
    docker exec -i "$DB_CONTAINER" pg_dump "$alvo" "$@"
  }
  PSQL_ORIGEM="container $DB_CONTAINER"
else
  echo "psql não encontrado e o container $DB_CONTAINER não está de pé." >&2
  echo "Suba o ambiente (npm run db:up) ou instale o cliente do PostgreSQL." >&2
  exit 1
fi
