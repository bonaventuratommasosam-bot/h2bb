#!/bin/bash
# Importa trades.jsonl storici in gbrain
set -euo pipefail

DATA_DIR="${DATA_DIR:-${1:?usage: DATA_DIR=/path/to/client-trade-N ./sync-trades-gbrain.sh}}"
ORDER_ID="${ORDER_ID:-}"
PROFILE_NAME="${HERMES_PROFILE_NAME:-trade-${ORDER_ID}}"
HERMES_HOME="${HERMES_HOME:-/home/${SERVICE_USER:-hermes}/.hermes}"
HERMES_PROFILE_DIR="${HERMES_PROFILE_DIR:-${HERMES_HOME}/profiles/${PROFILE_NAME}}"

export PATH="${HOME}/.bun/bin:${PATH}"
export GBRAIN_ENABLED=true
export HERMES_PROFILE_DIR
export GBRAIN_TRADES_DIR="${HERMES_PROFILE_DIR}/memory/trades"
export GBRAIN_PROFILE="${GBRAIN_PROFILE:-${PROFILE_NAME}}"

cd "$DATA_DIR"
node -e "
const fs=require('fs');
const g=require('./gbrain-memory');
const raw=fs.existsSync('trades.jsonl')?fs.readFileSync('trades.jsonl','utf8').trim():'';
if(!raw){console.log('No trades');process.exit(0);}
const lines=raw.split('\n').filter(Boolean);
let n=0;
for(const line of lines){
  try{
    const t=JSON.parse(line);
    g.rememberTrade(t,{mode:process.env.TRADE_MODE||'demo'});
    n++;
  }catch(e){console.error('skip',e.message);}
}
console.log('Synced',n,'trades to gbrain');
setTimeout(()=>process.exit(0),8000);
"