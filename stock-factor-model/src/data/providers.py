"""真實資料抓取器(live)。台股用 FinMind,美股用 yfinance。

所有抓取器:
  - 以 @retry 包裝,API 限額/暫時性錯誤會指數退避重試。
  - 下載後落地快取(parquet),避免重複請求(見 CLAUDE.md 第 2 節)。
  - 缺套件/缺金鑰時丟出明確錯誤,由 loaders 決定是否退回 demo。

⚠️ PIT 鐵則:財報一律以「公布日」對齊。FinMind 財報資料的 `date` 為財報所屬季底,
我們以 MOPS 慣例估計公布日(季底 + 約 45 天),真實上線建議改接公布日精確來源。
"""
from __future__ import annotations

import pandas as pd

from ..config import load_settings
from ..utils import get_logger, retry, save_df

log = get_logger("data")


# ===========================================================================
# 美股:yfinance
# ===========================================================================
@retry(times=4)
def fetch_us_prices(tickers: list[str], start: str, end: str) -> pd.DataFrame:
    import yfinance as yf
    log.info("yfinance 下載 %d 檔美股價量 %s~%s", len(tickers), start, end)
    raw = yf.download(tickers, start=start, end=end, auto_adjust=False,
                      group_by="ticker", progress=False, threads=True)
    frames = []
    for tk in tickers:
        try:
            sub = raw[tk] if isinstance(raw.columns, pd.MultiIndex) else raw
        except KeyError:
            continue
        sub = sub.dropna(how="all")
        if sub.empty:
            continue
        frames.append(pd.DataFrame({
            "date": sub.index, "market": "US", "ticker": tk,
            "open": sub["Open"].values, "high": sub["High"].values,
            "low": sub["Low"].values, "close": sub["Close"].values,
            "adj_close": sub.get("Adj Close", sub["Close"]).values,
            "volume": sub["Volume"].values,
        }))
    if not frames:
        raise RuntimeError("yfinance 未取得任何美股資料")
    df = pd.concat(frames, ignore_index=True)
    save_df(df, "us_prices")
    return df


@retry(times=4)
def fetch_us_fundamentals(tickers: list[str]) -> pd.DataFrame:
    """美股財報(yfinance 提供有限欄位;FMP 金鑰存在時可擴充)。"""
    import yfinance as yf
    rows = []
    for tk in tickers:
        try:
            info = yf.Ticker(tk).info
        except Exception:  # noqa: BLE001
            continue
        rows.append({
            "ticker": tk, "market": "US",
            "announce_date": pd.Timestamp.today().normalize(),
            "fiscal_period": "latest", "sector": info.get("sector", "Unknown"),
            "eps_ttm": info.get("trailingEps"),
            "book_value_ps": info.get("bookValue"),
            "revenue_ttm": info.get("totalRevenue"),
            "ebitda": info.get("ebitda"), "ev": info.get("enterpriseValue"),
            "fcf": info.get("freeCashflow"),
            "dividend_ttm": info.get("dividendRate") or 0,
            "gross_profit": info.get("grossProfits"),
            "total_assets": info.get("totalAssets"),
            "net_income": info.get("netIncomeToCommon"),
            "operating_cf": info.get("operatingCashflow"),
            "equity": info.get("totalStockholderEquity"),
            "total_debt": info.get("totalDebt"),
            "shares_out": info.get("sharesOutstanding"),
            "roe": info.get("returnOnEquity"), "roic": None,
            "revenue_yoy": info.get("revenueGrowth"),
            "eps_yoy": info.get("earningsGrowth"),
            "asset_growth": None, "f_score": None,
            "accruals": None, "debt_ratio": info.get("debtToEquity"),
        })
    df = pd.DataFrame(rows)
    save_df(df, "us_fundamentals")
    return df


# ===========================================================================
# 台股:FinMind
# ===========================================================================
def _finmind_api():
    from FinMind.data import DataLoader
    api = DataLoader()
    token = load_settings().key("FINMIND_TOKEN")
    if token:
        try:
            api.login_by_token(api_token=token)
        except Exception as e:  # noqa: BLE001
            log.warning("FinMind 登入失敗(將用匿名額度):%s", e)
    return api


@retry(times=4)
def fetch_tw_prices(tickers: list[str], start: str, end: str) -> pd.DataFrame:
    api = _finmind_api()
    frames = []
    for tk in tickers:
        sid = tk.replace(".TW", "").replace(".TWO", "")
        try:
            d = api.taiwan_stock_daily(stock_id=sid, start_date=start, end_date=end)
        except Exception as e:  # noqa: BLE001
            log.warning("FinMind 價量 %s 失敗:%s", tk, e)
            continue
        if d is None or d.empty:
            continue
        frames.append(pd.DataFrame({
            "date": pd.to_datetime(d["date"]), "market": "TW", "ticker": tk,
            "open": d["open"], "high": d["max"], "low": d["min"],
            "close": d["close"], "adj_close": d["close"],
            "volume": d["Trading_Volume"],
        }))
    if not frames:
        raise RuntimeError("FinMind 未取得任何台股價量")
    df = pd.concat(frames, ignore_index=True)
    save_df(df, "tw_prices")
    return df


@retry(times=4)
def fetch_tw_chips(tickers: list[str], start: str, end: str) -> pd.DataFrame:
    """三大法人買賣超 + 融資券。其餘籌碼欄位(分點/集保/質押)需額外資料源,缺則留空。"""
    api = _finmind_api()
    frames = []
    for tk in tickers:
        sid = tk.replace(".TW", "").replace(".TWO", "")
        try:
            inst = api.taiwan_stock_institutional_investors(
                stock_id=sid, start_date=start, end_date=end)
            margin = api.taiwan_stock_margin_purchase_short_sale(
                stock_id=sid, start_date=start, end_date=end)
        except Exception as e:  # noqa: BLE001
            log.warning("FinMind 籌碼 %s 失敗:%s", tk, e)
            continue
        if inst is None or inst.empty:
            continue
        piv = inst.pivot_table(index="date", columns="name",
                               values="buy", aggfunc="sum").fillna(0)
        sell = inst.pivot_table(index="date", columns="name",
                                values="sell", aggfunc="sum").fillna(0)
        net = piv.sub(sell, fill_value=0)
        idx = pd.to_datetime(net.index)
        out = pd.DataFrame({"date": idx, "ticker": tk})
        out["foreign_net_shares"] = net.get("Foreign_Investor", 0).values
        out["trust_net_shares"] = net.get("Investment_Trust", 0).values
        out["dealer_net_shares"] = (
            net.get("Dealer_self", 0).values + net.get("Dealer_Hedging", 0).values
            if "Dealer_self" in net else net.get("Dealer", 0).values)
        if margin is not None and not margin.empty:
            m = margin.set_index("date")
            out = out.merge(
                pd.DataFrame({"date": pd.to_datetime(m.index),
                              "margin_balance": m.get("MarginPurchaseTodayBalance", 0).values,
                              "short_balance": m.get("ShortSaleTodayBalance", 0).values}),
                on="date", how="left")
        frames.append(out)
    if not frames:
        raise RuntimeError("FinMind 未取得任何台股籌碼")
    df = pd.concat(frames, ignore_index=True)
    # 補上目前資料源未涵蓋的欄位(留 NaN,因子層會走缺漏處理)
    for c in ["inst_holding_pct", "big_holder_pct", "branch_top_net",
              "branch_total_vol", "smart_branch_net", "pledge_ratio", "shares_out"]:
        if c not in df:
            df[c] = pd.NA
    save_df(df, "tw_chips")
    return df
