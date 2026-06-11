"""共用工具:logging、快取、重試/退避、parquet I/O。"""
from __future__ import annotations

import functools
import json
import logging
import time
from pathlib import Path
from typing import Any, Callable

import pandas as pd

from .config import PROCESSED_DIR, RAW_DIR

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
_LOG_FMT = "%(asctime)s | %(levelname)-7s | %(name)s | %(message)s"


def get_logger(name: str = "sfm") -> logging.Logger:
    logger = logging.getLogger(name)
    if not logger.handlers:
        h = logging.StreamHandler()
        h.setFormatter(logging.Formatter(_LOG_FMT, datefmt="%H:%M:%S"))
        logger.addHandler(h)
        logger.setLevel(logging.INFO)
    return logger


log = get_logger()


# ---------------------------------------------------------------------------
# 重試 / 指數退避(API 限額友善)
# ---------------------------------------------------------------------------
def retry(times: int = 4, base_delay: float = 1.0, exc: tuple = (Exception,)):
    def deco(fn: Callable) -> Callable:
        @functools.wraps(fn)
        def wrap(*a, **k):
            delay = base_delay
            for i in range(times):
                try:
                    return fn(*a, **k)
                except exc as e:  # noqa: BLE001
                    if i == times - 1:
                        raise
                    log.warning("%s 失敗(%d/%d):%s,%.1fs 後重試",
                                fn.__name__, i + 1, times, e, delay)
                    time.sleep(delay)
                    delay *= 2
        return wrap
    return deco


# ---------------------------------------------------------------------------
# 本地落地快取:原始資料下載後保存,避免重複請求(見 CLAUDE.md 第 2 節)
# ---------------------------------------------------------------------------
def cache_path(name: str, raw: bool = True) -> Path:
    base = RAW_DIR if raw else PROCESSED_DIR
    return base / f"{name}.parquet"


def save_df(df: pd.DataFrame, name: str, raw: bool = True) -> Path:
    p = cache_path(name, raw)
    p.parent.mkdir(parents=True, exist_ok=True)
    try:
        df.to_parquet(p, index=True)
    except Exception:  # pyarrow 缺失時退回 pickle
        df.to_pickle(p.with_suffix(".pkl"))
        return p.with_suffix(".pkl")
    return p


def load_df(name: str, raw: bool = True) -> pd.DataFrame | None:
    p = cache_path(name, raw)
    if p.exists():
        return pd.read_parquet(p)
    pkl = p.with_suffix(".pkl")
    if pkl.exists():
        return pd.read_pickle(pkl)
    return None


def save_json(obj: Any, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(obj, fh, ensure_ascii=False, indent=2, default=str)


def month_ends(start: str, end: str) -> list[pd.Timestamp]:
    """產生再平衡日序列(每月最後一個交易日的近似:月底日曆日)。"""
    return list(pd.date_range(start, end, freq="ME"))
