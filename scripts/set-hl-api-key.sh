#!/bin/bash
# Imposta API key Hyperliquid e attiva live (nessun leak in output)
set -euo pipefail

KEY_FILE="${1:?usage: set-hl-api-key.sh /path/to/keyfile}"
DATA_DIR="${DATA_DIR:?Set DATA_DIR to the client trade profile directory}"
PORT="${PORT:-40001}"

export DATA_DIR
[[ -f "${DATA_DIR}/.env" ]] && set -a && source "${DATA_DIR}/.env" && set +a

RAW="$(tr -d ' \r\n' < "$KEY_FILE")"
KEY="$RAW"
[[ "$KEY" == 0x* ]] || KEY="0x$KEY"

if ! [[ "$KEY" =~ ^0x[a-fA-F0-9]{64}$ ]]; then
  echo "ERR: invalid key format"
  exit 1
fi

BODY="$(python3 -c 'import json,sys; print(json.dumps({"apiPrivateKey": sys.argv[1]}))' "$KEY")"
unset RAW KEY

RESP="$(curl -s -X POST "http://127.0.0.1:${PORT}/wallet/activate-live" \
  -H 'Content-Type: application/json' \
  -d "$BODY")"
unset BODY

python3 -c '
import json, sys
r = json.loads(sys.stdin.read())
if not r.get("ok"):
    print("ERR:", r.get("error", "activate-live failed"))
    sys.exit(1)
print("OK mode=" + r.get("mode", "?"))
print("address=" + r.get("address", "?"))
b = r.get("balance") or {}
print("usdc=" + str(b.get("usdc", "?")))
print("accountValue=" + str(b.get("accountValue", "?")))
' <<< "$RESP"