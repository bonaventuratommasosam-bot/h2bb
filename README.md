# H2BB — Hermes Trading Bot

Trading bot autonomo su **Hyperliquid** (ETH/BTC/SOL perps) con:

- **Motore PRO** multi-timeframe (4h / 1h / 15m, scoring entry)
- **Shadow engine** champion/challenger (parametri in paper, senza ordini reali)
- **Hard caps risk-first** (risk, size, daily loss, drawdown — inviolabili da meta/AI)
- **Reason codes** su ogni decisione (`perché?` in chat, `/health`, `/status`)
- **Sanitize layer** su parametri non-finiti / fuori range
- **Decay/Forget** e failure memory per l’apprendimento

> ⚠️ **USO A TUO RISCHIO.** Trading crypto = rischio di perdita totale. Software "as-is", senza garanzie.

## Requisiti

- Node.js **≥ 18**
- Account Hyperliquid (solo se passi a LIVE)
- Opzionale: token Telegram, API key LLM (Groq/Gemini/DeepSeek/…)

## Setup rapido (DEMO)

```bash
git clone https://github.com/bonaventuratommasosam-bot/h2bb.git
cd h2bb
npm install
cp .env.example .env
cp config/strategy.example.json strategy.json
cp wallet.example.json wallet.json
# wallet.json: mode "demo" di default — non serve chiave API
node index.js
```

Server HTTP: `http://127.0.0.1:40001` (solo localhost).

### Variabili utili (`.env`)

| Variabile | Ruolo |
|-----------|--------|
| `PORT` | Porta HTTP (default `40001`) |
| `DATA_DIR` | Cartella dati (default: root progetto) |
| `WALLET_ENCRYPTION_KEY` | **Obbligatoria in LIVE** (min 16 char o 64 hex) |
| `TELEGRAM_BOT_TOKEN` | Alert proattivi |
| `LLM_PROVIDER` / `*_API_KEY` | Opzionale (auto se presenti chiavi) |
| `HARD_CAP_*` | Override ceiling risk (vedi `.env.example`) |

Genera chiave cifratura:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Wallet (`wallet.json`)

| Campo | Note |
|--------|------|
| `address` | Indirizzo Hyperliquid |
| `mode` | `demo` (default) o `live` |
| `apiPrivateKeyEnc` | API wallet key **cifrata** (non seed phrase) |
| `ownerChatId` | Chat Telegram autorizzata |

**LIVE:** imposta `WALLET_ENCRYPTION_KEY`, `mode: "live"`, salva la API key cifrata. Senza chiave di cifratura il bot **non** considera il wallet live.

## Hard caps (default)

| Parametro | Ceiling |
|-----------|---------|
| Rischio / trade | **1.0%** |
| Max posizione | **25%** equity |
| Perdita giornaliera | **2%** |
| Drawdown da peak | **8%** |
| Perdite consecutive | **3** poi cooldown |

Il meta-controller può solo muoversi **dentro** questi limiti.

## API utili

```text
GET /health   — engine, active, CB, lastDecision, uptime
GET /status   — mercato, PnL, balance, lastDecision
```

## Chat / Telegram (intent)

- `analisi` · `scanner` · `performance` · `rischio`
- **`perché?`** — spiega l’ultima decisione (reason code)
- `come sta andando?` · `pausa` · `resume` · `ferma tutto`
- `attiva live` · `modalità demo`

## Architettura

```text
index.js                 orchestratore + loop tick (~45s)
engine/tick-runner.js    heartbeat, lock anti-reentrancy, timeout
engine/loops.js          scheduler autonomo + proattivo
pro-engine.js            scoring multi-TF + reason codes
risk-manager.js          circuit breaker, sizing, hard caps
shadow-engine.js         champion/challenger (≥20 trade per promote)
lib/hard-caps.js         ceiling risk-first
lib/sanitize-strategy.js range + hard caps
lib/reason-codes.js      codici decisione stabili
meta-controller.js       policy trade/reduce/recover (capped)
hyperliquid-live.js      saldi + ordini live
```

## Test

```bash
npm test
```

## Licenza

MIT — vedi [LICENSE](./LICENSE).
