# H2BB — Hermes Trading Bot (Open Source)

Trading bot autonomo su Hyperliquid (ETH/BTC/SOL perps + spot) con:
- **Motore PRO** multi-timeframe (analisi 4h/1h/15m, scoring entry)
- **Shadow engine** champion/challenger: apprende nuovi parametri SENZA ordini reali
- **Memoria strutturata**: annota promozioni E fallimenti in `memory/`
- **Sanitize layer**: nessun valore non-finito/fuori range può mai essere promosso
- **Decay/Forget**: i parametri promossi che smettono di funzionare vengono retrocessi
- **Failure memory**: ogni trade in perdita è loggato con contesto per l'apprendimento

> ⚠️ **USO A TUO RISCHIO.** Trading crypto = rischio di perdita totale. Questo codice è fornito "as-is", senza garanzie.

## Setup

```bash
npm install
cp .env.example .env          # inserisci la tua DEEPSEEK_API_KEY
cp config/strategy.example.json config/strategy.json
cp wallet.example.json wallet.json   # inserisci il tuo wallet Hyperliquid
node index.js
```

Variabili d'ambiente (`.env`):
- `DEEPSEEK_API_KEY` — chiave API DeepSeek
- `DATA_DIR` — cartella dati (default: directory corrente)
- `PORT` — porta HTTP del motore (default 40001)
- `WALLET_ENCRYPTION_KEY` — chiave per cifrare la private key del wallet

Wallet (`wallet.json`):
- `address` — indirizzo Hyperliquid
- `mode` — `live` o `demo`
- `apiPrivateKeyEnc` — private key API Hyperliquid (cifrata, NON la seed phrase)

## Architettura

```
index.js                 orchestratore + loop tick (45s)
engine/tick-runner.js    heartbeat, lock anti-reentrancy, timeout
engine/loops.js          scheduler loop autonomo + proattivo
pro-engine.js            scoring entry multi-TF
risk-manager.js          circuit breaker, sizing, resetRiskForResume
shadow-engine.js         champion/challenger + decay/forget + rollback
strategy-experiment.js   backtest champion/challenger (7gg)
hyperliquid-live.js      saldi + ensurePerpCollateral (spot→perp)
lib/sanitize-strategy.js layer di sicurezza parametri
gbrain-memory.js         log trade in markdown + gbrain
memory/                  learnings.md (promozioni+rollback) + failures.md (perdite)
```

## Licenza

MIT — vedi LICENSE.
