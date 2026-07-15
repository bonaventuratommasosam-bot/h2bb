#!/bin/bash
# Hyperliquid balance probe — pass wallet address as first argument
set -euo pipefail
ADDR="${1:?usage: probe-hl-balances.sh <wallet-address>}"
RPC="${HYPEREVM_RPC:-https://rpc.hyperliquid.xyz/evm}"

echo "wallet=$ADDR"

echo "--- perps clearinghouse ---"
curl -s -X POST https://api.hyperliquid.xyz/info -H 'Content-Type: application/json' \
  -d "{\"type\":\"clearinghouseState\",\"user\":\"$ADDR\"}" | python3 -c "
import json,sys
d=json.load(sys.stdin)
ms=d.get('marginSummary') or {}
print('accountValue', ms.get('accountValue'))
print('withdrawable', d.get('withdrawable'))
"

echo "--- spot clearinghouse ---"
curl -s -X POST https://api.hyperliquid.xyz/info -H 'Content-Type: application/json' \
  -d "{\"type\":\"spotClearinghouseState\",\"user\":\"$ADDR\"}" | python3 -m json.tool 2>/dev/null || true

echo "--- hyperevm native HYPE ---"
curl -s "$RPC" -H 'Content-Type: application/json' \
  -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"eth_getBalance\",\"params\":[\"$ADDR\",\"latest\"]}" | python3 -c "
import json,sys
r=json.load(sys.stdin).get('result','0x0')
wei=int(r,16)
print('hype_wei', wei)
print('hype', wei/1e18)
"