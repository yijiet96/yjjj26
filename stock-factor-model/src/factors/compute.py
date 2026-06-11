"""第二層:因子計算。對單一再平衡日 as_of,輸出全市場個股的橫斷面因子快照。

嚴守 PIT:財報只用 announce_date <= as_of 者;技術/籌碼只用 <= as_of 的價量。
因子名稱與 config/factors.yaml 的鍵完全一致,讓統計層能用 config 的 direction/weight。
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from ..data.loaders import DataBundle
from ..utils import get_logger

log = get_logger("factors")


# ---------------------------------------------------------------------------
# 輔助:建立各市場等權指數作為大盤 proxy(rel_strength / beta 用)
# ---------------------------------------------------------------------------
def _market_index(prices: pd.DataFrame) -> dict[str, pd.Series]:
    out = {}
    for mkt, g in prices.groupby("market"):
        wide = g.pivot_table(index="date", columns="ticker", values="adj_close")
        ret = wide.pct_change()
        out[mkt] = (1 + ret.mean(axis=1)).cumprod()
    return out


def _series(prices_tk: pd.DataFrame) -> pd.Series:
    return prices_tk.set_index("date")["adj_close"].sort_index()


# ---------------------------------------------------------------------------
# 技術面
# ---------------------------------------------------------------------------
def _technical(px: pd.Series, idx: pd.Series) -> dict[str, float]:
    n = len(px)
    out: dict[str, float] = {}
    if n < 30:
        return out
    last = px.iloc[-1]
    # 12-1 動能:t-252 ~ t-21
    if n >= 252:
        out["tech_momentum_12_1"] = px.iloc[-21] / px.iloc[-252] - 1
        out["tech_52w_high"] = last / px.iloc[-252:].max()
    if n >= 21:
        out["tech_reversal_1m"] = last / px.iloc[-21] - 1
    # 相對強弱(60d)
    if n >= 60 and idx is not None and len(idx) >= 60:
        common = px.index.intersection(idx.index)
        if len(common) >= 60:
            sr = px.loc[common].iloc[-1] / px.loc[common].iloc[-60] - 1
            ir = idx.loc[common].iloc[-1] / idx.loc[common].iloc[-60] - 1
            out["tech_rel_strength"] = sr - ir
    # 均線多頭排列計分
    if n >= 120:
        ma20, ma60, ma120 = px.iloc[-20:].mean(), px.iloc[-60:].mean(), px.iloc[-120:].mean()
        score = (last > ma20) + (ma20 > ma60) + (ma60 > ma120)
        out["tech_ma_alignment"] = float(score)
    # 量價配合(用報酬代理:近20d 報酬正向且穩定)→ 以近20d/前60d 報酬比近似
    ret = px.pct_change().dropna()
    if len(ret) >= 140:
        out["tech_volume_confirm"] = ret.iloc[-20:].mean() - ret.iloc[-140:-20].mean()
        out["tech_low_volatility"] = ret.iloc[-120:].std() * np.sqrt(252)
    # Beta(252d 對大盤回歸)
    if n >= 252 and idx is not None:
        common = px.index.intersection(idx.index)[-252:]
        if len(common) >= 60:
            rs = px.loc[common].pct_change().dropna()
            ri = idx.loc[common].pct_change().dropna()
            j = rs.index.intersection(ri.index)
            if len(j) >= 40 and ri.loc[j].var() > 0:
                out["tech_beta"] = np.cov(rs.loc[j], ri.loc[j])[0, 1] / ri.loc[j].var()
    return out


# ---------------------------------------------------------------------------
# 基本面(用 PIT 財報 + 當期股價)
# ---------------------------------------------------------------------------
def _fundamental(row: pd.Series, price: float) -> dict[str, float]:
    o: dict[str, float] = {}
    mktcap = price * _num(row.get("shares_out"))
    o["value_ep"] = _div(row.get("eps_ttm"), price)
    o["value_bm"] = _div(row.get("book_value_ps"), price)
    o["value_ev_ebitda"] = _div(row.get("ev"), row.get("ebitda"))
    o["value_ps"] = _div(mktcap, row.get("revenue_ttm"))
    o["value_fcf_yield"] = _div(row.get("fcf"), mktcap)
    o["value_div_yield"] = _div(row.get("dividend_ttm"), price)
    o["quality_gpa"] = _div(row.get("gross_profit"), row.get("total_assets"))
    o["quality_roe"] = _num(row.get("roe"))
    o["quality_roic"] = _num(row.get("roic"))
    o["quality_piotroski_f"] = _num(row.get("f_score"))
    acc = row.get("accruals")
    if pd.isna(acc):
        acc = _div(_num(row.get("net_income")) - _num(row.get("operating_cf")),
                   row.get("total_assets"))
    o["quality_accruals"] = acc
    o["quality_debt_ratio"] = _num(row.get("debt_ratio"))
    o["growth_revenue_yoy"] = _num(row.get("revenue_yoy"))
    o["growth_eps_yoy"] = _num(row.get("eps_yoy"))
    o["invest_asset_growth"] = _num(row.get("asset_growth"))
    return o


# ---------------------------------------------------------------------------
# 籌碼面(台股,lookback 20d)
# ---------------------------------------------------------------------------
def _chip_tw(g: pd.DataFrame, lookback: int = 20) -> dict[str, float]:
    o: dict[str, float] = {}
    if g.empty:
        return o
    g = g.sort_values("date").tail(max(lookback + 5, lookback))
    recent = g.tail(lookback)
    shares = _num(g["shares_out"].iloc[-1]) if "shares_out" in g else np.nan
    if not shares or np.isnan(shares):
        shares = np.nan
    o["chip_foreign_net"] = _div(recent["foreign_net_shares"].sum(), shares)
    o["chip_trust_net"] = _div(recent["trust_net_shares"].sum(), shares)
    o["chip_dealer_net"] = _div(recent["dealer_net_shares"].sum(), shares)
    if "inst_holding_pct" in g and g["inst_holding_pct"].notna().any():
        o["chip_inst_holding_chg"] = _num(recent["inst_holding_pct"].iloc[-1]) - \
            _num(recent["inst_holding_pct"].iloc[0])
    if "margin_balance" in g and g["margin_balance"].notna().any():
        m0, m1 = _num(recent["margin_balance"].iloc[0]), _num(recent["margin_balance"].iloc[-1])
        o["chip_margin_chg"] = _div(m1 - m0, m0)
        o["chip_short_margin_ratio"] = _div(recent["short_balance"].iloc[-1], m1)
    if "big_holder_pct" in g and g["big_holder_pct"].notna().any():
        o["chip_big_holder_chg"] = _num(recent["big_holder_pct"].iloc[-1]) - \
            _num(recent["big_holder_pct"].iloc[0])
    if "branch_top_net" in g and g["branch_top_net"].notna().any():
        o["chip_branch_concentration"] = _div(recent["branch_top_net"].sum(),
                                              recent["branch_total_vol"].sum())
        o["chip_smart_branch_net"] = _div(recent["smart_branch_net"].sum(), shares)
    if "pledge_ratio" in g and g["pledge_ratio"].notna().any():
        o["chip_pledge_ratio"] = _num(recent["pledge_ratio"].iloc[-1])
    return o


# ---------------------------------------------------------------------------
# 被動資金 / 事件因子
# ---------------------------------------------------------------------------
def _event_score(events: pd.DataFrame, ticker: str, as_of: pd.Timestamp) -> float:
    """指數納入/剔除的時間衰減分數:生效日前數日建立,生效後逐步歸零(見 CLAUDE.md 4.4)。"""
    sub = events[events["ticker"] == ticker]
    if sub.empty:
        return 0.0
    score = 0.0
    for _, e in sub.iterrows():
        eff = pd.Timestamp(e["effective_date"])
        days = (as_of - eff).days
        sign = 1.0 if e["event"] == "include" else -1.0
        if -10 <= days < 0:               # 生效前:建立中
            score += sign * (1 + days / 10) * 0.7
        elif 0 <= days <= 60:             # 生效後:指數效應隨套利衰減,逐步歸零
            score += sign * np.exp(-days / 25)
    return float(np.clip(score, -1.5, 1.5))


def _num(x) -> float:
    try:
        v = float(x)
        return v if np.isfinite(v) else np.nan
    except (TypeError, ValueError):
        return np.nan


def _div(a, b) -> float:
    a, b = _num(a), _num(b)
    if not b or np.isnan(a) or np.isnan(b) or b == 0:
        return np.nan
    return a / b


# ---------------------------------------------------------------------------
# 主入口:某 as_of 日的全市場因子面板
# ---------------------------------------------------------------------------
def compute_panel(bundle: DataBundle, as_of: pd.Timestamp) -> pd.DataFrame:
    as_of = pd.Timestamp(as_of)
    prices = bundle.prices_upto(as_of)
    if prices.empty:
        return pd.DataFrame()
    idx_map = _market_index(prices)
    funds = bundle.fundamentals_asof(as_of).set_index("ticker")
    sectors = bundle.sectors()
    chips = bundle.chips_tw
    if not chips.empty:
        chips = chips[pd.to_datetime(chips["date"]) <= as_of]

    rows = []
    for tk, g in prices.groupby("ticker"):
        mkt = g["market"].iloc[0]
        px = _series(g)
        if len(px) < 30:
            continue
        rec: dict[str, float] = {"ticker": tk, "market": mkt,
                                 "sector": sectors.get(tk, "Unknown"),
                                 "price": float(px.iloc[-1])}
        rec.update(_technical(px, idx_map.get(mkt)))
        if tk in funds.index:
            rec.update(_fundamental(funds.loc[tk], rec["price"]))
        if mkt == "TW" and not chips.empty:
            rec.update(_chip_tw(chips[chips["ticker"] == tk]))
        # 事件 / 被動資金
        rec["flow_index_inclusion"] = _event_score(bundle.index_events, tk, as_of)
        rec["flow_us_index_inclusion"] = (rec["flow_index_inclusion"] if mkt == "US" else 0.0)
        if mkt != "US":
            rec["flow_us_index_inclusion"] = 0.0
        else:
            rec["flow_index_inclusion"] = 0.0
        rows.append(rec)

    if not rows:
        return pd.DataFrame()
    panel = pd.DataFrame(rows).set_index("ticker")
    panel.attrs["as_of"] = as_of
    log.info("as_of=%s 因子面板:%d 檔 × %d 欄", as_of.date(), len(panel), panel.shape[1])
    return panel
