"""第三層:橫斷面標準化工具。

固定執行順序(CLAUDE.md 第 6 節):去極值 → 缺漏 fallback → 標準化 → 產業中性化。
台股、美股「分開」處理,絕不混池(由上層按 market 分組呼叫)。
"""
from __future__ import annotations

import numpy as np
import pandas as pd


def winsorize(s: pd.Series, lo: float = 0.01, hi: float = 0.99) -> pd.Series:
    if s.notna().sum() < 5:
        return s
    ql, qh = s.quantile(lo), s.quantile(hi)
    return s.clip(ql, qh)


def fill_missing(s: pd.Series, sector: pd.Series) -> pd.Series:
    """缺漏 fallback 鏈:產業中位數 → 全市場中位數。
    若整欄全缺(如金融業無毛利、或某資料源未提供),回傳全 NaN,由 compose 端 drop+renormalize。
    """
    if s.notna().sum() == 0:
        return s
    sector_med = s.groupby(sector).transform("median")
    filled = s.fillna(sector_med)
    return filled.fillna(s.median())


def zscore(s: pd.Series) -> pd.Series:
    mu, sd = s.mean(), s.std(ddof=0)
    if not sd or np.isnan(sd) or sd == 0:
        return pd.Series(0.0, index=s.index)
    return (s - mu) / sd


def sector_neutralize(s: pd.Series, sector: pd.Series) -> pd.Series:
    """產業組內去均值,避免因子分數被單一產業綁架(CLAUDE.md 6.3)。"""
    return s - s.groupby(sector).transform("mean")


def standardize_factor(raw: pd.Series, sector: pd.Series, direction: int,
                       winsor: tuple[float, float] = (0.01, 0.99),
                       neutral: bool = True) -> pd.Series:
    """單一因子完整標準化管線,回傳已乘上 direction 的 z 分數。"""
    s = winsorize(raw.astype(float), *winsor)
    s = fill_missing(s, sector)
    if s.notna().sum() == 0:
        return s  # 全缺 → 交給 compose 處理
    z = zscore(s)
    if neutral:
        z = sector_neutralize(z, sector)
        z = zscore(z)  # 中性化後再標準化,維持單位變異
    return z * direction
