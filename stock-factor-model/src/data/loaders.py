"""資料層門面 (facade):統一提供整套資料,並處理 demo↔live 切換與 PIT 對齊。

對外只暴露 `load_bundle(...)`,回傳 DataBundle。下游因子層只認識 DataBundle,
完全不需知道資料來自 yfinance、FinMind 還是 synthetic。
"""
from __future__ import annotations

from dataclasses import dataclass

import pandas as pd

from ..config import load_settings
from ..utils import get_logger
from . import synthetic
from .schema import MARKETS

log = get_logger("data")


@dataclass
class DataBundle:
    universe: pd.DataFrame          # market, ticker, name, sector
    prices: pd.DataFrame            # PRICE_COLS (+ sector)
    fundamentals: pd.DataFrame      # FUNDAMENTAL_COLS,以 announce_date 對齊
    chips_tw: pd.DataFrame          # CHIP_TW_COLS
    index_events: pd.DataFrame      # INDEX_EVENT_COLS
    mode: str = "demo"

    # ---- PIT 取數:回傳「截至 as_of 日」最新一筆已公布財報 -----------------
    def fundamentals_asof(self, as_of: pd.Timestamp) -> pd.DataFrame:
        """嚴防前視偏誤:只取 announce_date <= as_of 的財報,每檔取最新一筆。"""
        f = self.fundamentals
        f = f[pd.to_datetime(f["announce_date"]) <= as_of]
        if f.empty:
            return f
        f = f.sort_values("announce_date").groupby("ticker", as_index=False).tail(1)
        return f.reset_index(drop=True)

    def prices_upto(self, as_of: pd.Timestamp) -> pd.DataFrame:
        p = self.prices
        return p[pd.to_datetime(p["date"]) <= as_of]

    def sectors(self) -> pd.Series:
        return self.universe.set_index("ticker")["sector"]


def load_bundle(start: str, end: str, *, demo: bool = True,
                markets: list[str] | None = None,
                tw_tickers: list[str] | None = None,
                us_tickers: list[str] | None = None) -> DataBundle:
    """載入整套資料。demo=True 用合成資料(離線即可跑);demo=False 走真實 API。"""
    markets = markets or load_settings().markets or MARKETS

    if demo:
        log.info("DEMO 模式:使用合成資料 %s~%s", start, end)
        d = synthetic.build_all(start, end)
        univ = d["universe"][d["universe"].market.isin(markets)]
        return DataBundle(
            universe=univ,
            prices=d["prices"][d["prices"].market.isin(markets)],
            fundamentals=d["fundamentals"][d["fundamentals"].market.isin(markets)],
            chips_tw=d["chips_tw"],
            index_events=d["index_events"][d["index_events"].market.isin(markets)],
            mode="demo",
        )

    # ---- live --------------------------------------------------------------
    from . import providers
    from .universe_build import build_universe
    s = load_settings()
    live_cfg = s.universe.get("live", {})
    caps = live_cfg.get("max_symbols", {})
    batch = live_cfg.get("batch_size", 200)
    fund_limit = live_cfg.get("fundamentals_limit", 400)

    # 1) 股票池:明確指定則用之,否則動態建立全市場
    if us_tickers or tw_tickers:
        rows = ([{"market": "US", "ticker": t, "name": t, "sector": "Unknown"} for t in (us_tickers or [])]
                + [{"market": "TW", "ticker": t, "name": t, "sector": "Unknown"} for t in (tw_tickers or [])])
        universe = pd.DataFrame(rows)
    else:
        universe = build_universe(markets, caps)
    universe = universe[universe.market.isin(markets)].reset_index(drop=True)
    log.info("live 股票池:%s", universe.groupby("market").size().to_dict())

    prices_list, funds_list = [], []
    chips_tw = pd.DataFrame()

    if "US" in markets:
        us = universe[universe.market == "US"]["ticker"].tolist()
        if us:
            prices_list.append(providers.fetch_us_prices(us, start, end, batch_size=batch))
    if "TW" in markets:
        tw = universe[universe.market == "TW"]["ticker"].tolist()
        if tw:
            try:
                prices_list.append(providers.fetch_tw_prices(tw, start, end))
            except Exception as e:  # noqa: BLE001  FinMind 額度/網路問題不應中斷整體
                log.warning("台股價量抓取失敗(可能 FinMind 免費額度):%s", e)
            try:
                chips_tw = providers.fetch_tw_chips(tw, start, end)
            except Exception as e:  # noqa: BLE001
                log.warning("台股籌碼抓取失敗:%s", e)

    prices = pd.concat(prices_list, ignore_index=True) if prices_list else pd.DataFrame()
    # 2) 流動性過濾:剔除價格過低/成交量過低(無法實際成交)的標的
    prices = _apply_liquidity_filter(prices, s.universe.get("filters", {}))
    kept = set(prices["ticker"].unique()) if not prices.empty else set()
    universe = universe[universe.ticker.isin(kept)].reset_index(drop=True)

    # 3) 美股財報:逐檔較慢,依近 20 日成交額排序只抓前段,控制執行時間
    if "US" in markets and not prices.empty:
        us_top = _rank_by_dollar_volume(prices, "US", fund_limit)
        if us_top:
            funds_list.append(providers.fetch_us_fundamentals(us_top))
    fundamentals = pd.concat(funds_list, ignore_index=True) if funds_list else pd.DataFrame()

    return DataBundle(
        universe=universe,
        prices=prices,
        fundamentals=fundamentals,
        chips_tw=chips_tw,
        index_events=pd.DataFrame(columns=["ticker", "market", "event", "effective_date"]),
        mode="live",
    )


def _liquidity_stats(g: pd.DataFrame) -> pd.DataFrame:
    """每檔:最新價、近 20 日平均成交金額(dvol)、全期可用交易日數(n)。"""
    g = g.sort_values("date")
    total = g.groupby("ticker")["close"].count().rename("n")
    last20 = g.groupby("ticker").tail(20).copy()
    last20["dv"] = last20["close"] * last20["volume"]
    agg = last20.groupby("ticker").agg(price=("close", "last"), dvol=("dv", "mean"))
    return agg.join(total)


def _apply_liquidity_filter(prices: pd.DataFrame, filters: dict) -> pd.DataFrame:
    if prices.empty:
        return prices
    keep = []
    for mkt, g in prices.groupby("market"):
        f = filters.get(mkt, {})
        stats = _liquidity_stats(g)
        min_price = f.get("min_price_usd", 0) if mkt == "US" else 0
        min_dvol = (f.get("min_avg_dollar_volume_usd", 0) if mkt == "US"
                    else f.get("min_avg_dollar_volume_twd", 0))
        ok = stats[(stats["price"] >= min_price) & (stats["dvol"] >= min_dvol)
                   & (stats["n"] >= 30)].index
        keep += list(ok)
    out = prices[prices.ticker.isin(keep)].reset_index(drop=True)
    log.info("流動性過濾:%d → %d 檔", prices.ticker.nunique(), out.ticker.nunique())
    return out


def _rank_by_dollar_volume(prices: pd.DataFrame, market: str, top_n: int) -> list[str]:
    g = prices[prices.market == market]
    if g.empty:
        return []
    stats = _liquidity_stats(g).sort_values("dvol", ascending=False)
    return stats.head(top_n).index.tolist()


def _default_us_tickers() -> list[str]:
    return ["AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "META", "TSLA", "JPM",
            "V", "UNH", "XOM", "JNJ", "PG", "KO", "WMT", "HD", "BAC", "MA",
            "DIS", "ADBE"]


def _default_tw_tickers() -> list[str]:
    return ["2330.TW", "2317.TW", "2454.TW", "2308.TW", "2382.TW", "2412.TW",
            "2881.TW", "2882.TW", "2303.TW", "3711.TW", "1301.TW", "1303.TW",
            "2002.TW", "2207.TW", "2603.TW"]
