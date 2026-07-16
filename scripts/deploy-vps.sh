#!/usr/bin/env bash
# Deploy H2BB code to VPS:
#  1) update /opt/h2bb-opensource from GitHub
#  2) rsync code into production profile (no secrets/state)
#  3) npm install + restart hermes-client-trade-1
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/bonaventuratommasosam-bot/h2bb.git}"
OPEN_SRC="${OPEN_SRC:-/opt/h2bb-opensource}"
PROD="${PROD:-/home/hermes-clients/profiles/client-trade-1}"
SERVICE="${SERVICE:-hermes-client-trade-1.service}"

echo "=== 1) Update $OPEN_SRC from GitHub ==="
cd "$OPEN_SRC"
if ! git remote get-url origin >/dev/null 2>&1; then
  git remote add origin "$REPO_URL"
fi
git remote set-url origin "$REPO_URL"
git fetch origin master
git checkout -B master origin/master
git reset --hard origin/master
echo "HEAD: $(git log -1 --oneline)"
test -f package.json
test -d public

echo ""
echo "=== 2) Backup production code ==="
TS=$(date +%Y%m%d-%H%M%S)
BACKUP_DIR="${HOME}/backup-h2bb-code-${TS}"
mkdir -p "$BACKUP_DIR"
for f in index.js package.json package-lock.json pro-engine.js risk-manager.js hyperliquid-live.js; do
  if [ -f "$PROD/$f" ]; then cp -a "$PROD/$f" "$BACKUP_DIR/"; fi
done
[ -d "$PROD/server" ] && cp -a "$PROD/server" "$BACKUP_DIR/server" || true
[ -d "$PROD/public" ] && cp -a "$PROD/public" "$BACKUP_DIR/public" || true
[ -d "$PROD/lib" ] && cp -a "$PROD/lib" "$BACKUP_DIR/lib" || true
echo "backup -> $BACKUP_DIR"

echo ""
echo "=== 3) Sync code -> $PROD (preserve secrets/state) ==="
rsync -a \
  --exclude '.git/' \
  --exclude 'node_modules/' \
  --exclude '.env' \
  --exclude '.env.*' \
  --exclude 'wallet.json' \
  --exclude 'strategy.json' \
  --exclude 'balance.json' \
  --exclude 'risk-state.json' \
  --exclude 'shadow-state.json' \
  --exclude 'meta-controller-state.json' \
  --exclude 'proactive-state.json' \
  --exclude 'performance-feedback-state.json' \
  --exclude 'bear-state.json' \
  --exclude 'conversation-history.json' \
  --exclude 'cache/' \
  --exclude 'memory/' \
  --exclude 'strategy-snapshots/' \
  --exclude 'strategy-experiments.json' \
  --exclude '*.jsonl' \
  --exclude 'auth.json' \
  --exclude '.DS_Store' \
  "$OPEN_SRC/" "$PROD/"

echo ""
echo "=== 4) npm install ==="
cd "$PROD"
npm install --omit=dev

echo ""
echo "=== 5) Restart $SERVICE ==="
sudo systemctl restart "$SERVICE"
sleep 3
systemctl is-active "$SERVICE"
systemctl status "$SERVICE" --no-pager -l | head -20

echo ""
echo "=== 6) Smoke checks ==="
curl -sS --max-time 10 "http://127.0.0.1:40001/api/ping" || \
  curl -sS --max-time 10 "http://127.0.0.1:40001/health" || true
echo
curl -sS --max-time 5 -o /dev/null -w "GET / -> HTTP %{http_code}\n" "http://127.0.0.1:40001/" || true
test -f "$PROD/public/index.html" && echo "dashboard UI: present"
node -e "console.log('version', require('./package.json').version)"
echo "DONE"
