"""自動化投資研究代理 — 每日主流程 (orchestrator)。

一鍵跑完:載入資料 → 計算因子 → 合成排序 → 取候選 → 抓新聞並分析 →
社群輿情 → 將新聞/社群作「小幅短期傾斜」疊加 → 產出簡報 →(選用)寄信。

紀律:新聞/社群只作有上限的傾斜(overlay),不取代因子模型;
      因子是火,新聞社群是煙。final = composite_z + clip(news+social tilt, ±cap)。
"""
from __future__ import annotations

import datetime as dt

import numpy as np
import pandas as pd

from ..config import REPORTS_DIR, load_settings
from ..data.loaders import load_bundle
from ..factors.compute import compute_panel
from ..news import analyze as news_analyze
from ..news import fetch as news_fetch
from ..output.candidates import build_candidates
from ..output.report import save_report
from ..social import leaders as social_mod
from ..stats.compose import compose_all
from ..utils import get_logger, save_json

log = get_logger("agent")

NEWS_TILT_CAP = 0.5      # 新聞對 z 化綜合分的最大傾斜
SOCIAL_TILT_CAP = 0.3    # 社群更低


def _latest_trading_day(bundle) -> pd.Timestamp:
    return pd.to_datetime(bundle.prices["date"]).max()


def run_daily(*, demo: bool = True, start: str | None = None,
              end: str | None = None, top_n: int | None = None,
              with_news: bool = True, with_social: bool = True,
              markets: list[str] | None = None) -> dict:
    """執行每日選股流程,回傳 context dict(同時已存檔報告)。"""
    today = dt.date.today()
    end = end or today.isoformat()
    # 需要足夠回溯(最長因子 252 交易日 ≈ 14 個月日曆),預設抓近 2 年
    start = start or (pd.Timestamp(end) - pd.Timedelta(days=730)).date().isoformat()

    log.info("=== 每日研究代理啟動 | mode=%s | %s~%s ===",
             "demo" if demo else "live", start, end)

    # 1) 資料
    bundle = load_bundle(start, end, demo=demo, markets=markets)
    as_of = _latest_trading_day(bundle)

    # 2) 因子 + 3) 合成
    panel = compute_panel(bundle, as_of)
    if panel.empty:
        raise RuntimeError("因子面板為空,請檢查資料來源/期間。")
    scored = compose_all(panel)

    # 4) 候選
    cand = build_candidates(scored, top_n=top_n)
    cand_tickers = cand["ticker"].tolist()
    name_map = bundle.universe.set_index("ticker")["name"].to_dict()

    # 5) 新聞
    news_by_ticker = pd.DataFrame()
    market_headlines: list[dict] = []
    analyzer = "rule_based"
    if with_news:
        items = []
        for tk in cand_tickers:
            got = news_fetch.fetch_for_ticker(tk, name_map.get(tk))
            items += got
        if not items:  # 離線/無網路 → demo 新聞展示流程
            items = news_fetch.demo_news(cand_tickers)
        enriched = news_analyze.analyze_news(items)
        if enriched:
            analyzer = enriched[0].get("analyzer", "rule_based")
        news_by_ticker = news_analyze.aggregate_by_ticker(enriched)
        market_headlines = news_fetch.fetch_market_headlines() or \
            [{"title": it["title"], "link": it.get("link", "")} for it in items[:8]]

    # 6) 社群
    social_by_ticker = pd.DataFrame()
    social_sent = 0.0
    n_social = 0
    if with_social:
        soc = social_mod.run_social()
        social_by_ticker = soc["by_ticker"]
        social_sent = soc["market_sentiment"]
        n_social = soc["n_posts"]

    # 7) 疊加傾斜(以 z 化綜合分為基礎,加入有上限的新聞+社群傾斜)
    cand = _apply_overlays(cand, news_by_ticker, social_by_ticker)

    # 8) 報告
    ctx = {
        "date": end,
        "mode": bundle.mode,
        "analyzer": analyzer,
        "candidates": cand,
        "news_by_ticker": news_by_ticker,
        "social_by_ticker": social_by_ticker,
        "social_market_sentiment": social_sent,
        "n_social_posts": n_social,
        "market_headlines": market_headlines,
        "scored": scored,
    }
    paths = save_report(ctx)
    ctx["report_paths"] = paths

    # 機器可讀輸出(供下游/通知用)
    save_json({
        "date": end, "mode": bundle.mode,
        "candidates": cand.to_dict("records"),
        "social_market_sentiment": social_sent,
    }, REPORTS_DIR / f"daily_{end}.json")

    log.info("=== 完成:候選 %d 檔,報告 → %s ===", len(cand), paths["latest"])
    return ctx


def _apply_overlays(cand: pd.DataFrame, news: pd.DataFrame,
                    social: pd.DataFrame) -> pd.DataFrame:
    """把新聞/社群分數轉成有上限的傾斜,加到綜合分上得到 final_score 並重排。"""
    if cand.empty:
        return cand
    cand = cand.copy()
    base = cand["composite"].astype(float)
    z = (base - base.mean()) / (base.std(ddof=0) + 1e-9)

    nmap = news.set_index("ticker")["news_score"].to_dict() if not news.empty else {}
    smap = social.set_index("ticker")["social_score"].to_dict() if not social.empty else {}
    cand["news_score"] = cand["ticker"].map(nmap)
    cand["social_score"] = cand["ticker"].map(smap)

    news_tilt = cand["ticker"].map(nmap).fillna(0).clip(-1, 1) * NEWS_TILT_CAP
    social_tilt = cand["ticker"].map(smap).fillna(0).clip(-1, 1) * SOCIAL_TILT_CAP
    cand["final_score"] = (z.values + news_tilt.values + social_tilt.values)
    cand = cand.sort_values(["market", "final_score"], ascending=[True, False])
    cand["final_score"] = cand["final_score"].round(3)
    return cand.reset_index(drop=True)
