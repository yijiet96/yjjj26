"""第三/四層:因子有效性檢定 — IC、IC-IR、Fama-MacBeth、多重共線性。"""
from __future__ import annotations

import numpy as np
import pandas as pd

from ..utils import get_logger

log = get_logger("stats")


def information_coefficient(factor: pd.Series, fwd_ret: pd.Series,
                            method: str = "spearman") -> float:
    """單期 IC:因子值與次期報酬的等級相關。"""
    df = pd.concat([factor, fwd_ret], axis=1).dropna()
    if len(df) < 5:
        return np.nan
    return df.iloc[:, 0].corr(df.iloc[:, 1], method=method)


def ic_summary(ic_series: pd.Series) -> dict[str, float]:
    ic = ic_series.dropna()
    if ic.empty:
        return {"ic_mean": np.nan, "ic_ir": np.nan, "ic_positive_rate": np.nan, "n": 0}
    mean, sd = ic.mean(), ic.std(ddof=0)
    return {
        "ic_mean": float(mean),
        "ic_std": float(sd),
        "ic_ir": float(mean / sd) if sd else np.nan,   # IC-IR
        "ic_positive_rate": float((ic > 0).mean()),
        "n": int(len(ic)),
    }


def fama_macbeth(factor_panels: list[pd.Series], fwd_returns: list[pd.Series],
                 newey_west_lags: int = 6) -> dict[str, float]:
    """逐期橫斷面迴歸取係數時間序列,做 t 檢定(Newey-West 修正自相關)。"""
    coefs = []
    for f, r in zip(factor_panels, fwd_returns):
        df = pd.concat([f, r], axis=1).dropna()
        if len(df) < 10:
            continue
        x = df.iloc[:, 0].values
        y = df.iloc[:, 1].values
        x = (x - x.mean()) / (x.std() + 1e-12)
        beta = np.cov(x, y)[0, 1] / (np.var(x) + 1e-12)
        coefs.append(beta)
    if len(coefs) < 3:
        return {"coef_mean": np.nan, "t_stat": np.nan, "n": len(coefs)}
    coefs = np.array(coefs)
    mean = coefs.mean()
    # Newey-West 標準誤
    T = len(coefs)
    dev = coefs - mean
    var = (dev @ dev) / T
    for lag in range(1, min(newey_west_lags, T - 1) + 1):
        w = 1 - lag / (newey_west_lags + 1)
        cov = (dev[lag:] @ dev[:-lag]) / T
        var += 2 * w * cov
    se = np.sqrt(var / T) if var > 0 else np.nan
    return {"coef_mean": float(mean),
            "t_stat": float(mean / se) if se else np.nan,
            "n": T}


def collinearity(panel: pd.DataFrame, factor_cols: list[str],
                 corr_threshold: float = 0.7) -> dict:
    """因子相關矩陣 + 高相關配對警示(VIF 的輕量替代)。"""
    cols = [c for c in factor_cols if c in panel.columns]
    sub = panel[cols].dropna(how="all", axis=1)
    if sub.shape[1] < 2:
        return {"high_corr_pairs": [], "corr": pd.DataFrame()}
    corr = sub.corr()
    pairs = []
    for i in range(len(corr.columns)):
        for j in range(i + 1, len(corr.columns)):
            c = corr.iloc[i, j]
            if abs(c) >= corr_threshold:
                pairs.append((corr.columns[i], corr.columns[j], round(float(c), 3)))
    return {"high_corr_pairs": pairs, "corr": corr}
