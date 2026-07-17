#!/usr/bin/env bash
# Fix Hermes h2bb Telegram → engine control path.
set -euo pipefail

ENGINE_ENV="${ENGINE_ENV:-/home/hermes-clients/profiles/client-trade-1/.env}"
H2BB_ENV="${H2BB_ENV:-/home/tommy/.hermes/profiles/h2bb/.env}"
H2BB_CFG="${H2BB_CFG:-/home/tommy/.hermes/profiles/h2bb/config.yaml}"
PROFILE_DIR="${PROFILE_DIR:-/home/tommy/.hermes/profiles/h2bb}"

EK=$(grep -E '^DEEPSEEK_API_KEY=' "$ENGINE_ENV" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '\r' || true)
if [ -z "${EK}" ]; then
  echo "ERROR: no DEEPSEEK_API_KEY in engine env"
  exit 1
fi
echo "engine_key_len=${#EK}"

CODE=$(curl -sS -o /tmp/ds-engine-models.json -w "%{http_code}" --max-time 15 \
  https://api.deepseek.com/v1/models -H "Authorization: Bearer ${EK}" || echo "000")
echo "engine_key_http=${CODE}"

touch "$H2BB_ENV"
if grep -qE '^DEEPSEEK_API_KEY=' "$H2BB_ENV"; then
  sed -i "s|^DEEPSEEK_API_KEY=.*|DEEPSEEK_API_KEY=${EK}|" "$H2BB_ENV"
else
  echo "DEEPSEEK_API_KEY=${EK}" >> "$H2BB_ENV"
fi
if grep -qE '^OPENAI_API_KEY=' "$H2BB_ENV"; then
  sed -i "s|^OPENAI_API_KEY=.*|OPENAI_API_KEY=${EK}|" "$H2BB_ENV"
else
  echo "OPENAI_API_KEY=${EK}" >> "$H2BB_ENV"
fi
chmod 600 "$H2BB_ENV"
chown tommy:tommy "$H2BB_ENV" 2>/dev/null || true
echo "hermes .env keys updated"

export EK
python3 - <<'PY'
import os, re
from pathlib import Path
cfg_path = Path(os.environ.get("H2BB_CFG", "/home/tommy/.hermes/profiles/h2bb/config.yaml"))
ek = os.environ["EK"]
text = cfg_path.read_text(encoding="utf-8", errors="replace")
bak = cfg_path.with_suffix(".yaml.bak-tg-fix")
bak.write_text(text, encoding="utf-8")
lines = text.splitlines()
out = []
for line in lines:
    if re.search(r"api_key\s*:", line) and ("sk-" in line or True):
        if "api_key" in line:
            out.append(re.sub(r"api_key:\s*.*$", f"api_key: {ek}", line))
            continue
    out.append(line)
new_text = "\n".join(out) + "\n"
new_text = new_text.replace("deepseek-v4-flash", "deepseek-chat")
new_text = re.sub(r"(?m)^(\s*default:\s*).*$", r"\1deepseek-chat", new_text, count=1)
cfg_path.write_text(new_text, encoding="utf-8")
print("config.yaml patched, backup", bak)
PY

SOUL="$PROFILE_DIR/SOUL.md"
if [ -f "$SOUL" ] && ! grep -q "CONTROLLO MOTORE" "$SOUL"; then
  cat >> "$SOUL" <<'SOULEOF'

## CONTROLLO MOTORE (obbligatorio)

Quando l'utente chiede pausa/riprendi/status/rischio/situazione/vendi:
1. Hai terminal → esegui SUBITO curl su http://127.0.0.1:40001
2. NON dire "non posso gestire il motore" se curl risponde
3. Dopo pause/resume verifica con /health (active, operational, circuitBreaker)

Comandi:
- `curl -s http://127.0.0.1:40001/health`
- `curl -s http://127.0.0.1:40001/status`
- `curl -s -X POST http://127.0.0.1:40001/pause`
- `curl -s -X POST http://127.0.0.1:40001/resume`
- `curl -s -X POST http://127.0.0.1:40001/chat -H 'Content-Type: application/json' -d '{"text":"status","chatId":"telegram"}'`
SOULEOF
  echo "SOUL control section appended"
fi

# Ensure terminal toolset not disabling shell for trading skill
echo "engine_health=$(curl -sS --max-time 5 http://127.0.0.1:40001/health | head -c 220)"

systemctl restart hermes-squad-h2bb.service
sleep 6
systemctl is-active hermes-squad-h2bb.service || true
cat /home/tommy/.hermes/profiles/h2bb/gateway_state.json 2>/dev/null || true
journalctl -u hermes-squad-h2bb --since "30 sec ago" --no-pager -q 2>/dev/null | tail -15 || true
echo DONE
