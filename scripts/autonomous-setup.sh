#!/bin/bash
# Setup autonomous mode — reset risk, configure, resume
set -euo pipefail
ENGINE_URL="http://127.0.0.1:40001"

echo "=== Step 1: Reset risk manager ==="
curl -s -X POST "$ENGINE_URL/chat" \
  -H 'Content-Type: application/json' \
  -d '{"text":"reset rischio","chatId":"h2bb-setup"}'

echo ""
echo "=== Step 2: Config autonomous mode ==="
curl -s -X POST "$ENGINE_URL/configure" \
  -H 'Content-Type: application/json' \
  -d '{"mode":"autonomous","active":true,"checkIntervalSeconds":45,"intervalMinutes":5,"riskPerTradePercent":0.5}'

echo ""
echo "=== Step 3: Resume engine ==="
curl -s -X POST "$ENGINE_URL/resume"

echo ""
echo "=== Done ==="