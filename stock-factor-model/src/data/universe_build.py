"""動態建立「全市場」股票池(live 模式用),取代寫死的少數樣本。

來源皆為免金鑰的官方開放資料:
  - 美股:NASDAQ Trader 符號目錄(nasdaqlisted + otherlisted,含 NYSE/NASDAQ/AMEX)
  - 台股:TWSE 開放資料(上市公司清單 + 全個股日成交)、TPEx 開放資料(上櫃)

流程:抓全清單 → 套用 universe.yaml 的流動性/資格過濾(剔除無法成交的標的)→
依 max_symbols 上限截斷 → 落地快取(每日一次)。

⚠️ 真正的「全市場每日掃描」對台股而言,後續價量/籌碼仍需 FinMind;免費額度無法支撐
   上千檔每日抓取。台股 max_symbols 預設為對免費額度友善的數量;有付費 FinMind 方案
   時可在 universe.yaml 調高。美股走 yfinance,免金鑰、可較廣。
"""
from __future__ import annotations

import datetime as dt
import io

import pandas as pd
import requests

from ..config import RAW_DIR, load_settings
from ..utils import get_logger, retry

log = get_logger("universe")

_NASDAQ_LISTED = "https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt"
_OTHER_LISTED = "https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt"
_TWSE_COMPANIES = "https://openapi.twse.com.tw/v1/opendata/t187ap03_L"
_TWSE_DAY_ALL = "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL"
_TPEX_DAY = "https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes"

_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) sfm-bot"


def _is_common_stock(sym: str) -> bool:
    """剔除權證(W)/單位(U)/權利(R)/特別股(P)等非普通股(常見於 5 字代號尾碼)。"""
    if not sym.isalpha():
        return False
    if len(sym) == 5 and sym[-1] in {"W", "U", "R", "P", "Q"}:
        return False
    return True


@retry(times=3, exc=(requests.RequestException,))
def _get(url: str, json: bool = True):
    # 純文字端點(NASDAQ 目錄)用 accept:json 會被某些 CDN 回 406,故依型別給對應 header
    headers = {"User-Agent": _UA,
               "accept": "application/json" if json else "text/plain, */*"}
    r = requests.get(url, timeout=30, headers=headers)
    r.raise_for_status()
    return r.json() if json else r.text


# ===========================================================================
# 美股
# ===========================================================================
def build_us_universe(max_symbols: int | None = None) -> pd.DataFrame:
    rows = []
    # NASDAQ-listed
    txt = _get(_NASDAQ_LISTED, json=False)
    df = pd.read_csv(io.StringIO(txt), sep="|").iloc[:-1]  # 末行為檔案產生時間
    df = df[(df.get("Test Issue", "N") == "N") & (df.get("ETF", "N") == "N")]
    for _, r in df.iterrows():
        sym = str(r["Symbol"]).strip()
        if _is_common_stock(sym):
            rows.append({"market": "US", "ticker": sym,
                         "name": str(r["Security Name"])[:60], "sector": "Unknown"})
    # NYSE / AMEX / others
    txt2 = _get(_OTHER_LISTED, json=False)
    df2 = pd.read_csv(io.StringIO(txt2), sep="|").iloc[:-1]
    df2 = df2[(df2.get("Test Issue", "N") == "N") & (df2.get("ETF", "N") == "N")]
    sym_col = "ACT Symbol" if "ACT Symbol" in df2.columns else "NASDAQ Symbol"
    seen = {r["ticker"] for r in rows}
    for _, r in df2.iterrows():
        sym = str(r[sym_col]).strip()
        if _is_common_stock(sym) and sym not in seen:
            seen.add(sym)
            rows.append({"market": "US", "ticker": sym,
                         "name": str(r["Security Name"])[:60], "sector": "Unknown"})
    out = pd.DataFrame(rows)
    log.info("美股全清單:%d 檔(NYSE+NASDAQ+AMEX 普通股)", len(out))
    if max_symbols:
        out = out.head(max_symbols)
    return out


# ===========================================================================
# 台股
# ===========================================================================
def _tw_industry_map() -> dict[str, dict]:
    try:
        comp = _get(_TWSE_COMPANIES)
        return {str(c["公司代號"]): {"name": c.get("公司簡稱", ""),
                                    "sector": c.get("產業別", "Unknown")}
                for c in comp}
    except Exception as e:  # noqa: BLE001
        log.warning("TWSE 公司清單抓取失敗:%s", e)
        return {}


def _num(x) -> float:
    try:
        return float(str(x).replace(",", ""))
    except (TypeError, ValueError):
        return float("nan")


def build_tw_universe(max_symbols: int | None = None,
                      min_dollar_volume: float = 0) -> pd.DataFrame:
    ind = _tw_industry_map()
    rows = []
    # 上市(TWSE):用全個股日成交做流動性過濾(TradeValue = 成交金額)
    try:
        day = _get(_TWSE_DAY_ALL)
        for d in day:
            code = str(d.get("Code", "")).strip()
            if not (code.isdigit() and len(code) == 4):  # 只要 4 碼普通股,排除權證/ETF等
                continue
            dvol = _num(d.get("TradeValue"))
            if dvol < min_dollar_volume:
                continue
            meta = ind.get(code, {})
            rows.append({"market": "TW", "ticker": f"{code}.TW",
                         "name": meta.get("name") or d.get("Name", code),
                         "sector": meta.get("sector", "Unknown"),
                         "_dvol": dvol})
    except Exception as e:  # noqa: BLE001
        log.warning("TWSE 全個股日成交抓取失敗:%s", e)
    # 上櫃(TPEx)
    try:
        otc = _get(_TPEX_DAY)
        for d in otc:
            code = str(d.get("SecuritiesCompanyCode", "")).strip()
            if not (code.isdigit() and len(code) == 4):
                continue
            rows.append({"market": "TW", "ticker": f"{code}.TWO",
                         "name": d.get("CompanyName", code),
                         "sector": ind.get(code, {}).get("sector", "Unknown"),
                         "_dvol": _num(d.get("TradeValue", 0))})
    except Exception as e:  # noqa: BLE001
        log.warning("TPEx 抓取失敗:%s", e)

    out = pd.DataFrame(rows)
    if out.empty:
        return out
    out = out.drop_duplicates("ticker").sort_values("_dvol", ascending=False)
    log.info("台股全清單(流動性過濾後):%d 檔", len(out))
    if max_symbols:
        out = out.head(max_symbols)  # 依成交金額取前段,優先涵蓋可成交標的
    return out.drop(columns=["_dvol"]).reset_index(drop=True)


# ===========================================================================
# 入口
# ===========================================================================
def build_universe(markets: list[str], caps: dict[str, int] | None = None,
                   use_cache: bool = True) -> pd.DataFrame:
    s = load_settings()
    caps = caps or s.universe.get("live", {}).get("max_symbols", {})
    filters = s.universe.get("filters", {})
    today = dt.date.today().isoformat()
    cache_file = RAW_DIR / f"universe_{today}.parquet"
    if use_cache and cache_file.exists():
        df = pd.read_parquet(cache_file)
        return df[df.market.isin(markets)]

    parts = []
    if "US" in markets:
        parts.append(build_us_universe(caps.get("US")))
    if "TW" in markets:
        min_dv = filters.get("TW", {}).get("min_avg_dollar_volume_twd", 0)
        parts.append(build_tw_universe(caps.get("TW"), min_dollar_volume=min_dv))
    out = pd.concat(parts, ignore_index=True) if parts else pd.DataFrame(
        columns=["market", "ticker", "name", "sector"])
    if not out.empty:
        out.to_parquet(cache_file, index=False)
    return out
