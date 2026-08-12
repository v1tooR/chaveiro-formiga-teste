#!/usr/bin/env bash
# =====================================================================
# backup.sh — cópia completa e restaurável do sistema.
# ---------------------------------------------------------------------
# Uso:
#   npm run backup              # banco local
#   npm run backup -- --nuvem   # Supabase Cloud (pede confirmação)
#
# O QUE ENTRA, E POR QUE CADA PARTE
#
# Um dump do schema `public` sozinho NÃO restaura este sistema. Faltariam
# três coisas, e a falta de qualquer uma torna a cópia inútil:
#
#   1. `auth.users` / `auth.identities` — os LOGINS. Sem elas, `profiles`
#      fica com FK apontando para usuário que não existe e ninguém entra.
#   2. `storage.objects` — o índice das fotos. Sem ele o Storage não sabe
#      que os arquivos existem, mesmo com os bytes no lugar.
#   3. Os BINÁRIOS das fotos. Não estão no Postgres. Um dump de banco,
#      por mais completo, não leva nenhum byte de imagem junto — e as
#      fotos são a prova do estado em que a peça foi recebida, que é
#      justamente o que o sistema existe para guardar.
#
# O schema `public` sai com --clean --if-exists: a restauração derruba o
# que existir antes de recriar, então funciona tanto em banco vazio
# quanto em banco já migrado. Sem isso, restaurar exigiria um banco
# recém-criado — e é sempre num momento ruim que se descobre isso.
#
# --no-owner porque a extensão supautils reatribui a posse de tudo para
# `supabase_admin`; carregar ALTER OWNER só produziria erro. As GRANTs
# CONTINUAM no dump (nada de --no-privileges): elas são a autorização do
# sistema, e sem elas o `authenticated` perde acesso a tudo.
# =====================================================================
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
[[ -f .env ]] && { set -a; source .env; set +a; }

source "$(dirname "${BASH_SOURCE[0]}")/lib/psql.sh"
source "$(dirname "${BASH_SOURCE[0]}")/lib/alvo.sh"

NUVEM=0
[[ "${1:-}" == "--nuvem" ]] && NUVEM=1

if [[ $NUVEM -eq 1 ]]; then
  DB="${SUPABASE_DB_URL_CLOUD:?falta SUPABASE_DB_URL_CLOUD no .env}"
  API="https://${SUPABASE_PROJECT_REF:?falta SUPABASE_PROJECT_REF}.supabase.co"
  CHAVE="${SUPABASE_SECRET_KEY:?falta SUPABASE_SECRET_KEY}"
  ROTULO="nuvem"
else
  DB="${SUPABASE_DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
  [[ -n "${POSTGRES_PASSWORD:-}" ]] && \
    DB="postgresql://supabase_admin:${POSTGRES_PASSWORD}@127.0.0.1:54322/${POSTGRES_DB:-postgres}"
  API="${SUPABASE_URL_LOCAL:-http://localhost:8000}"
  CHAVE="${SERVICE_ROLE_KEY:?falta SERVICE_ROLE_KEY no .env — rode npm run keys}"
  ROTULO="local"
fi

CARIMBO="$(date +%Y%m%d-%H%M%S)"
DESTINO="backups/${ROTULO}-${CARIMBO}"

descrever_alvo "$DB"
echo "  psql: $PSQL_ORIGEM"
echo "  destino: $DESTINO"
echo

mkdir -p "$DESTINO/fotos"

# ---------------------------------------------------------------------
# 1. Logins
# ---------------------------------------------------------------------
# Data-only e restrito às duas tabelas: o resto do schema `auth` pertence
# ao GoTrue e é recriado pela imagem. Restaurar o schema inteiro brigaria
# com a versão do GoTrue no destino.
echo "  → logins (auth.users, auth.identities)"
PG_DUMP "$DB" --data-only --no-owner \
  --table=auth.users --table=auth.identities \
  > "$DESTINO/1-logins.sql"

# ---------------------------------------------------------------------
# 2. Dados e estrutura da aplicação
# ---------------------------------------------------------------------
echo "  → aplicação (schema public: estrutura + dados)"
PG_DUMP "$DB" --schema=public --clean --if-exists --no-owner \
  > "$DESTINO/2-aplicacao.sql"

# ---------------------------------------------------------------------
# 3. Índice do Storage
# ---------------------------------------------------------------------
echo "  → índice das fotos (storage.buckets, storage.objects)"
PG_DUMP "$DB" --data-only --no-owner \
  --table=storage.buckets --table=storage.objects \
  > "$DESTINO/3-storage.sql"

# ---------------------------------------------------------------------
# 4. Os binários
# ---------------------------------------------------------------------
# A lista vem do banco e os bytes vêm da Storage API: é o único jeito que
# funciona igual no self-hosted (backend `file`, num volume Docker) e na
# nuvem (backend S3, sem acesso ao disco).
echo "  → binários das fotos"
LISTA="$DESTINO/.objetos.txt"
PSQL "$DB" -At -c \
  "SELECT name FROM storage.objects WHERE bucket_id = 'order-photos' ORDER BY name;" \
  | tr -d '\r' > "$LISTA"

TOTAL=0
FALHAS=0
while IFS= read -r nome; do
  [[ -z "$nome" ]] && continue
  alvo="$DESTINO/fotos/$nome"
  mkdir -p "$(dirname "$alvo")"
  if curl -sfL -o "$alvo" \
       -H "apikey: $CHAVE" -H "Authorization: Bearer $CHAVE" \
       "$API/storage/v1/object/order-photos/$nome"; then
    TOTAL=$((TOTAL + 1))
  else
    FALHAS=$((FALHAS + 1))
    rm -f "$alvo"
    echo "    ! falhou: $nome" >&2
  fi
done < "$LISTA"
rm -f "$LISTA"

# ---------------------------------------------------------------------
# 5. Manifesto
# ---------------------------------------------------------------------
contar() { PSQL "$DB" -At -c "$1" 2>/dev/null | tr -d '\r' || echo '?'; }

COMANDAS=$(contar "SELECT count(*) FROM public.orders WHERE deleted_at IS NULL;")
ITENS=$(contar "SELECT count(*) FROM public.order_items;")
CLIENTES=$(contar "SELECT count(*) FROM public.customers;")
USUARIOS=$(contar "SELECT count(*) FROM auth.users;")
OBJETOS=$(contar "SELECT count(*) FROM storage.objects WHERE bucket_id = 'order-photos';")

cat > "$DESTINO/MANIFESTO.md" <<MANIFESTO
# Backup — $ROTULO — $(date '+%d/%m/%Y %H:%M:%S')

| Conteúdo | Quantidade |
|---|---|
| Comandas (não excluídas) | $COMANDAS |
| Itens de comanda | $ITENS |
| Clientes | $CLIENTES |
| Logins | $USUARIOS |
| Fotos no índice | $OBJETOS |
| Binários copiados | $TOTAL |
| Binários que falharam | $FALHAS |

Origem: \`$(alvo_legivel "$DB")\`

## Restaurar

\`\`\`bash
npm run restaurar -- $DESTINO
\`\`\`

A ordem dos arquivos é obrigatória e o script cuida dela: logins antes da
aplicação (\`profiles\` tem FK para \`auth.users\`), e o índice do Storage
por último.

## Conferir que este backup presta

Sem restaurar, dá para checar que os arquivos não saíram vazios:

\`\`\`bash
grep -c "INSERT INTO\|COPY " $DESTINO/2-aplicacao.sql
ls -R $DESTINO/fotos | head
\`\`\`

Mas isso não é teste de backup. **Teste de verdade é restaurar** — e o
\`restaurar.sh\` tem \`--banco-de-teste\`, que carrega tudo num banco
separado sem tocar no que está no ar.
MANIFESTO

echo
if [[ $FALHAS -gt 0 ]]; then
  printf '\033[1;33m  ! %d binário(s) não vieram. O backup está INCOMPLETO.\033[0m\n' "$FALHAS"
fi
printf '\033[32mBackup em %s\033[0m\n' "$DESTINO"
echo "  $COMANDAS comandas · $CLIENTES clientes · $USUARIOS logins · $TOTAL fotos"
echo
echo "  Leia $DESTINO/MANIFESTO.md"
