#!/usr/bin/env bash
# =====================================================================
# kong-entrypoint.sh — injeta as chaves no kong.yml e sobe o Kong
# ---------------------------------------------------------------------
# POR QUE NÃO `eval "echo \"$(cat kong.template.yml)\""`
#
# Esse é o truque comum em guias de self-hosting, e ele CORROMPE o YAML:
# o `eval` reinterpreta o conteúdo e remove as aspas dos valores. Um
# comentário como
#     _comment: "GoTrue: /auth/v1/* → http://auth:9999/*"
# vira
#     _comment: GoTrue: /auth/v1/* → http://auth:9999/*
# ou seja, um escalar sem aspas com dois-pontos no meio. O Kong morre com
# "mapping values are not allowed in this context" apontando para uma
# linha de COMENTÁRIO — que não tem nada de errado.
#
# `sed` substitui apenas os placeholders e não toca no resto do arquivo.
# =====================================================================
set -euo pipefail

: "${SUPABASE_ANON_KEY:?SUPABASE_ANON_KEY é obrigatório}"
: "${SUPABASE_SERVICE_KEY:?SUPABASE_SERVICE_KEY é obrigatório}"
: "${DASHBOARD_USERNAME:?DASHBOARD_USERNAME é obrigatório}"
: "${DASHBOARD_PASSWORD:?DASHBOARD_PASSWORD é obrigatório}"

sed \
  -e "s|\$SUPABASE_ANON_KEY|${SUPABASE_ANON_KEY}|g" \
  -e "s|\$SUPABASE_SERVICE_KEY|${SUPABASE_SERVICE_KEY}|g" \
  -e "s|\$DASHBOARD_USERNAME|${DASHBOARD_USERNAME}|g" \
  -e "s|\$DASHBOARD_PASSWORD|${DASHBOARD_PASSWORD}|g" \
  /home/kong/kong.template.yml > /home/kong/kong.yml

exec /docker-entrypoint.sh kong docker-start
