#!/usr/bin/env python3
import json
from pathlib import Path

PROFILE = Path("./data")
strategy_path = PROFILE / "strategy.json"
strategy = json.loads(strategy_path.read_text())
strategy.update({
    "mode": "autonomous",
    "active": True,
    "checkIntervalSeconds": 45,
    "intervalMinutes": 5,
    "riskPerTradePercent": 0.5,
    "lastSignal": None,
})
strategy_path.write_text(json.dumps(strategy, indent=2))
print(f"OK mode={strategy['mode']} active={strategy['active']} interval={strategy['checkIntervalSeconds']}s")