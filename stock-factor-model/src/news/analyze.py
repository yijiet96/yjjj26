"""新聞影響分析:用 LLM 評估情緒與市場衝擊;無金鑰時退回規則式關鍵詞情緒。

輸出每則新聞:sentiment∈[-1,1]、impact∈{high,medium,low}、horizon、一句話理由。
彙總成每檔標的的 news_score∈[-1,1],供 agent 作為「短期事件傾斜」疊加於因子分數
(僅小幅傾斜,不取代因子模型 — 新聞是煙霧,因子是火)。
"""
from __future__ import annotations

import json

import numpy as np
import pandas as pd

from ..llm.client import get_client
from ..utils import get_logger

log = get_logger("news")

# 規則式情緒詞庫(中英)
_POS = ["beat", "surge", "upgrade", "record", "growth", "approval", "win", "raise",
        "強", "買超", "成長", "創高", "調升", "獲利", "利多", "納入", "看好"]
_NEG = ["miss", "fall", "downgrade", "probe", "lawsuit", "delay", "cut", "warn",
        "弱", "賣超", "下滑", "調降", "虧損", "利空", "剔除", "看壞", "違約", "調查"]

_SYS = (
    "你是專業金融分析師。針對提供的新聞標題,判斷對該股票的影響。"
    "只輸出 JSON 陣列,每元素含:idx(整數)、sentiment(-1~1 浮點)、"
    "impact(high/medium/low)、horizon(intraday/days/weeks)、reason(20字內中文)。"
    "務必客觀,誇大標題給予折扣。"
)


def _rule_based(title: str) -> float:
    t = title.lower()
    pos = sum(w.lower() in t for w in _POS)
    neg = sum(w.lower() in t for w in _NEG)
    if pos == neg == 0:
        return 0.0
    return float(np.clip((pos - neg) / max(pos + neg, 1), -1, 1))


def analyze_news(items: list[dict]) -> list[dict]:
    """為每則新聞補上 sentiment/impact/reason。優先 LLM,失敗逐則退回規則式。"""
    if not items:
        return []
    client = get_client()
    enriched = [dict(it) for it in items]

    if client.available:
        payload = [{"idx": i, "title": it["title"], "ticker": it.get("ticker", "")}
                   for i, it in enumerate(items)]
        res = client.analyze_json(
            _SYS, "新聞清單:\n" + json.dumps(payload, ensure_ascii=False),
            max_tokens=2048)
        parsed = res.data
        rows = parsed if isinstance(parsed, list) else parsed.get("results", [])
        by_idx = {int(r.get("idx", -1)): r for r in rows if isinstance(r, dict)}
        for i, it in enumerate(enriched):
            r = by_idx.get(i)
            if r:
                it["sentiment"] = float(np.clip(r.get("sentiment", 0), -1, 1))
                it["impact"] = r.get("impact", "low")
                it["horizon"] = r.get("horizon", "days")
                it["reason"] = r.get("reason", "")
                it["analyzer"] = res.provider
            else:
                it["sentiment"] = _rule_based(it["title"])
                it["impact"] = "low"
                it["analyzer"] = "rule_based"
        return enriched

    # 全規則式
    for it in enriched:
        it["sentiment"] = _rule_based(it["title"])
        it["impact"] = "medium" if abs(it["sentiment"]) > 0.5 else "low"
        it["analyzer"] = "rule_based"
    return enriched


_IMPACT_W = {"high": 1.0, "medium": 0.6, "low": 0.3}


def aggregate_by_ticker(enriched: list[dict]) -> pd.DataFrame:
    """彙總成每檔 news_score(impact 加權的平均情緒)與標題數。"""
    if not enriched:
        return pd.DataFrame(columns=["ticker", "news_score", "n_news", "top_headline"])
    df = pd.DataFrame(enriched)
    df["w"] = df.get("impact", "low").map(_IMPACT_W).fillna(0.3)
    rows = []
    for tk, g in df.groupby("ticker"):
        wsum = g["w"].sum()
        score = float((g["sentiment"] * g["w"]).sum() / wsum) if wsum else 0.0
        top = g.reindex(g["sentiment"].abs().sort_values(ascending=False).index)
        rows.append({"ticker": tk, "news_score": round(np.clip(score, -1, 1), 3),
                     "n_news": len(g),
                     "top_headline": top.iloc[0]["title"] if len(top) else ""})
    return pd.DataFrame(rows)
