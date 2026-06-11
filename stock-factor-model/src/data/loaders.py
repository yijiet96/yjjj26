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
    prices, funds, events = [], [], pd.DataFrame()
    univ_rows = []
    chips_tw = pd.DataFrame()

    if "US" in markets:
        us = us_tickers or _default_us_tickers()
        prices.append(providers.fetch_us_prices(us, start, end))
        funds.append(providers.fetch_us_fundamentals(us))
        univ_rows += [{"market": "US", "ticker": t, "name": t, "sector": "Unknown"} for t in us]
    if "TW" in markets:
        tw = tw_tickers or _default_tw_tickers()
        prices.append(providers.fetch_tw_prices(tw, start, end))
        chips_tw = providers.fetch_tw_chips(tw, start, end)
        univ_rows += [{"market": "TW", "ticker": t, "name": t, "sector": "Unknown"} for t in tw]

    return DataBundle(
        universe=pd.DataFrame(univ_rows),
        prices=pd.concat(prices, ignore_index=True) if prices else pd.DataFrame(),
        fundamentals=pd.concat(funds, ignore_index=True) if funds else pd.DataFrame(),
        chips_tw=chips_tw,
        index_events=events,
        mode="live",
    )


def _default_us_tickers() -> list[str]:
    return ["AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "META", "TSLA", "JPM",
            "V", "UNH", "XOM", "JNJ", "PG", "KO", "WMT", "HD", "BAC", "MA",
            "DIS", "ADBE"]


def _default_tw_tickers() -> list[str]:
    return ["2330.TW", "2317.TW", "2454.TW", "2308.TW", "2382.TW", "2412.TW",
            "2881.TW", "2882.TW", "2303.TW", "3711.TW", "1301.TW", "1303.TW",
            "2002.TW", "2207.TW", "2603.TW"]
