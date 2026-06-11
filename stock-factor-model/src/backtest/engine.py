"""第四層:向量化分組回測。

流程:逐月底計算因子面板 → 合成綜合分數 → 分 decile → 用「次期」報酬評估
(return_lag,防前視偏誤)→ 計入交易成本 → 算 IC 與績效。

交易成本分市場(CLAUDE.md 第 7 節):台股手續費+證交稅+滑價;美股近零佣金+滑價。
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from ..config import load_settings
from ..data.loaders import DataBundle
from ..factors.compute import compute_panel
from ..stats.compose import compose_all
from ..stats.validate import ic_summary, information_coefficient
from ..utils import get_logger, month_ends
from . import metrics

log = get_logger("backtest")


def _forward_returns(bundle: DataBundle, d0: pd.Timestamp,
                     d1: pd.Timestamp) -> pd.Series:
    """各股票在 (d0, d1] 的報酬(用 adj_close;無資料者 NaN)。"""
    p = bundle.prices
    p0 = (p[pd.to_datetime(p["date"]) <= d0].sort_values("date")
          .groupby("ticker")["adj_close"].last())
    p1 = (p[pd.to_datetime(p["date"]) <= d1].sort_values("date")
          .groupby("ticker")["adj_close"].last())
    return (p1 / p0 - 1).rename("fwd_ret")


def _cost(market: str) -> float:
    s = load_settings()
    c = s.backtest.get("costs", {}).get(market, {})
    if market == "TW":
        comm = c.get("commission_rate", 0.001425) * c.get("commission_discount", 1.0)
        return 2 * comm + c.get("tax_sell_rate", 0.003) + c.get("slippage_bps", 10) / 1e4
    return 2 * c.get("commission_rate", 0.0) + c.get("tax_sell_rate", 0.0) + \
        c.get("slippage_bps", 5) / 1e4


def run_backtest(bundle: DataBundle, start: str, end: str,
                 quantiles: int = 10) -> dict:
    """跑分組回測,回傳每組報酬序列、多空組合、IC 與績效摘要。"""
    rebal = month_ends(start, end)
    if len(rebal) < 3:
        raise ValueError("回測期間太短,至少需數個月。")

    decile_rows, ls_rows, ic_rows, top_rows = [], [], [], []
    prev_top: set[str] = set()
    turnover_list = []

    for i in range(len(rebal) - 1):
        d0, d1 = rebal[i], rebal[i + 1]
        panel = compute_panel(bundle, d0)
        if panel.empty:
            continue
        scored = compose_all(panel)
        if scored.empty or "composite" not in scored:
            continue
        fwd = _forward_returns(bundle, d0, d1)
        df = scored.join(fwd, how="left")
        df = df.dropna(subset=["composite"])
        if df["fwd_ret"].notna().sum() < quantiles:
            continue

        # IC(綜合分數 vs 次期報酬)
        ic = information_coefficient(df["composite"], df["fwd_ret"])
        ic_rows.append({"date": d1, "ic": ic})

        # 分組
        try:
            df["decile"] = pd.qcut(df["composite"].rank(method="first"),
                                   quantiles, labels=False)
        except ValueError:
            continue
        grp = df.groupby("decile")["fwd_ret"].mean()
        decile_rows.append(grp.rename(d1))

        # 多空 + 交易成本
        top = df[df["decile"] == quantiles - 1]
        bot = df[df["decile"] == 0]
        cost = df["market"].map(_cost).mean()
        ls = top["fwd_ret"].mean() - bot["fwd_ret"].mean() - cost
        ls_rows.append({"date": d1, "ls_ret": ls})

        # 純做多前段(候選清單版本)+ 換手率
        top_tickers = set(top.index)
        if prev_top:
            turnover = len(top_tickers ^ prev_top) / (2 * max(len(top_tickers), 1))
            turnover_list.append(turnover)
        prev_top = top_tickers
        top_rows.append({"date": d1, "ret": top["fwd_ret"].mean() - cost})

    if not decile_rows:
        raise RuntimeError("回測未產生任何有效期間,請檢查資料覆蓋。")

    decile_df = pd.concat(decile_rows, axis=1).T
    decile_df.index.name = "date"
    ls = pd.DataFrame(ls_rows).set_index("date")["ls_ret"]
    ic = pd.DataFrame(ic_rows).set_index("date")["ic"]
    top = pd.DataFrame(top_rows).set_index("date")["ret"]

    decile_mean = decile_df.mean()
    perf_ls = metrics.summarize(ls)
    perf_top = metrics.summarize(top)
    result = {
        "decile_returns": decile_df,
        "decile_mean": decile_mean,
        "long_short": ls,
        "long_only_top": top,
        "ic": ic,
        "ic_summary": ic_summary(ic),
        "monotonicity": metrics.monotonicity(decile_mean),
        "perf_long_short": perf_ls,
        "perf_long_only": perf_top,
        "avg_turnover": float(np.mean(turnover_list)) if turnover_list else np.nan,
        "n_periods": len(decile_rows),
    }
    log.info("回測完成:%d 期,IC 均值 %.3f,IC-IR %.2f,多空年化 %.1f%%,單調性 %.2f",
             result["n_periods"], result["ic_summary"]["ic_mean"],
             result["ic_summary"]["ic_ir"], 100 * (perf_ls["annual_return"] or 0),
             result["monotonicity"])
    return result
