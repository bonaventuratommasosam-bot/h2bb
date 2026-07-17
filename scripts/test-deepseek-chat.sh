#!/usr/bin/env bash
set -euo pipefail
EK=$(grep DEEPSEEK_API_KEY /home/hermes-clients/profiles/client-trade-1/.env | cut -d= -f2- | tr -d '\r')
curl -sS --max-time 25 https://api.deepseek.com/v1/chat/completions \
  -H "Authorization: Bearer ${EK}" \
  -H "Content-Type: application/json" \
  -d '{"model":"deepseek-chat","messages":[{"role":"user","content":"ping"}],"max_tokens":8}' \
  | head -c 400
echo
cat /home/tommy/.hermes/profiles/h2bb/gateway_state.json
echo
# test engine chat control
curl -sS --max-time 10 -X POST http://127.0.0.1:40001/chat \
  -H 'Content-Type: application/json' \
  -d '{"text":"status","chatId":"telegram"}' | head -c 400
echo
