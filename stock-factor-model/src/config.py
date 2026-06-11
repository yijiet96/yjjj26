"""集中設定載入:讀取 config/*.yaml 與 .env,提供型別化存取。

設計原則(見 CLAUDE.md 第 2 節):因子定義、股票池、回測參數一律外部化於 YAML,
程式不寫死。本模組是所有層共用的單一事實來源 (single source of truth)。
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml

try:  # python-dotenv 為選用;沒有也能跑(改讀系統環境變數)
    from dotenv import load_dotenv
except Exception:  # pragma: no cover
    def load_dotenv(*_a, **_k):  # type: ignore
        return False


# ---------------------------------------------------------------------------
# 路徑
# ---------------------------------------------------------------------------
PROJECT_ROOT = Path(__file__).resolve().parents[1]
CONFIG_DIR = PROJECT_ROOT / "config"
DATA_DIR = PROJECT_ROOT / "data"
RAW_DIR = DATA_DIR / "raw"
PIT_DIR = DATA_DIR / "pit"
PROCESSED_DIR = DATA_DIR / "processed"
REPORTS_DIR = PROJECT_ROOT / "reports"

for _d in (RAW_DIR, PIT_DIR, PROCESSED_DIR, REPORTS_DIR):
    _d.mkdir(parents=True, exist_ok=True)


def _read_yaml(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    with open(path, "r", encoding="utf-8") as fh:
        return yaml.safe_load(fh) or {}


@dataclass
class Settings:
    """執行期設定:合併 YAML + 環境變數。"""

    universe: dict[str, Any] = field(default_factory=dict)
    factors: dict[str, Any] = field(default_factory=dict)
    backtest: dict[str, Any] = field(default_factory=dict)
    env: dict[str, str] = field(default_factory=dict)

    # ---- 便捷存取 -------------------------------------------------------
    @property
    def construct_weights(self) -> dict[str, float]:
        return self.factors.get("construct_weights", {})

    @property
    def markets(self) -> list[str]:
        m = self.universe.get("markets", {})
        return [k for k, v in m.items() if v.get("enabled", False)]

    def benchmark(self, market: str) -> str:
        return self.universe.get("markets", {}).get(market, {}).get(
            "index_benchmark", "^GSPC" if market == "US" else "^TWII"
        )

    def factor_specs(self, construct: str) -> dict[str, dict]:
        """回傳某構面下的因子定義 dict(去掉 meta 鍵)。"""
        return {k: v for k, v in self.factors.get(construct, {}).items()
                if isinstance(v, dict)}

    def all_construct_names(self) -> list[str]:
        return [c for c in ("fundamental", "chip", "technical", "passive_flow")
                if c in self.factors]

    # ---- 金鑰 -----------------------------------------------------------
    def key(self, name: str, default: str | None = None) -> str | None:
        return self.env.get(name) or os.environ.get(name) or default


@lru_cache(maxsize=1)
def load_settings() -> Settings:
    load_dotenv(PROJECT_ROOT / ".env")
    env = {k: v for k, v in os.environ.items()}
    return Settings(
        universe=_read_yaml(CONFIG_DIR / "universe.yaml"),
        factors=_read_yaml(CONFIG_DIR / "factors.yaml"),
        backtest=_read_yaml(CONFIG_DIR / "backtest.yaml"),
        env=env,
    )


def get(*keys: str, default: Any = None) -> Any:
    """巢狀讀取,例:get('backtest','costs','TW','tax_sell_rate')."""
    s = load_settings()
    node: Any = {"universe": s.universe, "factors": s.factors, "backtest": s.backtest}
    for k in keys:
        if not isinstance(node, dict) or k not in node:
            return default
        node = node[k]
    return node
