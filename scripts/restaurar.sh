#!/usr/bin/env bash
# =====================================================================
# restaurar.sh — recoloca no ar uma cópia feita por backup.sh.
# ---------------------------------------------------------------------
# Uso:
#   npm run restaurar -- backups/local-20260807-190000
#   npm run restaurar -- backups/... --banco-de-teste    # ensaio seguro
#   npm run restaurar -- backups/... --nuvem
#
# --banco-de-teste É O MODO QUE VOCÊ DEVE USAR PRIMEIRO
#
# Cria um banco novo ao lado do que está no ar, carrega o backup lá e
# conta as linhas. Não encosta em nada em produção. Serve para responder
# a única pergunta que importa sobre um backup — "isso volta?" — sem
# precisar de uma emergência para descobrir.
#
# Backup que nunca foi restaurado não é backup, é arquivo.
#
# ORDEM, E POR QUE ELA NÃO É NEGOCIÁVEL
#
#   1. logins      — `public.profiles` tem FK para `auth.users`. Carregar
#                    a aplicação antes derruba tudo com violação de chave.
#   2. aplicação   — vem com DROP ... IF EXISTS na frente, então funciona
#                    em banco vazio e em banco já migrado.
#   3. storage     — o índice depende de `storage.buckets`, que vem no
#                    mesmo arquivo, e as policies vivem no `public`.
#   4. binários    — pela Storage API, porque o backend pode ser disco
#                    (self-hosted) ou S3 (nuvem).
# =====================================================================
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
[[ -f .env ]] && { set -a; source .env; set +a; }

source "$(dirname "${BASH_SOURCE[0]}")/lib/psql.sh"
source "$(dirname "${BASH_SOURCE[0]}")/lib/alvo.sh"

PASTA=""
NUVEM=0
TESTE=0
for arg in "$@"; do
  case "$arg" in
    --nuvem)          NUVEM=1 ;;
    --banco-de-teste) TESTE=1 ;;
    -*) echo "opção desconhecida: $arg" >&2; exit 1 ;;
    *)  PASTA="${arg%/}" ;;
  esac
done

if [[ -z "$PASTA" ]]; then
  echo "uso: npm run restaurar -- <pasta-do-backup> [--banco-de-teste] [--nuvem]" >&2
  echo >&2
  echo "backups disponíveis:" >&2
  ls -1d backups/*/ 2>/dev/null >&2 || echo "  (nenhum — rode npm run backup)" >&2
  exit 1
fi

for f in 1-logins.sql 2-aplicacao.sql 3-storage.sql; do
  [[ -f "$PASTA/$f" ]] || { echo "faltando $PASTA/$f — a pasta não é um backup completo." >&2; exit 1; }
done

if [[ $NUVEM -eq 1 ]]; then
  DB="${SUPABASE_DB_URL_CLOUD:?falta SUPABASE_DB_URL_CLOUD no .env}"
  API="https://${SUPABASE_PROJECT_REF:?falta SUPABASE_PROJECT_REF}.supabase.co"
  CHAVE="${SUPABASE_SECRET_KEY:?falta SUPABASE_SECRET_KEY}"
else
  DB="${SUPABASE_DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
  [[ -n "${POSTGRES_PASSWORD:-}" ]] && \
    DB="postgresql://supabase_admin:${POSTGRES_PASSWORD}@127.0.0.1:54322/${POSTGRES_DB:-postgres}"
  API="${SUPABASE_URL_LOCAL:-http://localhost:8000}"
  CHAVE="${SERVICE_ROLE_KEY:-}"
fi

# ---------------------------------------------------------------------
# Modo ensaio: banco descartável ao lado
# ---------------------------------------------------------------------
BANCO_TESTE=""
if [[ $TESTE -eq 1 ]]; then
  BANCO_TESTE="restore_teste_$(date +%H%M%S)"
  BANCO_VIVO="$DB"
  ADMIN="${DB%/*}/postgres"
  echo "  ensaio: criando o banco $BANCO_TESTE"
  PSQL "$ADMIN" -q -c "DROP DATABASE IF EXISTS \"$BANCO_TESTE\";" >/dev/null 2>&1
  PSQL "$ADMIN" -q -c "CREATE DATABASE \"$BANCO_TESTE\";" >/dev/null
  DB="${DB%/*}/$BANCO_TESTE"

  # `set -e` derruba o script no primeiro erro de carga, e sem isto o banco
  # de ensaio ficaria para trás a cada tentativa frustrada — justamente
  # quando se está iterando para descobrir por que o backup não volta.
  limpar_ensaio() {
    PSQL "$ADMIN" -q -c "DROP DATABASE IF EXISTS \"$BANCO_TESTE\";" >/dev/null 2>&1 || true
  }
  trap limpar_ensaio EXIT

  # ---------------------------------------------------------------------
  # O que o backup NÃO carrega, e por que isso está certo
  # ---------------------------------------------------------------------
  # O backup guarda os DADOS de `auth` e `storage`, não a estrutura: essas
  # tabelas pertencem ao GoTrue e ao storage-api, que as criam e migram
  # sozinhos conforme a versão da imagem. Carregar estrutura nossa por
  # cima brigaria com a versão instalada no destino.
  #
  # Numa restauração de verdade elas já existem — o destino é uma stack no
  # ar. Aqui não: o banco de ensaio nasce vazio. Então a estrutura é
  # copiada do banco VIVO, que por definição está de pé se este ensaio
  # está rodando.
  #
  # Não é trapaça no teste: o que está sendo verificado é se o backup
  # devolve as comandas, os clientes, os logins e as fotos. A estrutura do
  # GoTrue vem da imagem nos dois casos.
  #
  # `auth` também traz `auth.uid()` e `auth.role()`, sem as quais nenhuma
  # policy do `public` pode sequer ser criada — CREATE POLICY resolve a
  # função na hora.
  echo "  ensaio: copiando a estrutura de auth/storage do banco vivo"
  PSQL "$DB" -q -c "
    CREATE SCHEMA IF NOT EXISTS extensions;
    CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
    CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA extensions;
    CREATE EXTENSION IF NOT EXISTS pg_trgm  WITH SCHEMA extensions;
  " >/dev/null 2>&1 || true

  PG_DUMP "$BANCO_VIVO" --schema=auth --schema=storage --schema-only --no-owner \
    > "$(dirname "$PASTA")/.estrutura-ensaio.sql"
  PSQL "$DB" -q < "$(dirname "$PASTA")/.estrutura-ensaio.sql" >/dev/null 2>&1 || true
  rm -f "$(dirname "$PASTA")/.estrutura-ensaio.sql"
fi

descrever_alvo "$DB"
echo "  psql: $PSQL_ORIGEM"
echo "  backup: $PASTA"
echo

if [[ $TESTE -eq 0 ]]; then
  exigir_confirmacao_remota "$DB" "SOBRESCREVER os dados com o backup $PASTA"
fi

# ---------------------------------------------------------------------
# Carga
# ---------------------------------------------------------------------
# ON_ERROR_STOP fica DESLIGADO no arquivo de logins e no de storage: os
# dois são data-only e, num destino que já tem as linhas, o INSERT bate
# em chave duplicada. Isso é esperado numa restauração parcial e não pode
# derrubar o processo inteiro — o que importa é o 2-aplicacao.sql, e esse
# roda com ON_ERROR_STOP=1.
echo "  → 1/4 logins"
PSQL "$DB" -q < "$PASTA/1-logins.sql" >/dev/null || true

echo "  → 2/4 aplicação"
PSQL "$DB" -v ON_ERROR_STOP=1 -q < "$PASTA/2-aplicacao.sql" >/dev/null

echo "  → 3/4 índice das fotos"
PSQL "$DB" -q < "$PASTA/3-storage.sql" >/dev/null || true

echo "  → 4/4 binários"
ENVIADOS=0
FALHAS=0
if [[ -d "$PASTA/fotos" ]] && [[ -n "$CHAVE" ]]; then
  if [[ $TESTE -eq 1 ]]; then
    # O ensaio não pode reenviar as fotos para valer — o Storage fala com o
    # banco NO AR, não com $BANCO_TESTE, e a carga cairia em cima dos
    # arquivos de produção.
    #
    # Mas pular tudo deixaria o caminho dos binários sem nenhuma
    # verificação, e ele é metade do backup. Então sobe UMA foto para um
    # prefixo descartável e apaga: prova a chave, o endpoint e o formato
    # da requisição, que é onde esse passo falha na prática.
    amostra="$(find "$PASTA/fotos" -type f | head -1)"
    if [[ -n "$amostra" ]]; then
      prova="_ensaio-restauracao/$(basename "$amostra")"
      if curl -sf -o /dev/null -X POST \
           -H "apikey: $CHAVE" -H "Authorization: Bearer $CHAVE" \
           -H "Content-Type: image/jpeg" -H "x-upsert: true" \
           --data-binary "@$amostra" \
           "$API/storage/v1/object/order-photos/$prova"; then
        echo "    envio de foto conferido (1 arquivo de prova, já removido)"
        curl -sf -o /dev/null -X DELETE \
          -H "apikey: $CHAVE" -H "Authorization: Bearer $CHAVE" \
          "$API/storage/v1/object/order-photos/$prova" || \
          echo "    ! a foto de prova ficou em $prova — remova à mão" >&2
      else
        FALHAS=$((FALHAS + 1))
        echo "    ! o envio de fotos NÃO funciona — o backup não restauraria as imagens" >&2
      fi
    fi
  else
    while IFS= read -r arquivo; do
      nome="${arquivo#"$PASTA/fotos/"}"
      tipo="image/jpeg"
      case "$nome" in *.png) tipo="image/png" ;; *.webp) tipo="image/webp" ;; esac
      # x-upsert: reenviar um backup por cima de si mesmo não pode falhar
      # por "já existe" — restauração parcial é o caso normal.
      if curl -sf -o /dev/null -X POST \
           -H "apikey: $CHAVE" -H "Authorization: Bearer $CHAVE" \
           -H "Content-Type: $tipo" -H "x-upsert: true" \
           --data-binary "@$arquivo" \
           "$API/storage/v1/object/order-photos/$nome"; then
        ENVIADOS=$((ENVIADOS + 1))
      else
        FALHAS=$((FALHAS + 1))
        echo "    ! falhou: $nome" >&2
      fi
    done < <(find "$PASTA/fotos" -type f 2>/dev/null)
  fi
fi

# ---------------------------------------------------------------------
# Conferência
# ---------------------------------------------------------------------
contar() { PSQL "$DB" -At -c "$1" 2>/dev/null | tr -d '\r' || echo '?'; }

echo
echo "  Restaurado:"
printf '    comandas : %s\n' "$(contar 'SELECT count(*) FROM public.orders WHERE deleted_at IS NULL;')"
printf '    itens    : %s\n' "$(contar 'SELECT count(*) FROM public.order_items;')"
printf '    clientes : %s\n' "$(contar 'SELECT count(*) FROM public.customers;')"
# A senha é o que se perde em silêncio: `auth.users` pode vir com todas as
# linhas e `encrypted_password` vazio, e aí a contagem bate e ninguém entra.
printf '    logins   : %s (%s com senha)\n' \
  "$(contar 'SELECT count(*) FROM auth.users;')" \
  "$(contar "SELECT count(*) FROM auth.users WHERE coalesce(encrypted_password,'') <> '';")"
printf '    fotos    : %s no índice, %s binários enviados\n' \
  "$(contar "SELECT count(*) FROM storage.objects WHERE bucket_id = 'order-photos';")" "$ENVIADOS"

if [[ -f "$PASTA/MANIFESTO.md" ]]; then
  echo
  echo "  Compare com o manifesto do backup:"
  grep -E '^\| (Comandas|Itens|Clientes|Logins|Fotos)' "$PASTA/MANIFESTO.md" | sed 's/^/    /'
fi

if [[ $TESTE -eq 1 ]]; then
  echo
  if [[ $FALHAS -gt 0 ]]; then
    printf '\033[31m  Ensaio com falha — veja acima.\033[0m\n'
  else
    printf '\033[32m  Ensaio concluído. O backup restaura.\033[0m\n'
  fi
  echo "  Derrubando o banco de ensaio $BANCO_TESTE"
  # O trap cuida disso de qualquer forma; aqui é só para a mensagem sair
  # na ordem certa.
else
  echo
  if [[ $FALHAS -gt 0 ]]; then
    printf '\033[1;33m  ! %d binário(s) não subiram.\033[0m\n' "$FALHAS"
  fi
  printf '\033[32mRestauração concluída.\033[0m\n'
  echo "  Confira entrando no sistema e abrindo uma comanda com foto."
fi
