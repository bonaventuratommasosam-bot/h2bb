#!/bin/bash
curl -s -X POST https://api.hyperliquid.xyz/info \
  -H 'Content-Type: application/json' \
  -d '{"type":"meta"}' | python3 -c "
import sys, json
m = json.load(sys.stdin)
for u in m['universe']:
    if u['name'] == 'ETH':
        print(json.dumps(u, indent=2))
        break
"