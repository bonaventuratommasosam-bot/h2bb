#!/usr/bin/env bash
# =============================================================================
# watchdog-heartbeat.sh
# Controlla cache/heartbeat.json. Se il battito e' piu' vecchio di MAX_STALE_MS
# (default 180000 = 3 tick mancati a 45s), riavvia il service e avvisa.
# =============================================================================

set -euo pipefail

DATA_DIR="${DATA_DIR:-./data}"
SERVICE="${SERVICE:-hermes-client-trade-1}"
MAX_STALE_MS="${MAX_STALE_MS:-180000}"
HEARTBEAT_FILE="${HEARTBEAT_FILE:-$DATA_DIR/cache/heartbeat.json}"
LOG_TAG="[WATCHDOG]"

log() {
  echo "$LOG_TAG $(date '+%Y-%m-%d %H:%M:%S') $*"
}

if [[ ! -f "$HEARTBEAT_FILE" ]]; then
  log "Heartbeat assente ($HEARTBEAT_FILE). Il service e' attivo?"
  if ! systemctl is-active --quiet "$SERVICE"; then
    log "Service $SERVICE NON attivo -> restart"
    systemctl restart "$SERVICE" || log "ERRORE: restart fallito"
  else
    log "Service attivo ma nessun heartbeat ancora scritto - attendo prossimo giro"
  fi
  exit 0
fi

TS_MS="$(grep -o '"ts"[[:space:]]*:[[:space:]]*[0-9]\+' "$HEARTBEAT_FILE" | grep -o '[0-9]\+' | head -n1 || true)"

if [[ -z "${TS_MS:-}" ]]; then
  log "Impossibile leggere 'ts' da heartbeat (file corrotto?). Restart precauzionale di $SERVICE"
  systemctl restart "$SERVICE" || log "ERRORE: restart fallito"
  exit 0
fi

NOW_MS="$(($(date +%s%3N)))"
AGE_MS="$(( NOW_MS - TS_MS ))"

if (( AGE_MS > MAX_STALE_MS )); then
  log "Heartbeat STALE: ${AGE_MS}ms > ${MAX_STALE_MS}ms -> restart $SERVICE"
  systemctl restart "$SERVICE" || log "ERRORE: restart fallito"

  if [[ -n "${TELEGRAM_BOT_TOKEN:-}" && -n "${ADMIN_CHAT_ID:-}" ]]; then
    MSG="Watchdog: heartbeat fermo da $((AGE_MS/1000))s su ${SERVICE}. Riavvio eseguito."
    curl -s -m 10 -X POST \
      "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
      -d "chat_id=${ADMIN_CHAT_ID}" \
      -d "text=${MSG}" >/dev/null 2>&1 || log "Alert Telegram fallito"
  fi
else
  log "OK - heartbeat fresco (${AGE_MS}ms fa)"
fi

exit 0
