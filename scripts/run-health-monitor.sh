#!/usr/bin/env bash
# Wrapper cron — carica token Telegram da profilo h2bb + avvia monitor
set -euo pipefail

DATA_DIR="${DATA_DIR:-./data}"
H2BB_ENV="./.env"
TRADE_ENV="$DATA_DIR/.env"

export DATA_DIR
export ENGINE_URL="${ENGINE_URL:-http://127.0.0.1:40001}"

# Token Telegram @H2BBBOT (profilo Hermes h2bb)
if [[ -f "$H2BB_ENV" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$H2BB_ENV"
  set +a
fi

# DeepSeek / altre variabili engine
if [[ -f "$TRADE_ENV" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$TRADE_ENV"
  set +a
fi

# Chat ID da wallet se non in env
if [[ -z "${TELEGRAM_CHAT_ID:-}" && -z "${ADMIN_CHAT_ID:-}" ]]; then
  TELEGRAM_CHAT_ID="$(python3 -c "import json; print(json.load(open('$DATA_DIR/wallet.json')).get('ownerChatId',''))" 2>/dev/null || true)"
  export TELEGRAM_CHAT_ID
fi

cd "$DATA_DIR"
/usr/bin/node "$DATA_DIR/scripts/health-monitor.js" >> "$DATA_DIR/cache/health-monitor.log" 2>&1