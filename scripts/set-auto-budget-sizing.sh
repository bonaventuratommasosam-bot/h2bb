#!/bin/bash
set -euo pipefail
PROFILE="${1:?usage: set-auto-budget-sizing.sh /path/to/client-trade-N}"
ORDER_ID="${ORDER_ID:-}"
SERVICE_USER="${SERVICE_USER:-hermes}"
ENGINE_UNIT="${ENGINE_UNIT:-hermes-client-trade-${ORDER_ID}}"
ENGINE_PORT="${ENGINE_PORT:-40001}"

python3 - "$PROFILE/strategy.json" <<'PY'
import json, datetime
from pathlib import Path
p = Path(__import__('sys').argv[1])
s = json.loads(p.read_text())
s["autoSize"] = True
s.pop("amountPerTrade", None)
s["maxPositionPercent"] = 90
s["cashReservePercent"] = 8
s["scaleInEnabled"] = False
s["riskPerTradePercent"] = 0.5
s["active"] = True
s["updatedAt"] = datetime.datetime.now(datetime.UTC).isoformat().replace("+00:00", "Z")
p.write_text(json.dumps(s, indent=2))
print("autoSize=True, maxPosition=90%, reserve=8%")
PY

for f in pro-engine.js risk-manager.js engine-context-sync.js; do
  [[ -f "/tmp/$f" ]] && cp "/tmp/$f" "$PROFILE/$f"
done
chown "${SERVICE_USER}:${SERVICE_USER}" "$PROFILE/pro-engine.js" "$PROFILE/risk-manager.js" "$PROFILE/engine-context-sync.js" "$PROFILE/strategy.json" 2>/dev/null || true
[[ -n "$ENGINE_UNIT" ]] && systemctl restart "$ENGINE_UNIT"
sleep 35
curl -s "http://127.0.0.1:${ENGINE_PORT}/wallet/status"
echo
[[ -n "$ENGINE_UNIT" ]] && journalctl -u "$ENGINE_UNIT" --since "1 min ago" --no-pager | grep -E 'PRO|Size auto' | tail -5