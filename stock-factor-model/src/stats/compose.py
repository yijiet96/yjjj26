"""第三層:因子合成。構面內先合成 → 構面間再合成 → 排序。

- 標準因子:走 transform 標準化管線後,於構面內按 config 權重加權平均(缺漏者遮蔽並重正規化權重)。
- event 因子(standardize:false):不標準化,其分數本身即「有上限的傾斜量」(capped tilt),
  以權重併入構面,缺漏補 0(CLAUDE.md 6.5)。
- 構面分數再各自 z-score 後,按 construct_weights 跨構面合成(某構面整體缺則重正規化)。
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from ..config import load_settings
from .transform import standardize_factor, zscore


def _weighted_available(zdf: pd.DataFrame, weights: dict[str, float]) -> pd.Series:
    """對每檔股票,只用「該股有值」的因子做加權平均,權重重正規化(drop_and_renormalize)。"""
    cols = [c for c in weights if c in zdf.columns]
    if not cols:
        return pd.Series(np.nan, index=zdf.index)
    z = zdf[cols]
    w = pd.Series({c: weights[c] for c in cols}, dtype=float)
    mask = z.notna()
    wmat = mask.mul(w, axis=1)
    denom = wmat.sum(axis=1).replace(0, np.nan)
    num = (z.fillna(0) * wmat).sum(axis=1)
    return num / denom


def compose_market(panel: pd.DataFrame, market: str) -> pd.DataFrame:
    """對單一市場的因子面板做合成,回傳含各構面分數與綜合分數的 DataFrame。"""
    s = load_settings()
    sub = panel[panel["market"] == market].copy()
    if sub.empty:
        return sub
    sector = sub["sector"]
    construct_scores = {}

    for construct in s.all_construct_names():
        specs = s.factor_specs(construct)
        avail_specs = {k: v for k, v in specs.items()
                       if market in v.get("availability", ["TW", "US"])}
        if not avail_specs:
            continue
        zcols = {}
        weights = {}
        for fname, spec in avail_specs.items():
            if fname not in sub.columns:
                continue
            weights[fname] = float(spec.get("weight", 1.0))
            if spec.get("standardize", True) is False or spec.get("type") == "event":
                # event/傾斜量:不標準化,缺漏補 0,夾在合理上限內
                zcols[fname] = sub[fname].fillna(spec.get("missing", 0)).clip(-1.5, 1.5)
            else:
                zcols[fname] = standardize_factor(
                    sub[fname], sector, int(spec.get("direction", 1)),
                    neutral=s.factors.get("meta", {}).get("sector_neutral", True))
        if not zcols:
            continue
        zdf = pd.DataFrame(zcols, index=sub.index)
        cscore = _weighted_available(zdf, weights)
        construct_scores[construct] = cscore
        sub[f"score_{construct}"] = cscore

    if not construct_scores:
        return sub

    # 構面分數各自 z-score(使尺度可比),再跨構面加權
    cw = s.construct_weights
    zscored = {}
    for c, sc in construct_scores.items():
        z = zscore(sc.fillna(sc.median()))
        zscored[c] = z
        sub[f"z_{c}"] = z
    zmat = pd.DataFrame(zscored, index=sub.index)
    w = pd.Series({c: cw.get(c, 0) for c in zmat.columns}, dtype=float)
    mask = zmat.notna()
    wmat = mask.mul(w, axis=1)
    denom = wmat.sum(axis=1).replace(0, np.nan)
    composite = (zmat.fillna(0) * wmat).sum(axis=1) / denom

    sub["composite"] = composite
    sub["rank"] = composite.rank(ascending=False)
    sub["percentile"] = composite.rank(pct=True) * 100
    return sub.sort_values("composite", ascending=False)


def compose_all(panel: pd.DataFrame) -> pd.DataFrame:
    """所有市場分開合成後縱向合併。"""
    if panel.empty:
        return panel
    parts = [compose_market(panel, m) for m in panel["market"].unique()]
    parts = [p for p in parts if not p.empty]
    return pd.concat(parts) if parts else pd.DataFrame()
