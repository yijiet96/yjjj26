"""合成資料產生器 (demo / 離線模式)。

目的:讓使用者**零金鑰、零網路**即可跑完整條流程,親眼看到輸出長相後再接真實資料。
產生的資料刻意植入「因子確實有效」的結構(品質/價值/動能高的股票未來報酬略高),
讓回測與 IC 呈現合理(但不誇張)的訊號 — 純為展示流程,非真實市場。
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from .schema import MARKETS

_SECTORS = ["科技", "金融", "傳產", "生技", "消費", "原物料"]


def _rng(seed: int) -> np.random.Generator:
    return np.random.default_rng(seed)


def make_universe(n_tw: int = 40, n_us: int = 40, seed: int = 7) -> pd.DataFrame:
    rng = _rng(seed)
    rows = []
    for i in range(n_tw):
        rows.append({"market": "TW", "ticker": f"{2000 + i*7 % 7000 + i:04d}.TW",
                     "name": f"台股{i:02d}", "sector": _SECTORS[i % len(_SECTORS)]})
    us_tickers = ["AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "META", "TSLA", "JPM",
                  "V", "UNH", "XOM", "JNJ", "PG", "KO", "PEP", "WMT", "HD", "BAC",
                  "MA", "DIS"]
    for i in range(n_us):
        tk = us_tickers[i] if i < len(us_tickers) else f"US{i:03d}"
        rows.append({"market": "US", "ticker": tk,
                     "name": tk, "sector": _SECTORS[i % len(_SECTORS)]})
    return pd.DataFrame(rows)


def _quality_score(rng, n):
    """每檔股票的隱含『真實品質』,驅動價格漂移與基本面指標,讓因子有預測力。"""
    return rng.normal(0, 1, n)


def make_prices(univ: pd.DataFrame, start: str, end: str, seed: int = 7) -> pd.DataFrame:
    rng = _rng(seed)
    dates = pd.bdate_range(start, end)
    n = len(univ)
    quality = _quality_score(rng, n)
    frames = []
    for j, (_, row) in enumerate(univ.iterrows()):
        # 年化漂移與品質正相關;波動隨機。
        # 刻意讓「品質」對報酬有可偵測(但非誇張)的影響,使 demo 的 IC/回測呈現合理正訊號。
        drift = 0.05 + 0.11 * quality[j]
        vol = rng.uniform(0.14, 0.30)
        dt = 1 / 252
        shocks = rng.normal((drift - 0.5 * vol**2) * dt, vol * np.sqrt(dt), len(dates))
        price = 100 * np.exp(np.cumsum(shocks))
        base_vol = rng.uniform(1e6, 3e7)
        vols = (base_vol * (1 + 0.3 * rng.standard_normal(len(dates)))).clip(min=1e4)
        close = pd.Series(price, index=dates)
        frames.append(pd.DataFrame({
            "date": dates, "market": row["market"], "ticker": row["ticker"],
            "open": close.values * (1 + rng.normal(0, 0.003, len(dates))),
            "high": close.values * (1 + abs(rng.normal(0, 0.01, len(dates)))),
            "low": close.values * (1 - abs(rng.normal(0, 0.01, len(dates)))),
            "close": close.values, "adj_close": close.values, "volume": vols,
            "_quality": quality[j], "sector": row["sector"],
        }))
    return pd.concat(frames, ignore_index=True)


def make_fundamentals(univ: pd.DataFrame, prices: pd.DataFrame,
                      start: str, end: str, seed: int = 7) -> pd.DataFrame:
    """季報,以公布日對齊(季底後約 45 天公布,模擬 PIT 延遲)。"""
    rng = _rng(seed)
    q = prices.groupby("ticker")["_quality"].first()
    rows = []
    for qtr_end in pd.date_range(start, end, freq="QE"):
        announce = qtr_end + pd.Timedelta(days=45)  # 模擬公布延遲
        for _, r in univ.iterrows():
            tk = r["ticker"]
            ql = float(q.get(tk, 0.0))
            roe = np.clip(0.10 + 0.05 * ql + rng.normal(0, 0.03), -0.2, 0.5)
            rows.append({
                "ticker": tk, "market": r["market"], "announce_date": announce,
                "fiscal_period": str(qtr_end.date()), "sector": r["sector"],
                "eps_ttm": 5 + 3 * ql + rng.normal(0, 1),
                "book_value_ps": 40 + rng.normal(0, 10),
                "revenue_ttm": 1e9 * (1 + 0.3 * ql) * rng.uniform(0.5, 2),
                "ebitda": 2e8 * (1 + 0.3 * ql) * rng.uniform(0.5, 1.5),
                "ev": 3e9 * rng.uniform(0.5, 2),
                "fcf": 1.5e8 * (1 + 0.3 * ql) * rng.uniform(0.2, 1.5),
                "dividend_ttm": max(0, 2 + ql + rng.normal(0, 0.5)),
                "gross_profit": 4e8 * (1 + 0.2 * ql),
                "total_assets": 5e9 * rng.uniform(0.5, 2),
                "net_income": 3e8 * (1 + 0.3 * ql),
                "operating_cf": 3.5e8 * (1 + 0.3 * ql),
                "equity": 2e9 * rng.uniform(0.5, 1.5),
                "total_debt": 1e9 * rng.uniform(0.2, 1.5),
                "shares_out": 5e8 * rng.uniform(0.3, 3),
                "roe": roe, "roic": roe * 0.8,
                "revenue_yoy": 0.05 + 0.08 * ql + rng.normal(0, 0.05),
                "eps_yoy": 0.05 + 0.10 * ql + rng.normal(0, 0.08),
                "asset_growth": np.clip(0.08 - 0.03 * ql + rng.normal(0, 0.05), -0.2, 0.6),
                "f_score": int(np.clip(round(5 + 2 * ql + rng.normal(0, 1)), 0, 9)),
                "accruals": -0.02 - 0.01 * ql + rng.normal(0, 0.02),
                "debt_ratio": np.clip(0.45 - 0.03 * ql + rng.normal(0, 0.1), 0.05, 0.9),
            })
    return pd.DataFrame(rows)


def make_chips_tw(univ: pd.DataFrame, prices: pd.DataFrame, seed: int = 7) -> pd.DataFrame:
    rng = _rng(seed)
    tw = univ[univ.market == "TW"]
    q = prices.groupby("ticker")["_quality"].first()
    dates = sorted(prices["date"].unique())
    rows = []
    for _, r in tw.iterrows():
        tk = r["ticker"]
        ql = float(q.get(tk, 0.0))
        shares = rng.uniform(2e8, 2e9)
        # 法人傾向買品質好的股票 → 與報酬正相關
        foreign = rng.normal(ql * 5e5, 2e6, len(dates))
        trust = rng.normal(ql * 2e5, 1e6, len(dates))
        rows.append(pd.DataFrame({
            "date": dates, "ticker": tk,
            "foreign_net_shares": foreign, "trust_net_shares": trust,
            "dealer_net_shares": rng.normal(0, 5e5, len(dates)),
            "inst_holding_pct": np.clip(0.3 + 0.1 * ql + np.cumsum(foreign) / shares / 50, 0, 0.9),
            "margin_balance": (rng.uniform(1e6, 1e7) * (1 + 0.1 * rng.standard_normal(len(dates)))).clip(min=0),
            "short_balance": (rng.uniform(1e5, 2e6) * (1 + 0.2 * rng.standard_normal(len(dates)))).clip(min=0),
            "big_holder_pct": np.clip(0.4 + 0.05 * ql + 0.02 * np.cumsum(rng.normal(0, 0.01, len(dates))), 0.1, 0.9),
            "branch_top_net": rng.normal(ql * 1e5, 5e5, len(dates)),
            "branch_total_vol": rng.uniform(1e6, 1e7, len(dates)),
            "smart_branch_net": rng.normal(ql * 3e4, 3e5, len(dates)),
            "pledge_ratio": np.clip(rng.uniform(0, 0.4) + rng.normal(0, 0.01, len(dates)), 0, 0.95),
            "shares_out": shares,
        }))
    return pd.concat(rows, ignore_index=True)


def make_index_events(univ: pd.DataFrame, start: str, end: str, seed: int = 7) -> pd.DataFrame:
    rng = _rng(seed + 3)
    rows = []
    dates = pd.date_range(start, end, freq="QE")
    for _, r in univ.iterrows():
        if rng.random() < 0.08:  # 少數個股有納入/剔除事件
            d = dates[rng.integers(0, len(dates))]
            rows.append({"ticker": r["ticker"], "market": r["market"],
                         "event": "include" if rng.random() < 0.7 else "exclude",
                         "effective_date": d})
    return pd.DataFrame(rows, columns=["ticker", "market", "event", "effective_date"])


def build_all(start: str, end: str, seed: int = 7) -> dict[str, pd.DataFrame]:
    """一次產生整套 demo 資料集。"""
    univ = make_universe(seed=seed)
    prices = make_prices(univ, start, end, seed)
    fundamentals = make_fundamentals(univ, prices, start, end, seed)
    chips_tw = make_chips_tw(univ, prices, seed)
    events = make_index_events(univ, start, end, seed)
    return {
        "universe": univ,
        "prices": prices,
        "fundamentals": fundamentals,
        "chips_tw": chips_tw,
        "index_events": events,
    }
