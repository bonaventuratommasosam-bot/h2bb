#!/bin/bash
set -euo pipefail

PROFILE="${1:?usage: unblock-autonomous-trading.sh /path/to/client-trade-N}"
ORDER_ID="${ORDER_ID:-}"
SERVICE_USER="${SERVICE_USER:-hermes}"
ENGINE_UNIT="${ENGINE_UNIT:-hermes-client-trade-${ORDER_ID}}"
ENGINE_PORT="${ENGINE_PORT:-40001}"

EQUITY="$(curl -s "http://127.0.0.1:${ENGINE_PORT}/status" | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d["balance"]["usdc"])')"
echo "Current USDC equity: ${EQUITY}"

if [[ -f /tmp/index.js ]]; then
  cp /tmp/index.js "${PROFILE}/index.js"
  chown "${SERVICE_USER}:${SERVICE_USER}" "${PROFILE}/index.js"
fi

if [[ -f "${PROFILE}/trades.jsonl" ]]; then
  cp "${PROFILE}/trades.jsonl" "${PROFILE}/trades.jsonl.bak-demo-$(date +%Y%m%d)"
  : > "${PROFILE}/trades.jsonl"
fi

NOW="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
TODAY="$(date +%Y-%m-%d)"
cat > "${PROFILE}/risk-state.json" <<EOF
{
  "dayKey": "${TODAY}",
  "dayStartEquity": ${EQUITY},
  "dayPnl": 0,
  "peakEquity": ${EQUITY},
  "consecutiveLosses": 0,
  "cooldownUntil": null,
  "circuitBreaker": false,
  "circuitReason": null,
  "lastUpdated": "${NOW}"
}
EOF

python3 - "${PROFILE}/strategy.json" <<'PY'
import json, datetime, sys
from pathlib import Path
p = Path(sys.argv[1])
s = json.loads(p.read_text())
s["active"] = True
s["lastSignal"] = None
s["updatedAt"] = datetime.datetime.utcnow().isoformat() + "Z"
p.write_text(json.dumps(s, indent=2))
PY

chown "${SERVICE_USER}:${SERVICE_USER}" "${PROFILE}/risk-state.json" "${PROFILE}/strategy.json" "${PROFILE}/trades.jsonl" 2>/dev/null || true
chmod 600 "${PROFILE}/risk-state.json" "${PROFILE}/strategy.json" 2>/dev/null || true

[[ -n "$ENGINE_UNIT" ]] && systemctl restart "$ENGINE_UNIT"
sleep 4

echo "=== VERIFY ==="
[[ -n "$ENGINE_UNIT" ]] && systemctl is-active "$ENGINE_UNIT"
curl -s "http://127.0.0.1:${ENGINE_PORT}/status"
echo
cat "${PROFILE}/risk-state.json"
echo
[[ -n "$ENGINE_UNIT" ]] && journalctl -u "$ENGINE_UNIT" --since "1 min ago" --no-pager | tail -15