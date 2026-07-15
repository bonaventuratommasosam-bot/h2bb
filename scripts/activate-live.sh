#!/bin/bash
# Attiva trading live usando la chiave già in wallet.json (nessun leak in output)
set -euo pipefail

DATA_DIR="${DATA_DIR:-${1:?usage: DATA_DIR=/path/to/client-trade-N ./activate-live.sh}}"
PORT="${PORT:-40001}"

export DATA_DIR
[[ -f "${DATA_DIR}/.env" ]] && set -a && source "${DATA_DIR}/.env" && set +a
PORT="${ENGINE_PORT:-$PORT}"

cd "$DATA_DIR"

KEY="$(node -e "
const w = require('./wallet-store');
const x = w.loadWallet();
if (!x) process.exit(1);
const k = w.getPrivateKey(x);
if (!k) process.exit(2);
process.stdout.write(k);
")"

BODY="$(node -e "process.stdout.write(JSON.stringify({ apiPrivateKey: process.argv[1] }))" "$KEY")"
unset KEY

RESP="$(curl -s -X POST "http://127.0.0.1:${PORT}/wallet/activate-live" \
  -H 'Content-Type: application/json' \
  -d "$BODY")"
unset BODY

echo "$RESP" | node -e "
const r = JSON.parse(require('fs').readFileSync(0, 'utf8'));
if (!r.ok) {
  console.error('ERR:', r.error || 'activate-live failed');
  process.exit(1);
}
console.log('OK mode=' + r.mode);
console.log('address=' + r.address);
if (r.balance) {
  console.log('usdc=' + (r.balance.usdc ?? '?'));
  console.log('accountValue=' + (r.balance.accountValue ?? '?'));
}
"