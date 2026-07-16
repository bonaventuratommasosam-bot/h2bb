#!/usr/bin/env bash
# Enable public HTTPS showcase for Hermes trade-1 (read-only).
# Safe defaults: bot stays on 127.0.0.1:40001; nginx terminates TLS.
set -euo pipefail

DOMAIN="${DOMAIN:-live.hermesbro.cloud}"
UPSTREAM="${UPSTREAM:-127.0.0.1:40001}"
REPO_CONF="${REPO_CONF:-/opt/h2bb-opensource/deploy/nginx-live.hermesbro.cloud.conf}"
SITE_AVAIL="/etc/nginx/sites-available/live.hermesbro.cloud"
SITE_ENABLED="/etc/nginx/sites-enabled/live.hermesbro.cloud"
EMAIL="${CERTBOT_EMAIL:-admin@hermesbro.cloud}"

echo "=== Public showcase enable: $DOMAIN → $UPSTREAM ==="

# 1) Health of local bot
if ! curl -fsS --max-time 5 "http://${UPSTREAM}/api/ping" >/dev/null; then
  echo "ERROR: bot not responding on $UPSTREAM"
  exit 1
fi
echo "bot ping: ok"

# 2) DNS check
RESOLVED="$(getent ahostsv4 "$DOMAIN" 2>/dev/null | awk '{print $1; exit}' || true)"
PUBLIC_IP="$(curl -4 -fsS --max-time 5 ifconfig.me 2>/dev/null || curl -4 -fsS --max-time 5 icanhazip.com || true)"
echo "DNS $DOMAIN → ${RESOLVED:-none}"
echo "VPS public IPv4 → ${PUBLIC_IP:-unknown}"

if [[ -z "${RESOLVED:-}" ]]; then
  echo ""
  echo "DNS missing. Add at Aruba DNS for hermesbro.cloud:"
  echo "  Type A   Name: live   Value: ${PUBLIC_IP:-194.146.12.219}   TTL: 600"
  echo "Then re-run: $0"
  exit 2
fi

# 3) Install nginx site (HTTP-only first if cert missing)
if [[ ! -f "$REPO_CONF" ]]; then
  echo "ERROR: missing $REPO_CONF — deploy repo first"
  exit 1
fi

TMP="$(mktemp)"
cp "$REPO_CONF" "$TMP"

if [[ ! -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ]]; then
  echo "No cert yet — writing temporary HTTP-only server for ACME"
  cat >"$TMP" <<EOF
upstream hermes_trade1 {
    server ${UPSTREAM};
    keepalive 8;
}
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};
    server_tokens off;
    location ^~ /.well-known/acme-challenge/ {
        root /var/www/html;
        allow all;
    }
    location / {
        return 200 'Hermes live showcase — awaiting TLS cert\\n';
        add_header Content-Type text/plain;
    }
}
EOF
fi

sudo cp "$TMP" "$SITE_AVAIL"
sudo ln -sfn "$SITE_AVAIL" "$SITE_ENABLED"
rm -f "$TMP"

sudo nginx -t
sudo systemctl reload nginx
echo "nginx: reloaded (staging config)"

# 4) Issue / renew cert
if [[ ! -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ]]; then
  echo "Requesting Let's Encrypt cert for $DOMAIN ..."
  sudo mkdir -p /var/www/html
  sudo certbot certonly --webroot -w /var/www/html \
    -d "$DOMAIN" \
    --email "$EMAIL" \
    --agree-tos \
    --non-interactive \
    --keep-until-expiring
fi

# 5) Install full TLS proxy config from repo
sudo cp "$REPO_CONF" "$SITE_AVAIL"
# Ensure upstream host matches
sudo sed -i "s|server 127.0.0.1:40001;|server ${UPSTREAM};|" "$SITE_AVAIL" || true
sudo nginx -t
sudo systemctl reload nginx

# 6) Smoke tests
echo ""
echo "=== Smoke ==="
curl -fsS --max-time 10 "https://${DOMAIN}/api/ping" | head -c 200; echo
code_post="$(curl -sS -o /dev/null -w '%{http_code}' -X POST "https://${DOMAIN}/resume" || true)"
code_wallet="$(curl -sS -o /dev/null -w '%{http_code}' "https://${DOMAIN}/wallet/status" || true)"
code_ui="$(curl -sS -o /dev/null -w '%{http_code}' "https://${DOMAIN}/" || true)"
echo "GET  /           → HTTP $code_ui (expect 200)"
echo "POST /resume     → HTTP $code_post (expect 403 or 405)"
echo "GET  /wallet/*   → HTTP $code_wallet (expect 403)"
echo ""
echo "DONE — public URL: https://${DOMAIN}/"
echo "Bot controls remain localhost-only on ${UPSTREAM}"
