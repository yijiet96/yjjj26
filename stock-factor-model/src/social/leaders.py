"""社群意見領袖訊號層:抓取具市場影響力人物的近期貼文 → LLM 分析 → 映射回個股。

降級鏈:X API → Nitter RSS → 手動貼文檔 → demo 貼文。任何失敗都不中斷主流程。
輸出:每檔標的的 social_score∈[-1,1] 與觸發貼文摘要;另有整體市場情緒。
"""
from __future__ import annotations

import datetime as dt
import json

import numpy as np
import pandas as pd
import yaml

from ..config import CONFIG_DIR, RAW_DIR, load_settings
from ..llm.client import get_client
from ..utils import get_logger, retry

log = get_logger("social")

_SYS = (
    "你是金融社群輿情分析師。給定具市場影響力人物的貼文,判斷其對股市的可能影響。"
    "只輸出 JSON 陣列,每元素:idx(整數)、relevant(bool,是否與市場相關)、"
    "tickers(受影響股票代號陣列,可空)、themes(受影響主題陣列)、"
    "direction(-1~1)、magnitude(high/medium/low)、reason(25字內中文)。"
    "政治/玩笑/無關貼文 relevant=false。誇大言論給折扣。"
)


def _load_cfg() -> dict:
    p = CONFIG_DIR / "social_sources.yaml"
    if not p.exists():
        return {"settings": {}, "leaders": [], "theme_map": {}}
    with open(p, encoding="utf-8") as fh:
        return yaml.safe_load(fh) or {}


# ---------------------------------------------------------------------------
# 抓取(降級鏈)
# ---------------------------------------------------------------------------
@retry(times=2, exc=(OSError, ValueError, RuntimeError))
def _fetch_nitter(handle: str, instance: str, limit: int) -> list[dict]:
    import feedparser
    feed = feedparser.parse(f"{instance.rstrip('/')}/{handle}/rss")
    out = []
    for e in getattr(feed, "entries", [])[:limit]:
        out.append({"handle": handle, "text": getattr(e, "title", ""),
                    "published": getattr(e, "published", ""),
                    "link": getattr(e, "link", "")})
    return out


def _fetch_manual(handle: str, limit: int) -> list[dict]:
    p = RAW_DIR / "social_posts.json"
    if not p.exists():
        return []
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return []
    posts = [d for d in data if d.get("handle") == handle]
    return posts[:limit]


def _demo_posts(leaders: list[dict]) -> list[dict]:
    today = dt.datetime.now().isoformat()
    samples = {
        "elonmusk": "Tesla production hitting new records this quarter 🚀",
        "realDonaldTrump": "New tariffs on imports coming — protect American industry!",
        "jimcramer": "I'm telling you, semiconductors are the place to be right now.",
        "CathieDWood": "Innovation will compound. We're buying more growth tech.",
    }
    out = []
    for ld in leaders:
        h = ld["handle"]
        if h in samples:
            out.append({"handle": h, "text": samples[h], "published": today, "link": ""})
    return out


def fetch_posts(cfg: dict) -> list[dict]:
    s = load_settings()
    settings = cfg.get("settings", {})
    limit = settings.get("max_posts_per_leader", 10)
    leaders = cfg.get("leaders", [])
    nitter = s.key("NITTER_INSTANCE")
    posts: list[dict] = []
    for ld in leaders:
        h = ld["handle"]
        got: list[dict] = []
        if nitter:
            try:
                got = _fetch_nitter(h, nitter, limit)
            except Exception as e:  # noqa: BLE001
                log.debug("Nitter 抓取 %s 失敗:%s", h, e)
        if not got:
            got = _fetch_manual(h, limit)
        posts.extend(got)
    if not posts:
        log.info("社群:無真實貼文來源,使用 demo 範例(僅展示流程)")
        posts = _demo_posts(leaders)
    return posts


# ---------------------------------------------------------------------------
# 分析 + 映射
# ---------------------------------------------------------------------------
def analyze_posts(posts: list[dict], cfg: dict) -> list[dict]:
    if not posts:
        return []
    client = get_client()
    leader_w = {l["handle"]: l.get("weight", 0.5) for l in cfg.get("leaders", [])}
    theme_map = cfg.get("theme_map", {})

    if not client.available:
        # 無 LLM:只能用關鍵詞粗略判斷,標記不可靠
        out = []
        for p in posts:
            txt = p["text"].lower()
            direction = (("record" in txt or "buy" in txt or "🚀" in p["text"]) -
                         ("tariff" in txt or "sell" in txt or "crash" in txt))
            out.append({**p, "relevant": True, "tickers": [], "themes": [],
                        "direction": float(np.clip(direction, -1, 1)),
                        "magnitude": "low", "reason": "規則式粗判,僅供參考",
                        "weight": leader_w.get(p["handle"], 0.4), "analyzer": "rule_based"})
        return out

    payload = [{"idx": i, "handle": p["handle"], "text": p["text"]}
               for i, p in enumerate(posts)]
    res = client.analyze_json(_SYS, json.dumps(payload, ensure_ascii=False),
                              max_tokens=2048)
    rows = res.data if isinstance(res.data, list) else res.data.get("results", [])
    by_idx = {int(r.get("idx", -1)): r for r in rows if isinstance(r, dict)}
    out = []
    for i, p in enumerate(posts):
        r = by_idx.get(i, {})
        tickers = list(r.get("tickers", []) or [])
        for th in r.get("themes", []) or []:
            tickers += theme_map.get(th, [])
        out.append({**p, "relevant": bool(r.get("relevant", False)),
                    "tickers": sorted(set(tickers)),
                    "themes": r.get("themes", []),
                    "direction": float(np.clip(r.get("direction", 0), -1, 1)),
                    "magnitude": r.get("magnitude", "low"),
                    "reason": r.get("reason", ""),
                    "weight": leader_w.get(p["handle"], 0.4),
                    "analyzer": res.provider})
    return out


_MAG_W = {"high": 1.0, "medium": 0.6, "low": 0.3}


def aggregate_by_ticker(analyzed: list[dict], cfg: dict) -> tuple[pd.DataFrame, float]:
    """回傳 (每檔 social_score 表, 整體市場情緒)。score 已夾在 ±cap。"""
    cap = cfg.get("settings", {}).get("social_overlay_cap", 0.3)
    rel = [a for a in analyzed if a.get("relevant")]
    # 整體市場情緒:領袖權重 × magnitude × direction 的加權平均
    if rel:
        num = sum(a["direction"] * a["weight"] * _MAG_W.get(a["magnitude"], 0.3)
                  for a in rel)
        den = sum(a["weight"] * _MAG_W.get(a["magnitude"], 0.3) for a in rel)
        market_sent = float(np.clip(num / den, -1, 1)) if den else 0.0
    else:
        market_sent = 0.0

    rows: dict[str, dict] = {}
    for a in rel:
        contrib = a["direction"] * a["weight"] * _MAG_W.get(a["magnitude"], 0.3)
        for tk in a["tickers"]:
            d = rows.setdefault(tk, {"num": 0.0, "den": 0.0, "posts": []})
            d["num"] += contrib
            d["den"] += a["weight"] * _MAG_W.get(a["magnitude"], 0.3)
            d["posts"].append(f'@{a["handle"]}: {a["reason"]}')
    out = []
    for tk, d in rows.items():
        score = d["num"] / d["den"] if d["den"] else 0.0
        out.append({"ticker": tk,
                    "social_score": round(float(np.clip(score, -cap, cap)), 3),
                    "social_note": " | ".join(d["posts"][:3])})
    return pd.DataFrame(out), market_sent


def run_social(cfg: dict | None = None) -> dict:
    """社群層主入口。"""
    cfg = cfg or _load_cfg()
    posts = fetch_posts(cfg)
    analyzed = analyze_posts(posts, cfg)
    table, market_sent = aggregate_by_ticker(analyzed, cfg)
    return {"posts": analyzed, "by_ticker": table, "market_sentiment": market_sent,
            "n_posts": len(posts)}
