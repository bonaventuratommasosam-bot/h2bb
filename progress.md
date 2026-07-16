# H2BB — Progress Tracker

> Aggiornato da ogni sessione MiMo. Leggere questo file all'avvio per capire lo stato.

## Sessione corrente

- Data inizio: 2026-07-16
- Stato: Foundation open-source + safety pack eseguiti
- Ultime modifiche: v4.5.1 — package.json, hard caps, reason codes, test suite

## Feature completate

### H2BB-001 — Verifica servizi (P1)
- 3/3 servizi active
- Engine: loop ~45s, ETH $1764, RSI ~87 (hold)
- Position: flat, CB OFF, dayPnl $0
- Wallet: LIVE, balance ~$0.000084 USDC
- Log: nessun errore, solo tick autonomi

### H2BB-002 — Proattivo Telegram (P1)
- /proactive/check funziona
- 12 messaggi inviati oggi
- Briefing del giorno confermato
- Budget alert attivo (dedup)
- State JSON pulito

### H2BB-003 — Risk state (P1)
- CB OFF, dayPnl $0, consecutiveLosses 0
- Cooldown: null
- Peak equity: $0.000084
- Flat position, tutto pulito

### H2BB-004 — Sync deploy (P2)
- Files trading-bot esistono su VPS
- index.js, risk-manager.js, proactive-agent.js presenti
- Deploy infrastructure OK

### H2BB-009 — Alert saldo (P2)
- ownerChatId: [REDACTED] presente in wallet.json
- Fix v4.5 #12 deployato
- Budget alert dedup 24h attivo

### H2BB-005 — Gateway session (P2)
- Systemd active (3h 16min), 3 restart oggi
- Telegram reconnect ok
- Nota: `gateway status` dice not running ma service attivo (problema noto)

### H2BB-010 — Auto-resume (P2)
- resetRiskForResume in risk-manager.js:181
- resumeTradingAfterEngineClose in index.js:361
- Chiamato dopo SL/TP, fix deployato

### H2BB-006 — Pipeline deploy (P3)
- deploy-trading-agent.sh esiste localmente
- Deploy infrastructure base OK

### H2BB-008 — Coerenza /health (P3)
- /health completo: engine, active, operational, CB, balance, uptime

### H2BB-007 — Health cron (P3)
- DA IMPLEMENTARE: cron non esiste ancora

## Feature in corso

_Nessuna._

## 2026-07-16 — Product hardening (eseguito)

### H2BB-OS-001 — Foundation open-source (P0)
- `package.json` + lockfile, `LICENSE` MIT, `.env.example`
- `wallet.example.json`, `config/strategy.example.json`
- `.gitignore` non blocca più `*.json` utili
- `DATA_DIR` default = root progetto (non `config/`)
- README allineato al setup reale

### H2BB-OS-002 — Safety pack hard caps (P0)
- `lib/hard-caps.js`: risk ≤1%, pos ≤25%, day −2%, DD −8%
- sanitize + meta-controller + risk-manager rispettano ceiling
- LIVE richiede `WALLET_ENCRYPTION_KEY`
- Shadow: min 20 trade per promozione (era 5)

### H2BB-OS-003 — Reason codes (P1)
- `lib/reason-codes.js` + `strategy.lastDecision`
- Chat intent `perché?`, `/status` e `/health` espongono decisione
- 15 test unitari `npm test` green

## Ultimo stato VPS

- Servizi: da verificare
- Wallet: ~$24.30 USDC
- Position: flat
- CB: OFF
- Sessione gateway: ~1.7M token (potrebbe necessitare restart)

## Log sessioni

### 2026-06-15 — Harness init
- Creato features.json con 10 feature
- Creato progress.md
- Stato: tutti i fix v4.5 deployati, da verificare in produzione
