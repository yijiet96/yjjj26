"""新聞抓取:免費 RSS 來源(Google News / Yahoo Finance),逐標的查詢。

無網路或抓取失敗時回傳空清單(由 agent 端決定是否用 demo 新聞),不丟例外中斷流程。
"""
from __future__ import annotations

import datetime as dt
import urllib.parse

import pandas as pd

from ..utils import get_logger, retry

log = get_logger("news")

_GOOGLE = "https://news.google.com/rss/search?q={q}&hl=en-US&gl=US&ceid=US:en"
_YAHOO = "https://feeds.finance.yahoo.com/rss/2.0/headline?s={s}&region=US&lang=en-US"

try:
    import feedparser  # noqa: F401
    _HAS_FEEDPARSER = True
except Exception:  # noqa: BLE001
    _HAS_FEEDPARSER = False


@retry(times=2, base_delay=1.0, exc=(OSError, ValueError, RuntimeError))
def _parse(url: str):
    import feedparser
    return feedparser.parse(url)


def fetch_for_ticker(ticker: str, name: str | None = None,
                     limit: int = 8) -> list[dict]:
    """抓單一標的近期新聞。台股用公司名查詢較準,美股用代號。"""
    if not _HAS_FEEDPARSER:
        return []
    items: list[dict] = []
    q = name or ticker
    sid = ticker.replace(".TW", "").replace(".TWO", "")
    urls = [_GOOGLE.format(q=urllib.parse.quote(f"{q} 股票 OR stock")),
            _YAHOO.format(s=sid if "." not in ticker else ticker)]
    seen = set()
    for url in urls:
        try:
            feed = _parse(url)
        except Exception as e:  # noqa: BLE001
            log.debug("新聞抓取失敗 %s:%s", url, e)
            continue
        for entry in getattr(feed, "entries", [])[:limit]:
            title = getattr(entry, "title", "").strip()
            if not title or title in seen:
                continue
            seen.add(title)
            items.append({
                "ticker": ticker,
                "title": title,
                "summary": getattr(entry, "summary", "")[:500],
                "link": getattr(entry, "link", ""),
                "published": getattr(entry, "published", ""),
                "source": "google" if "google" in url else "yahoo",
            })
        if len(items) >= limit:
            break
    return items[:limit]


def fetch_market_headlines(limit: int = 15) -> list[dict]:
    """總體市場新聞(大盤/Fed/總經),用於每日市場概覽。"""
    if not _HAS_FEEDPARSER:
        return []
    queries = ["stock market", "Federal Reserve", "台股 大盤", "半導體 產業"]
    out: list[dict] = []
    seen = set()
    for q in queries:
        try:
            feed = _parse(_GOOGLE.format(q=urllib.parse.quote(q)))
        except Exception:  # noqa: BLE001
            continue
        for entry in getattr(feed, "entries", [])[:limit]:
            t = getattr(entry, "title", "").strip()
            if t and t not in seen:
                seen.add(t)
                out.append({"title": t, "link": getattr(entry, "link", ""),
                            "query": q, "published": getattr(entry, "published", "")})
    return out[:limit]


def demo_news(tickers: list[str]) -> list[dict]:
    """離線 demo 新聞,讓無網路時也能展示新聞分析流程。"""
    today = dt.date.today().isoformat()
    templates = [
        ("{t} 公布財報優於預期,法人調升目標價", 0.8),
        ("{t} 傳新產品延遲,短線承壓", -0.6),
        ("外資連續買超 {t},籌碼面轉強", 0.5),
        ("{t} 遭調查,公司否認不法情事", -0.7),
        ("{t} 獲納入主要指數成分股", 0.6),
    ]
    out = []
    for i, t in enumerate(tickers):
        tpl, _ = templates[i % len(templates)]
        out.append({"ticker": t, "title": tpl.format(t=t), "summary": "",
                    "link": "", "published": today, "source": "demo"})
    return out
