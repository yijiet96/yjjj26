"""資料層的正規結構 (canonical schemas)。所有抓取器都需產出這些欄位,
下游因子/統計層只依賴這裡定義的契約,與資料來源解耦。

長表 (long/tidy) 為主,索引用整數,以 date+ticker 當鍵。
"""
from __future__ import annotations

# 價量(日頻)
PRICE_COLS = [
    "date", "market", "ticker",
    "open", "high", "low", "close", "adj_close", "volume",
]

# 財報(PIT:以「公布日」announce_date 對齊,嚴禁用季底日 — CLAUDE.md 第 8 節)
FUNDAMENTAL_COLS = [
    "ticker", "market", "announce_date", "fiscal_period", "sector",
    "eps_ttm", "book_value_ps", "revenue_ttm", "ebitda", "ev",
    "fcf", "dividend_ttm", "gross_profit", "total_assets",
    "net_income", "operating_cf", "equity", "total_debt", "shares_out",
    "roe", "roic", "revenue_yoy", "eps_yoy", "asset_growth",
    "f_score", "accruals", "debt_ratio",
]

# 籌碼(台股日頻;美股為季/事件頻)
CHIP_TW_COLS = [
    "date", "ticker",
    "foreign_net_shares", "trust_net_shares", "dealer_net_shares",
    "inst_holding_pct", "margin_balance", "short_balance",
    "big_holder_pct", "branch_top_net", "branch_total_vol",
    "smart_branch_net", "pledge_ratio", "shares_out",
]

CHIP_US_COLS = [
    "date", "ticker",
    "inst_holding_pct_13f", "short_interest_pct", "insider_net_shares",
]

# 被動資金 / ETF
ETF_FLOW_COLS = ["date", "etf", "net_creation_value"]
ETF_HOLDING_COLS = ["etf", "ticker", "weight", "as_of"]
INDEX_EVENT_COLS = ["ticker", "market", "event", "effective_date"]  # event: include/exclude

MARKETS = ["TW", "US"]
