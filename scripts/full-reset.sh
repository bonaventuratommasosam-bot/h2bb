#!/bin/bash
set -euo pipefail
PROFILE="${1:?usage: full-reset.sh /path/to/client-trade-N}"
ORDER_ID="${ORDER_ID:-}"
SERVICE_USER="${SERVICE_USER:-hermes}"
ENGINE_UNIT="${ENGINE_UNIT:-hermes-client-trade-${ORDER_ID}}"
BOT_UNIT="${BOT_UNIT:-hermes-client-trade-${ORDER_ID}-bot}"
ENGINE_PORT="${ENGINE_PORT:-40001}"

echo "=== Reset bot in $PROFILE ==="

systemctl stop "$ENGINE_UNIT" "$BOT_UNIT" 2>/dev/null || true
sleep 1

rm -f "$PROFILE/wallet.json"
echo '{}' > "$PROFILE/setup-sessions.json"
echo '{}' > "$PROFILE/conversation-history.json"

cat > "$PROFILE/proactive-state.json" <<'EOF'
{
  "lastProactiveAt": null,
  "lastBriefingDay": null,
  "lastSignalScore": null,
  "lastPositionAlertAt": null,
  "lastLiveNudgeAt": null,
  "lastInsightAt": null,
  "messagesSent": 0
}
EOF

cat > "$PROFILE/risk-state.json" <<'EOF'
{
  "dayKey": null,
  "dayStartEquity": null,
  "dayPnl": 0,
  "peakEquity": null,
  "consecutiveLosses": 0,
  "cooldownUntil": null,
  "circuitBreaker": false,
  "circuitReason": null,
  "lastUpdated": null
}
EOF

python3 <<PY
import json, datetime
from pathlib import Path
p = Path("$PROFILE")
default = json.loads((p / "strategy.default.json").read_text())
default["active"] = False
default["lastTradeAt"] = None
default["lastSignal"] = None
default["trailingPeak"] = None
default["tp1Taken"] = False
default["scaleInPending"] = False
default["positionLeg"] = None
default["createdAt"] = datetime.datetime.utcnow().isoformat() + "Z"
default["updatedAt"] = default["createdAt"]
(p / "strategy.json").write_text(json.dumps(default, indent=2))
PY

cat > "$PROFILE/balance.json" <<'EOF'
{
  "asset": "USDC",
  "amount": 1000,
  "lastUpdated": null
}
EOF
rm -f "$PROFILE/trades.jsonl"
rm -f "$PROFILE/order.json"

chown "${SERVICE_USER}:${SERVICE_USER}" "$PROFILE"/*.json 2>/dev/null || true
chmod 600 "$PROFILE"/*.json 2>/dev/null || true

systemctl start "$ENGINE_UNIT" "$BOT_UNIT" 2>/dev/null || true
sleep 3

echo "=== Status ==="
systemctl is-active "$ENGINE_UNIT" 2>/dev/null || true
systemctl is-active "$BOT_UNIT" 2>/dev/null || true
curl -s "http://127.0.0.1:${ENGINE_PORT}/wallet/status" || true
echo
echo "=== DONE reset ==="