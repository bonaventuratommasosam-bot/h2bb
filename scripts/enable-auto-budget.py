#!/usr/bin/env python3
import json
from datetime import datetime, timezone
from pathlib import Path

PROFILE = Path("./data")
strategy_path = PROFILE / "strategy.json"
strategy = json.loads(strategy_path.read_text())
strategy.update({
    "autoSize": True,
    "maxPositionPercent": 90,
    "cashReservePercent": 8,
    "scaleInEnabled": False,
    "active": True,
})
strategy.pop("amountPerTrade", None)
strategy["updatedAt"] = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
strategy_path.write_text(json.dumps(strategy, indent=2))
print(f"OK autoSize={strategy['autoSize']} balance-mode=budget")