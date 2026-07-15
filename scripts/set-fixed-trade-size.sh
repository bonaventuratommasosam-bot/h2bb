#!/bin/bash
set -euo pipefail
PROFILE="${1:?usage: set-fixed-trade-size.sh /path/to/client-trade-N [size]}"
SIZE="${2:-0.01}"
ORDER_ID="${ORDER_ID:-}"
SERVICE_USER="${SERVICE_USER:-hermes}"
ENGINE_UNIT="${ENGINE_UNIT:-hermes-client-trade-${ORDER_ID}}"

python3 - "$PROFILE/strategy.json" "$SIZE" <<'PY'
import json, datetime, sys
from pathlib import Path
p, size = Path(sys.argv[1]), float(sys.argv[2])
s = json.loads(p.read_text())
s["amountPerTrade"] = size
s["scaleInEnabled"] = False
s["updatedAt"] = datetime.datetime.now(datetime.UTC).isoformat().replace("+00:00", "Z")
p.write_text(json.dumps(s, indent=2))
print(f"amountPerTrade={size}, scaleInEnabled=False")
PY

[[ -f /tmp/pro-engine.js ]] && cp /tmp/pro-engine.js "$PROFILE/pro-engine.js"
chown "${SERVICE_USER}:${SERVICE_USER}" "$PROFILE/pro-engine.js" "$PROFILE/strategy.json" 2>/dev/null || true
[[ -n "$ENGINE_UNIT" ]] && systemctl restart "$ENGINE_UNIT"
sleep 3
[[ -n "$ENGINE_UNIT" ]] && systemctl is-active "$ENGINE_UNIT"
python3 -c "import json; s=json.load(open('$PROFILE/strategy.json')); print('size', s['amountPerTrade'], 'scaleIn', s.get('scaleInEnabled'))"