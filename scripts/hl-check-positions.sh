#!/bin/bash
# Hyperliquid positions probe — pass wallet address as first argument
set -euo pipefail
ADDR="${1:?usage: hl-check-positions.sh <wallet-address>}"
curl -s -X POST https://api.hyperliquid.xyz/info -H 'Content-Type: application/json' \
  -d "{\"type\":\"clearinghouseState\",\"user\":\"$ADDR\"}" > /tmp/hl-perps.json
curl -s -X POST https://api.hyperliquid.xyz/info -H 'Content-Type: application/json' \
  -d "{\"type\":\"spotClearinghouseState\",\"user\":\"$ADDR\"}" > /tmp/hl-spot.json
python3 <<'PY'
import json
perps = json.load(open('/tmp/hl-perps.json'))
spot = json.load(open('/tmp/hl-spot.json'))
print('accountValue perps:', perps.get('marginSummary', {}).get('accountValue'))
print('withdrawable:', perps.get('withdrawable'))
positions = []
for p in perps.get('assetPositions', []):
    pos = p.get('position', {})
    szi = float(pos.get('szi', 0) or 0)
    if abs(szi) > 0:
        positions.append({
            'coin': pos.get('coin'),
            'szi': szi,
            'entry': pos.get('entryPx'),
            'upnl': pos.get('unrealizedPnl'),
        })
print('perp positions:', positions or 'none')
spot_bal = [(b['coin'], b['total']) for b in spot.get('balances', []) if float(b.get('total', 0)) > 0]
print('spot balances:', spot_bal or 'none')
PY