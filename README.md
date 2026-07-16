# H2BB — Hermes Trading Bot

Trading bot autonomo su **Hyperliquid** (ETH/BTC/SOL perps) con:

- **Motore PRO** multi-timeframe (4h / 1h / 15m, scoring entry)
- **Shadow engine** champion/challenger (parametri in paper, senza ordini reali)
- **Hard caps risk-first** (risk, size, daily loss, drawdown — inviolabili da meta/AI)
- **Reason codes** su ogni decisione (`perché?` in chat, `/health`, `/status`)
- **Sanitize layer** su parametri non-finiti / fuori range
- **Decay/Forget** e failure memory per l’apprendimento
- **Hermes Terminal** — vetrina web pubblica **sola lettura** (dati HL reali, nessun controllo remoto)

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

## Hermes Terminal (dashboard web)

Terminal **pubblico, view-only**: mostra lo stato del bot e i dati Hyperliquid.  
**Non** espone controlli di trading dalla UI pubblica.

### Cosa mostra

| Area | Contenuto |
|------|-----------|
| **Chart** | TradingView live (**ETHUSD** / Coinbase come riferimento spot) |
| **Quote HL** | Mid Hyperliquid perp, funding, score live, regime |
| **Signal** | `signalLive` da score/bias **corrente** (non decisioni stantie) |
| **Portfolio** | Equity, uPnL, day PnL $, breakdown perp/spot/margin |
| **Position** | Side, size, entry, mark, notional, leva, distanza da entry |
| **Bot fills** | Candele HL + marker buy/sell da `trades.jsonl` |
| **Risk / perf** | Drawdown, day PnL, WR, expectancy, quality check equity |

Refresh UI: **5s**. Fonti: `hyperliquid-allMids`, clearinghouse, candleSnapshot.

> Mark price = **Hyperliquid perp mid**. Il chart TV è un **riferimento** ETHUSD spot, non il book HL.

### Locale (sviluppo)

```bash
npm start
```

Apri (usa **127.0.0.1**, non il file HTML da disco):

```text
http://127.0.0.1:40001/
```

### Produzione (HTTPS, sola lettura)

- Bot in ascolto solo su **`127.0.0.1:40001`**
- Nginx termina TLS e fa proxy **GET-only**
- Bloccati all’edge: `/resume`, `/pause`, `/chat`, `/wallet`, `/configure`, …
- Controlli bot: **SSH / localhost** sul server, mai dalla vetrina

Config di esempio: `deploy/nginx-live.hermesbro.cloud.conf`  
Script: `scripts/enable-public-showcase.sh`

### Sicurezza UI pubblica

| Endpoint | Pubblico |
|----------|----------|
| `GET /`, static, `/api/dashboard`, `/api/ping`, `/api/trades`, `/health` | sì (sola lettura) |
| `POST /resume` · `/pause` · `/chat` · `/wallet/*` · `/configure` | **no** (localhost only) |

In API: address wallet solo in forma **abbreviata** (`0x….abcd`); niente chiavi o secret.

### Modalità dati

| Modalità | Serve | Vetrina |
|----------|--------|---------|
| **demo** | — | prezzi + analisi multi-TF; balance simulato |
| **observe** | address in `wallet.json` | equity/posizioni HL in sola lettura |
| **live** | address + API key cifrata + `WALLET_ENCRYPTION_KEY` | come observe + bot che può tradare (controllo solo server) |

### API snapshot

```text
GET /api/ping         — liveness
GET /api/dashboard    — snapshot completo (signalLive, position, pnl, dataQuality, …)
GET /api/trades
GET /api/events
GET /api/performance
GET /health
GET /status           — redacted se remoto; preferire /api/dashboard in vetrina
```

Se vedi **OFFLINE** / banner rosso:

1. Bot non avviato → `npm start`
2. Porta occupata → `PORT=40002` in `.env`
3. Su Windows preferisci `127.0.0.1` a `localhost`
4. Test: `http://127.0.0.1:40001/api/ping` → `{"ok":true,...}`

Bind default: `127.0.0.1` (+ `::1`). Non esporre `0.0.0.0` senza reverse proxy HTTPS e deny dei controlli.

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
server/app.js            Express: static terminal + API GET + localOnly controlli
server/routes/dashboard-api.js   snapshot vetrina (signalLive, position, pnl, quality)
public/                  Hermes Terminal UI (TradingView + panel)
```

## Test

```bash
npm test
```

## Licenza

MIT — vedi [LICENSE](./LICENSE).
