#!/usr/bin/env bash
# =====================================================================
# alvo.sh — descobre contra QUAL banco um script está prestes a rodar e
#           exige confirmação quando não é o local.
# ---------------------------------------------------------------------
# Existe porque o projeto passou a apontar para o Supabase Cloud. Antes,
# `npm run db:reset:prod` só podia destruir um container descartável; um
# `docker compose down -v` reconstruía tudo em dois minutos.
#
# Agora o mesmo comando, com o mesmo nome, apaga a base da loja. A troca
# de alvo aconteceu numa variável de ambiente, não no comando — quem
# digita não vê a diferença. Este arquivo faz a diferença aparecer.
#
# Uso:
#   source "$(dirname "${BASH_SOURCE[0]}")/lib/alvo.sh"
#   descrever_alvo "$DB"          # imprime host/porta/ambiente
#   exigir_confirmacao_remota "$DB" "apagar todos os dados"
# =====================================================================

# Devolve "local" ou "remoto" para uma URL de conexão.
classificar_alvo() {
  local url="$1"
  case "$url" in
    *@127.0.0.1:*|*@localhost:*|*@db:*|*@host.docker.internal:*) echo "local" ;;
    *) echo "remoto" ;;
  esac
}

# Extrai host:porta sem expor a senha.
alvo_legivel() {
  local url="$1"
  # postgresql://usuario:senha@host:porta/banco → usuario@host:porta/banco
  printf '%s' "$url" | sed -E 's#^[a-z+]+://([^:]+):[^@]*@#\1@#'
}

descrever_alvo() {
  local url="$1" tipo
  tipo="$(classificar_alvo "$url")"
  if [[ "$tipo" == "local" ]]; then
    printf '  alvo: %s  \033[0;32m[local]\033[0m\n' "$(alvo_legivel "$url")"
  else
    printf '  alvo: %s  \033[1;31m[REMOTO — Supabase Cloud]\033[0m\n' "$(alvo_legivel "$url")"
  fi
}

# Aborta se o alvo for remoto e o operador não confirmar digitando o
# nome do projeto. Nada de [s/N]: uma tecla é fácil demais de apertar por
# reflexo, e o custo do engano aqui é a base da loja.
exigir_confirmacao_remota() {
  local url="$1" acao="${2:-esta operação}"
  [[ "$(classificar_alvo "$url")" == "remoto" ]] || return 0

  # CI e automação: variável explícita, nunca --yes genérico.
  if [[ "${PERMITIR_ALVO_REMOTO:-0}" == "1" ]]; then
    printf '\033[1;33m  ! alvo remoto liberado por PERMITIR_ALVO_REMOTO=1\033[0m\n'
    return 0
  fi

  local ref="${SUPABASE_PROJECT_REF:-desconhecido}"
  printf '\n\033[1;31m╔══════════════════════════════════════════════════════════╗\033[0m\n'
  printf '\033[1;31m║  ATENÇÃO — o alvo NÃO é o banco local                     ║\033[0m\n'
  printf '\033[1;31m╚══════════════════════════════════════════════════════════╝\033[0m\n'
  printf '  Você está prestes a %s em:\n\n' "$acao"
  printf '    %s\n' "$(alvo_legivel "$url")"
  printf '    projeto: %s\n\n' "$ref"
  printf '  Isto atinge dados REAIS da operação. Não há desfazer.\n\n'
  printf '  Para prosseguir, digite o ref do projeto (%s): ' "$ref"

  local resposta
  read -r resposta </dev/tty || resposta=""
  if [[ "$resposta" != "$ref" ]]; then
    printf '\n\033[0;31m  ✗ abortado — o texto não confere.\033[0m\n' >&2
    exit 1
  fi
  printf '\n'
}
