#!/usr/bin/env python3
"""Compare /api/dashboard vs raw Hyperliquid info API."""
import json
import sys
import urllib.request

DASH = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:40001/api/dashboard"
WALLET = sys.argv[2] if len(sys.argv) > 2 else "wallet.json"


def http_get_json(url, timeout=25):
    with urllib.request.urlopen(url, timeout=timeout) as r:
        return json.load(r)


def hl_post(body, timeout=15):
    req = urllib.request.Request(
        "https://api.hyperliquid.xyz/info",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def near(a, b, eps):
    if a is None or b is None:
        return False
    return abs(float(a) - float(b)) <= eps


def main():
    dash = http_get_json(DASH)
    try:
        with open(WALLET, encoding="utf-8") as f:
            wallet = json.load(f)
        addr = (wallet.get("address") or "").lower()
    except Exception as e:
        print("wallet load failed:", e)
        return 2

    if not addr.startswith("0x") or "your" in addr:
        print("invalid address")
        return 2

    pair = ((dash.get("market") or {}).get("pair") or "ETH").upper()
    mids = hl_post({"type": "allMids"})
    perps = hl_post({"type": "clearinghouseState", "user": addr})
    spot = hl_post({"type": "spotClearinghouseState", "user": addr})

    mid = float(mids.get(pair) or 0)
    av = float((perps.get("marginSummary") or {}).get("accountValue") or 0)
    usdc = next((b for b in (spot.get("balances") or []) if b.get("coin") == "USDC"), {})
    st = float(usdc.get("total") or 0)
    sh = float(usdc.get("hold") or 0)
    sa = max(0.0, st - sh)
    eq = av + sa
    pos = None
    for ap in perps.get("assetPositions") or []:
        p = ap.get("position") or {}
        if p.get("coin") == pair and abs(float(p.get("szi") or 0)) > 1e-12:
            pos = p
            break
    szi = float(pos.get("szi") or 0) if pos else 0.0
    entry = float(pos.get("entryPx") or 0) if pos else 0.0
    upnl = float(pos.get("unrealizedPnl") or 0) if pos else 0.0

    m = dash.get("market") or {}
    b = dash.get("balance") or {}
    print("ADDR", addr[:6] + "…" + addr[-4:], "PAIR", pair)
    print("SOURCES", dash.get("sources"))
    print("DASH", {
        "price": m.get("price"),
        "perpAV": b.get("accountValuePerp"),
        "spotAvail": b.get("usdcSpotAvailable"),
        "equity": b.get("equity"),
        "pos": m.get("positionSigned"),
        "entry": m.get("avgBuyPrice"),
        "upnl": m.get("pnlUnrealized"),
    })
    print("HL  ", {
        "price": mid,
        "perpAV": av,
        "spotAvail": sa,
        "equity": eq,
        "pos": szi,
        "entry": entry,
        "upnl": upnl,
    })

    # price eps looser: market moves every second
    checks = [
        ("mid", m.get("price"), mid, 5.0),
        ("perpAV", b.get("accountValuePerp"), av, 0.2),
        ("spotAvail", b.get("usdcSpotAvailable"), sa, 0.2),
        ("equity", b.get("equity"), eq, 0.25),
        ("pos", m.get("positionSigned"), szi, 1e-6),
        ("entry", m.get("avgBuyPrice") if entry else 0, entry, 0.5 if entry else 1e9),
        ("upnl", m.get("pnlUnrealized") if m.get("pnlUnrealized") is not None else 0, upnl, 0.35),
    ]
    fail = 0
    for name, a, hb, eps in checks:
        if (a is None or a == 0) and (hb == 0 or hb is None) and name != "mid":
            print("OK ", name, "both empty")
            continue
        ok = near(a, hb, eps)
        if not ok:
            fail += 1
        delta = None
        try:
            delta = float(a) - float(hb)
        except Exception:
            pass
        print(("OK " if ok else "FAIL"), name, "dash=", a, "hl=", hb, "delta=", delta)

    for w in dash.get("watchlist") or []:
        hl = float(mids.get(w.get("pair")) or 0)
        ok = near(w.get("price"), hl, 8.0)
        if not ok:
            fail += 1
        print(("OK " if ok else "FAIL"), "wl", w.get("pair"), w.get("price"), hl)

    hl_pos = []
    for ap in perps.get("assetPositions") or []:
        p = ap.get("position") or {}
        if abs(float(p.get("szi") or 0)) > 1e-12:
            hl_pos.append(p.get("coin"))
    dash_pos = [p.get("coin") for p in (dash.get("openPositions") or [])]
    if sorted(hl_pos) != sorted([c for c in dash_pos if c]):
        # allow equal if same set
        if set(hl_pos) != set(dash_pos):
            print("FAIL openPositions set", "hl=", hl_pos, "dash=", dash_pos)
            fail += 1
        else:
            print("OK  openPositions set", hl_pos)
    else:
        print("OK  openPositions set", hl_pos)

    print("VERDICT", "PASS" if fail == 0 else f"FAIL={fail}")
    return 1 if fail else 0


if __name__ == "__main__":
    raise SystemExit(main())
