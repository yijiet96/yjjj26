"""端到端與關鍵不變量測試。重點驗證三大偏誤防線(CLAUDE.md 第 8 節)。

執行:pytest tests/ -q   (或 python -m pytest)
"""
from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.data import synthetic
from src.data.loaders import load_bundle
from src.factors.compute import compute_panel
from src.stats.compose import compose_all
from src.stats.transform import sector_neutralize, winsorize, zscore

START, END = "2022-01-01", "2024-06-30"


@pytest.fixture(scope="module")
def bundle():
    return load_bundle(START, END, demo=True)


# --- 前視偏誤:fundamentals_asof 不可洩漏未公布財報 -------------------------
def test_pit_no_lookahead(bundle):
    as_of = pd.Timestamp("2023-06-15")
    f = bundle.fundamentals_asof(as_of)
    assert (pd.to_datetime(f["announce_date"]) <= as_of).all(), "洩漏了未公布的財報!"


def test_prices_upto_no_future(bundle):
    as_of = pd.Timestamp("2023-06-15")
    p = bundle.prices_upto(as_of)
    assert (pd.to_datetime(p["date"]) <= as_of).all(), "用到了未來價格!"


# --- 標準化工具 ------------------------------------------------------------
def test_zscore_properties():
    s = pd.Series([1.0, 2, 3, 4, 5, 100])
    z = zscore(winsorize(s))
    assert abs(z.mean()) < 1e-9
    assert z.max() < 5  # 去極值後不應有極端值


def test_sector_neutralize_zero_mean_per_sector():
    s = pd.Series([1.0, 3, 10, 12], index=["a", "b", "c", "d"])
    sec = pd.Series(["X", "X", "Y", "Y"], index=s.index)
    out = sector_neutralize(s, sec)
    assert abs(out.groupby(sec).mean()).max() < 1e-9


# --- 因子面板 --------------------------------------------------------------
def test_compute_panel_shape(bundle):
    panel = compute_panel(bundle, pd.Timestamp("2024-06-28"))
    assert not panel.empty
    assert "tech_momentum_12_1" in panel.columns
    assert "value_ep" in panel.columns
    assert panel["market"].isin(["TW", "US"]).all()


# --- 合成與排序 ------------------------------------------------------------
def test_compose_produces_composite(bundle):
    panel = compute_panel(bundle, pd.Timestamp("2024-06-28"))
    scored = compose_all(panel)
    assert "composite" in scored.columns
    assert scored["composite"].notna().sum() > 0
    # 市場分開標準化:各市場 z 分數應約略 mean 0
    for mkt, g in scored.groupby("market"):
        if f"z_fundamental" in g and g["z_fundamental"].notna().sum() > 5:
            assert abs(g["z_fundamental"].mean()) < 0.5


# --- 端到端 ----------------------------------------------------------------
def test_daily_runs(tmp_path):
    from src.agent.daily import run_daily
    ctx = run_daily(demo=True, top_n=3, with_news=True, with_social=True)
    assert not ctx["candidates"].empty
    assert "final_score" in ctx["candidates"].columns
    assert ctx["report_paths"]["html"].exists()


def test_event_factor_not_standardized():
    """event 因子應被夾在合理上限,不會被 z-score 放大成假訊號。"""
    b = load_bundle(START, END, demo=True)
    panel = compute_panel(b, pd.Timestamp("2024-06-28"))
    assert panel["flow_index_inclusion"].abs().max() <= 1.5
