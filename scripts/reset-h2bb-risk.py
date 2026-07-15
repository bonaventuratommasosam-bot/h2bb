#!/usr/bin/env python3
import json
from pathlib import Path

PROFILE = Path("./data")

balance = json.loads((PROFILE / "balance.json").read_text())
equity = balance.get("accountValue") or balance.get("amount") or 0

risk_path = PROFILE / "risk-state.json"
risk = json.loads(risk_path.read_text())
risk.update({
    "circuitBreaker": False,
    "circuitReason": None,
    "cooldownUntil": None,
    "peakEquity": equity,
    "dayStartEquity": equity,
    "dayPnl": 0,
})
risk_path.write_text(json.dumps(risk, indent=2))

strategy_path = PROFILE / "strategy.json"
strategy = json.loads(strategy_path.read_text())
strategy["active"] = True
strategy["lastSignal"] = None
strategy_path.write_text(json.dumps(strategy, indent=2))

print(f"OK equity={equity} circuitBreaker={risk['circuitBreaker']} active={strategy['active']}")