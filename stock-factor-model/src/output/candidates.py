"""第五層:候選清單建構。

每檔輸出:綜合分數、市場內排名/百分位、四大構面分數拆解、關鍵原始指標快照、風險旗標。
風險旗標(雙面刃指標)不列為加分,只作警示(CLAUDE.md 第 10 節)。
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from ..config import load_settings

# 候選清單要附帶的關鍵原始指標快照
_SNAPSHOT = ["value_bm", "value_ep", "quality_roe", "quality_piotroski_f",
             "tech_momentum_12_1", "tech_52w_high", "chip_foreign_net",
             "chip_trust_net", "flow_index_inclusion"]


def _risk_flags(row: pd.Series) -> list[str]:
    flags = []
    if not np.isnan(row.get("tech_low_volatility", np.nan)) and \
            row.get("tech_low_volatility", 0) > 0.6:
        flags.append("高波動")
    if not np.isnan(row.get("chip_pledge_ratio", np.nan)) and \
            row.get("chip_pledge_ratio", 0) > 0.3:
        flags.append("董監高質押")
    # 被動資金擁擠:高股息題材 + 指數事件(雙面刃)
    if row.get("flow_index_inclusion", 0) < -0.3:
        flags.append("指數剔除中")
    # 財報缺漏(基本面分數缺)
    if np.isnan(row.get("score_fundamental", np.nan)):
        flags.append("財報缺漏")
    # 分點訊號雜訊提醒
    if not np.isnan(row.get("chip_smart_branch_net", np.nan)) and \
            abs(row.get("chip_smart_branch_net", 0)) > 0:
        flags.append("分點訊號僅供參考")
    return flags


def build_candidates(scored: pd.DataFrame, top_pct: float | None = None,
                     top_n: int | None = None) -> pd.DataFrame:
    """從合成後的 DataFrame 取出候選清單(每市場各取前段)。"""
    s = load_settings()
    top_pct = top_pct or s.backtest.get("portfolio", {}).get("long_only_top_pct", 0.10)
    out = []
    for mkt, g in scored.groupby("market"):
        g = g.sort_values("composite", ascending=False)
        k = top_n or max(1, int(np.ceil(len(g) * top_pct)))
        out.append(g.head(k))
    cand = pd.concat(out) if out else scored.head(0)

    records = []
    for tk, row in cand.iterrows():
        rec = {
            "ticker": tk,
            "market": row.get("market"),
            "sector": row.get("sector"),
            "price": round(float(row.get("price", np.nan)), 2),
            "composite": round(float(row.get("composite", np.nan)), 3),
            "percentile": round(float(row.get("percentile", np.nan)), 1),
            "rank": int(row.get("rank", 0)) if not np.isnan(row.get("rank", np.nan)) else None,
        }
        for c in ("fundamental", "chip", "technical", "passive_flow"):
            v = row.get(f"z_{c}", np.nan)
            rec[f"score_{c}"] = round(float(v), 2) if not np.isnan(v) else None
        rec["snapshot"] = {k: (round(float(row[k]), 4)
                               if k in row and not pd.isna(row[k]) else None)
                           for k in _SNAPSHOT}
        rec["risk_flags"] = _risk_flags(row)
        records.append(rec)
    return pd.DataFrame(records)
