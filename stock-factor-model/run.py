#!/usr/bin/env python3
"""統一 CLI 入口 — 自動化投資研究代理。

範例:
  python run.py daily --demo                 # 離線 demo,跑完整每日流程並產出簡報
  python run.py daily --live                 # 接真實資料(需 .env 金鑰;美股免費、台股建議 FinMind token)
  python run.py daily --live --email         # 跑完並寄信
  python run.py backtest --demo              # 分組回測 + IC + 績效(驗證因子有效性)
  python run.py validate --demo              # 因子相關性/共線性檢查
  python run.py serve                        # 本機開個小網頁看最新簡報
"""
from __future__ import annotations

import argparse
import sys
import webbrowser
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from src.config import REPORTS_DIR, load_settings  # noqa: E402
from src.utils import get_logger  # noqa: E402

log = get_logger("cli")


def cmd_daily(args) -> None:
    from src.agent.daily import run_daily
    demo = not args.live
    ctx = run_daily(demo=demo, top_n=args.top_n,
                    with_news=not args.no_news, with_social=not args.no_social,
                    markets=args.markets.split(",") if args.markets else None)
    cand = ctx["candidates"]
    print("\n===== 今日候選清單 =====")
    cols = [c for c in ["ticker", "market", "sector", "composite",
                        "news_score", "social_score", "final_score", "risk_flags"]
            if c in cand.columns]
    with_pd_opts(lambda: print(cand[cols].to_string(index=False)))
    print(f"\n📄 報告:{ctx['report_paths']['latest']}")
    if args.email:
        from src.agent.notify import send_email
        from src.output.report import render_html
        send_email(f"每日選股研究簡報 {ctx['date']}", render_html(ctx))


def cmd_backtest(args) -> None:
    from src.backtest.engine import run_backtest
    from src.data.loaders import load_bundle
    s = load_settings()
    start = args.start or s.backtest.get("period", {}).get("start", "2022-01-01")
    end = args.end or s.backtest.get("period", {}).get("end", "2024-12-31")
    bundle = load_bundle(start, end, demo=not args.live,
                         markets=args.markets.split(",") if args.markets else None)
    res = run_backtest(bundle, start, end,
                       quantiles=s.backtest.get("portfolio", {}).get("quantiles", 10))
    print("\n===== 分組(decile)平均報酬 =====")
    print(res["decile_mean"].round(4).to_string())
    print(f"\n單調性 (monotonicity): {res['monotonicity']:.3f}  "
          "(越接近 1,代表分數越高報酬越高,因子越有區辨力)")
    print("\n===== IC 摘要 =====")
    for k, v in res["ic_summary"].items():
        print(f"  {k:18s}: {v}")
    print("\n===== 多空組合績效(已計交易成本)=====")
    for k, v in res["perf_long_short"].items():
        print(f"  {k:20s}: {v:.4f}" if v == v else f"  {k:20s}: n/a")
    print(f"\n  平均換手率: {res['avg_turnover']:.2%}" if res['avg_turnover'] == res['avg_turnover'] else "")


def cmd_validate(args) -> None:
    from src.data.loaders import load_bundle
    from src.factors.compute import compute_panel
    from src.stats.compose import compose_all
    from src.stats.validate import collinearity
    import pandas as pd
    bundle = load_bundle("2022-01-01", args.end or "2024-12-31", demo=not args.live)
    as_of = pd.to_datetime(bundle.prices["date"]).max()
    panel = compute_panel(bundle, as_of)
    factor_cols = [c for c in panel.columns
                   if c not in ("market", "sector", "price")]
    res = collinearity(panel, factor_cols,
                       load_settings().backtest.get("factor_evaluation", {}).get("corr_threshold", 0.7))
    print("===== 高相關因子配對(>門檻,需擇一或正交化)=====")
    if res["high_corr_pairs"]:
        for a, b, c in res["high_corr_pairs"]:
            print(f"  {a} ~ {b}: {c}")
    else:
        print("  (無)")


def cmd_serve(args) -> None:
    latest = REPORTS_DIR / "latest.html"
    if not latest.exists():
        log.info("尚無報告,先跑 `python run.py daily --demo`")
        return
    print(f"開啟 {latest}")
    webbrowser.open(latest.as_uri())


def with_pd_opts(fn):
    import pandas as pd
    with pd.option_context("display.max_columns", None, "display.width", 200,
                           "display.max_colwidth", 30):
        return fn()


def main() -> None:
    p = argparse.ArgumentParser(description="自動化投資研究代理(台股 × 美股多因子)")
    sub = p.add_subparsers(dest="cmd", required=True)

    d = sub.add_parser("daily", help="跑每日選股流程並產出簡報")
    d.add_argument("--live", action="store_true", help="用真實資料(預設 demo)")
    d.add_argument("--email", action="store_true", help="完成後寄送簡報")
    d.add_argument("--no-news", action="store_true")
    d.add_argument("--no-social", action="store_true")
    d.add_argument("--top-n", type=int, default=None, help="每市場取前 N 檔")
    d.add_argument("--markets", type=str, default=None, help="逗號分隔,如 TW,US")
    d.set_defaults(func=cmd_daily)

    b = sub.add_parser("backtest", help="分組回測 + IC + 績效")
    b.add_argument("--live", action="store_true")
    b.add_argument("--start", type=str, default=None)
    b.add_argument("--end", type=str, default=None)
    b.add_argument("--markets", type=str, default=None)
    b.set_defaults(func=cmd_backtest)

    v = sub.add_parser("validate", help="因子共線性檢查")
    v.add_argument("--live", action="store_true")
    v.add_argument("--end", type=str, default=None)
    v.set_defaults(func=cmd_validate)

    sv = sub.add_parser("serve", help="開啟最新簡報")
    sv.set_defaults(func=cmd_serve)

    args = p.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
