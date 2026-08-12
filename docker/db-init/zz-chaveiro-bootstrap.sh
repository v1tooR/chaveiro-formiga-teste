#!/usr/bin/env bash
# =====================================================================
# zz-chaveiro-bootstrap.sh — migrations e seeds na PRIMEIRA subida do banco
# ---------------------------------------------------------------------
# O entrypoint da imagem supabase/postgres executa os arquivos de
# /docker-entrypoint-initdb.d/ em ordem ALFABÉTICA (ASCII).
#
# O NOME DO ARQUIVO IMPORTA. O prefixo natural seria `99-`, mas em ASCII
# os dígitos vêm ANTES das letras ('9' = 57, 'm' = 109), então `99-...`
# rodaria antes de `migrate.sh` — que é justamente quem cria o schema
# `extensions` e as roles do Supabase. O resultado é um banco sem roles,
# com auth, rest, storage e realtime em loop de restart.
#
# `zz-` garante que este script roda por ÚLTIMO, com o schema base pronto.
#
# Só roda quando o volume está vazio. `docker compose down -v` + `up`
# reproduz o ambiente inteiro daqui — é isso que fecha o critério 4 da
# definição de pronto.
# =====================================================================
set -euo pipefail

# Fora de /docker-entrypoint-initdb.d/ de propósito: aquele diretório
# pertence à imagem supabase/postgres (init-scripts + migrations que criam
# schema `extensions`, roles e senhas). Montar por cima quebra o stack.
MIGRATIONS_DIR=/chaveiro/migrations
SEEDS_DIR=/chaveiro/seeds

# Conecta como supabase_admin: a extensão supautils reatribui a posse dos
# objetos criados por `postgres` para `supabase_admin`, e `postgres` não é
# membro desse papel. Criando já como o dono final, as migrations futuras
# com CREATE OR REPLACE funcionam. Ver scripts/migrate.sh.
PSQL_USER=supabase_admin
PSQL=(psql -v ON_ERROR_STOP=1 --username "$PSQL_USER" --dbname "$POSTGRES_DB" --no-psqlrc -q)

# ---------------------------------------------------------------------
# Senhas das roles de serviço
# ---------------------------------------------------------------------
# ⚠️ PEGADINHA 5: a imagem supabase/postgres CRIA as roles de serviço
# (authenticator, supabase_auth_admin, supabase_storage_admin, ...) mas
# NÃO define senha para elas. Cada container se conecta com
# POSTGRES_PASSWORD, então sem este bloco auth, rest e storage entram em
# loop com `password authentication failed`, enquanto o Postgres em si
# aparece saudável — o que faz o problema parecer ser dos containers.
#
# No repositório oficial de self-hosting isso vive num arquivo separado
# (volumes/db/roles.sql).
echo "==> [chaveiro] definindo senhas das roles de serviço"
for role in authenticator supabase_auth_admin supabase_storage_admin supabase_functions_admin supabase_admin pgbouncer; do
  "${PSQL[@]}" -c "DO \$\$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '$role') THEN
        EXECUTE format('ALTER ROLE %I WITH PASSWORD %L', '$role', '$POSTGRES_PASSWORD');
      END IF;
    END
  \$\$;" >/dev/null
done

# ---------------------------------------------------------------------
# Schema de infraestrutura do Realtime
# ---------------------------------------------------------------------
# ⚠️ PEGADINHA 4 (não documentada nos guias): o container do Realtime sobe
# com `DB_AFTER_CONNECT_QUERY: SET search_path TO _realtime` e roda as
# próprias migrations Ecto ali dentro. Mas ele NÃO cria o schema — a
# imagem supabase/postgres também não. No repositório oficial de
# self-hosting isso vive num arquivo separado (volumes/db/realtime.sql).
#
# Sem este bloco: `ERROR: no schema has been selected to create in`, o
# container entra em loop de restart e o Realtime nunca funciona — com um
# stack trace de Elixir que não diz qual é o problema real.
echo "==> [chaveiro] criando schema _realtime"
"${PSQL[@]}" <<-SQL
	CREATE SCHEMA IF NOT EXISTS _realtime;
	ALTER SCHEMA _realtime OWNER TO supabase_admin;
	GRANT ALL ON SCHEMA _realtime TO supabase_admin;
SQL

echo "==> [chaveiro] aplicando migrations"
if [[ -d "$MIGRATIONS_DIR" ]]; then
  # Ordem lexicográfica = ordem cronológica (prefixo de timestamp).
  for f in $(find "$MIGRATIONS_DIR" -maxdepth 1 -name '*.sql' | sort); do
    echo "    → $(basename "$f")"
    "${PSQL[@]}" -f "$f"
  done
else
  echo "    !! $MIGRATIONS_DIR não encontrado" >&2
  exit 1
fi

echo "==> [chaveiro] aplicando seed de produção"
PGOPTIONS="-c seed.admin_email=${SEED_ADMIN_EMAIL:-wallace@chaveiroformiga.com.br} -c seed.admin_password=${SEED_ADMIN_PASSWORD:-ChaveiroFormiga@2026}" \
  "${PSQL[@]}" -f "$SEEDS_DIR/seed_prod.sql"

# Dados de demonstração: só quando pedidos explicitamente.
# Em produção, SEED_DEMO fica em `false` e o banco sobe vazio de operação.
if [[ "${SEED_DEMO:-true}" == "true" ]]; then
  echo "==> [chaveiro] aplicando seed de demonstração"
  "${PSQL[@]}" -f "$SEEDS_DIR/seed_demo.sql"
else
  echo "==> [chaveiro] SEED_DEMO=false — banco sem dados de demonstração"
fi

echo "==> [chaveiro] bootstrap concluído"
