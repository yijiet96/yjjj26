"""第四層:績效指標。全部輸出,不可只看累積報酬(CLAUDE.md 第 7 節)。"""
from __future__ import annotations

import numpy as np
import pandas as pd

PERIODS_PER_YEAR = 12  # 月頻


def annual_return(r: pd.Series) -> float:
    r = r.dropna()
    if r.empty:
        return np.nan
    return float((1 + r).prod() ** (PERIODS_PER_YEAR / len(r)) - 1)


def annual_vol(r: pd.Series) -> float:
    return float(r.dropna().std(ddof=0) * np.sqrt(PERIODS_PER_YEAR))


def sharpe(r: pd.Series, rf: pd.Series | float = 0.0) -> float:
    ex = r - (rf if not isinstance(rf, pd.Series) else rf.reindex(r.index).fillna(0))
    ex = ex.dropna()
    sd = ex.std(ddof=0)
    return float(ex.mean() / sd * np.sqrt(PERIODS_PER_YEAR)) if sd else np.nan


def sortino(r: pd.Series, rf: float = 0.0) -> float:
    ex = (r - rf).dropna()
    downside = ex[ex < 0].std(ddof=0)
    return float(ex.mean() / downside * np.sqrt(PERIODS_PER_YEAR)) if downside else np.nan


def max_drawdown(r: pd.Series) -> float:
    cum = (1 + r.dropna()).cumprod()
    if cum.empty:
        return np.nan
    return float((cum / cum.cummax() - 1).min())


def calmar(r: pd.Series) -> float:
    mdd = max_drawdown(r)
    return float(annual_return(r) / abs(mdd)) if mdd and mdd != 0 else np.nan


def information_ratio(r: pd.Series, bench: pd.Series) -> float:
    active = (r - bench.reindex(r.index)).dropna()
    sd = active.std(ddof=0)
    return float(active.mean() / sd * np.sqrt(PERIODS_PER_YEAR)) if sd else np.nan


def win_rate(r: pd.Series) -> float:
    r = r.dropna()
    return float((r > 0).mean()) if len(r) else np.nan


def monotonicity(decile_returns: pd.Series) -> float:
    """分組平均報酬的單調性(Spearman 與組序的相關):因子區辨力的關鍵指標。"""
    d = decile_returns.dropna()
    if len(d) < 3:
        return np.nan
    ranks = np.arange(len(d))
    return float(pd.Series(d.values).corr(pd.Series(ranks), method="spearman"))


def summarize(r: pd.Series, bench: pd.Series | None = None,
              rf: pd.Series | float = 0.0) -> dict[str, float]:
    out = {
        "annual_return": annual_return(r),
        "annual_volatility": annual_vol(r),
        "sharpe": sharpe(r, rf),
        "sortino": sortino(r, float(rf) if not isinstance(rf, pd.Series) else 0.0),
        "max_drawdown": max_drawdown(r),
        "calmar": calmar(r),
        "win_rate": win_rate(r),
    }
    if bench is not None:
        out["information_ratio"] = information_ratio(r, bench)
    return out
