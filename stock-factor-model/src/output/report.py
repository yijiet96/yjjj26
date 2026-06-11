"""第五層:每日研究簡報產生器(HTML + Markdown)。

設計給「忙碌上班族」:打開一頁就看懂 — 市場概覽、今日候選、為何入選(四構面拆解)、
相關新聞、社群輿情、風險旗標。最上方永遠有免責聲明。
"""
from __future__ import annotations

import datetime as dt
import html
from pathlib import Path

import pandas as pd

from ..config import REPORTS_DIR

DISCLAIMER = (
    "本報告由自動化研究系統產生,為「研究候選清單」,<b>非投資建議</b>。"
    "歷史回測不保證未來績效;新聞與社群訊號僅作短期參考傾斜。"
    "請務必自行做最終盡職調查與風險判斷,投資盈虧自負。"
)


def _bar(v: float | None) -> str:
    if v is None or pd.isna(v):
        return '<span class="na">—</span>'
    pct = max(-3, min(3, v)) / 3 * 50
    color = "#16a34a" if v >= 0 else "#dc2626"
    left = 50 if v >= 0 else 50 + pct
    return (f'<div class="bar"><div class="fill" style="left:{left}%;'
            f'width:{abs(pct)}%;background:{color}"></div></div>'
            f'<span class="bv">{v:+.2f}</span>')


def _flag_chips(flags: list[str]) -> str:
    if not flags:
        return '<span class="ok">無</span>'
    return "".join(f'<span class="flag">{html.escape(f)}</span>' for f in flags)


def _candidate_rows(cand: pd.DataFrame, news: pd.DataFrame,
                    social: pd.DataFrame) -> str:
    news_map = (news.set_index("ticker")["top_headline"].to_dict()
                if not news.empty else {})
    news_score = (news.set_index("ticker")["news_score"].to_dict()
                  if not news.empty else {})
    soc_map = (social.set_index("ticker")["social_score"].to_dict()
               if not social.empty else {})
    rows = []
    for _, r in cand.iterrows():
        tk = r["ticker"]
        headline = news_map.get(tk, "")
        ns = news_score.get(tk)
        ss = soc_map.get(tk)
        rows.append(f"""
        <tr>
          <td class="tk"><b>{html.escape(str(tk))}</b><div class="sec">{html.escape(str(r.get('sector','')))}</div></td>
          <td class="num">{r.get('composite','')}<div class="sec">PR {r.get('percentile','')}</div></td>
          <td>{_bar(r.get('score_fundamental'))}</td>
          <td>{_bar(r.get('score_chip'))}</td>
          <td>{_bar(r.get('score_technical'))}</td>
          <td>{_bar(r.get('score_passive_flow'))}</td>
          <td class="news">{html.escape(str(headline))[:80]}
              {'<span class="ns">新聞 %+.2f</span>' % ns if ns is not None else ''}
              {'<span class="ss">社群 %+.2f</span>' % ss if ss is not None else ''}</td>
          <td>{_flag_chips(r.get('risk_flags', []))}</td>
        </tr>""")
    return "".join(rows)


def _market_section(market: str, cand: pd.DataFrame, news, social) -> str:
    sub = cand[cand["market"] == market]
    if sub.empty:
        return ""
    return f"""
    <h2>{market} 市場 — 今日候選 {len(sub)} 檔</h2>
    <table>
      <thead><tr>
        <th>標的</th><th>綜合分</th><th>基本面</th><th>籌碼面</th>
        <th>技術面</th><th>被動資金</th><th>新聞 / 社群</th><th>風險旗標</th>
      </tr></thead>
      <tbody>{_candidate_rows(sub, news, social)}</tbody>
    </table>"""


def _headlines_html(headlines: list[dict]) -> str:
    if not headlines:
        return "<li>(無)</li>"
    out = []
    for h in headlines[:8]:
        link = h.get("link", "")
        title = html.escape(h.get("title", ""))
        out.append(f'<li><a href="{html.escape(link)}" target="_blank">{title}</a></li>'
                   if link else f"<li>{title}</li>")
    return "".join(out)


def render_html(ctx: dict) -> str:
    cand: pd.DataFrame = ctx["candidates"]
    news: pd.DataFrame = ctx.get("news_by_ticker", pd.DataFrame())
    social: pd.DataFrame = ctx.get("social_by_ticker", pd.DataFrame())
    date = ctx.get("date", dt.date.today().isoformat())
    markets = sorted(cand["market"].unique()) if not cand.empty else []
    sections = "".join(_market_section(m, cand, news, social) for m in markets)
    mkt_sent = ctx.get("social_market_sentiment", 0.0)
    mode = ctx.get("mode", "demo")
    provider = ctx.get("analyzer", "rule_based")

    return f"""<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>每日選股研究簡報 {date}</title>
<style>
 body{{font-family:-apple-system,'Segoe UI','Noto Sans TC',sans-serif;margin:0;background:#f6f7f9;color:#1f2937}}
 .wrap{{max-width:1100px;margin:0 auto;padding:20px}}
 header{{background:#0f172a;color:#fff;padding:24px;border-radius:12px}}
 header h1{{margin:0;font-size:22px}} header .sub{{opacity:.8;font-size:13px;margin-top:6px}}
 .disclaimer{{background:#fef3c7;border:1px solid #f59e0b;padding:12px 16px;border-radius:10px;margin:16px 0;font-size:13px;line-height:1.6}}
 .overview{{display:flex;gap:16px;flex-wrap:wrap;margin:16px 0}}
 .card{{background:#fff;border-radius:12px;padding:16px;flex:1;min-width:280px;box-shadow:0 1px 3px rgba(0,0,0,.06)}}
 .card h3{{margin:0 0 8px;font-size:14px;color:#374151}}
 .card ul{{margin:0;padding-left:18px;font-size:13px;line-height:1.7}}
 .sent{{font-size:28px;font-weight:700}} .sent.pos{{color:#16a34a}} .sent.neg{{color:#dc2626}} .sent.neu{{color:#6b7280}}
 h2{{font-size:17px;margin:24px 0 8px}}
 table{{width:100%;border-collapse:collapse;background:#fff;border-radius:12px;overflow:hidden;font-size:13px;box-shadow:0 1px 3px rgba(0,0,0,.06)}}
 th{{background:#f1f5f9;text-align:left;padding:10px;font-weight:600;color:#475569}}
 td{{padding:10px;border-top:1px solid #eef2f7;vertical-align:top}}
 .tk b{{font-size:14px}} .sec{{color:#94a3b8;font-size:11px}}
 .num{{font-weight:600}}
 .bar{{position:relative;height:8px;background:#eef2f7;border-radius:4px;width:70px;display:inline-block}}
 .bar .fill{{position:absolute;top:0;height:8px;border-radius:4px}}
 .bv{{font-size:11px;margin-left:6px;color:#475569}} .na{{color:#cbd5e1}}
 .flag{{display:inline-block;background:#fee2e2;color:#b91c1c;border-radius:6px;padding:1px 7px;margin:1px;font-size:11px}}
 .ok{{color:#16a34a;font-size:12px}}
 .news{{max-width:260px}} .ns{{color:#2563eb;font-size:11px;margin-left:6px}} .ss{{color:#7c3aed;font-size:11px;margin-left:6px}}
 footer{{color:#94a3b8;font-size:12px;margin:24px 0;text-align:center}}
</style></head><body><div class="wrap">
<header>
 <h1>📈 每日選股研究簡報</h1>
 <div class="sub">{date} ｜ 資料模式:{mode} ｜ 分析引擎:{provider} ｜ 台股 × 美股多因子模型</div>
</header>
<div class="disclaimer">⚠️ {DISCLAIMER}</div>
<div class="overview">
 <div class="card"><h3>📰 今日市場頭條</h3><ul>{_headlines_html(ctx.get('market_headlines', []))}</ul></div>
 <div class="card"><h3>🗣️ 社群意見領袖情緒</h3>
   <div class="sent {'pos' if mkt_sent>0.1 else 'neg' if mkt_sent<-0.1 else 'neu'}">{mkt_sent:+.2f}</div>
   <div class="sec">綜合 {ctx.get('n_social_posts',0)} 則影響力貼文(已壓低權重,僅短期參考)</div>
 </div>
</div>
{sections}
<footer>本簡報由自動化投資研究代理產生 · 因子模型 + 新聞 + 社群輿情整合 · 僅供研究</footer>
</div></body></html>"""


def render_markdown(ctx: dict) -> str:
    cand: pd.DataFrame = ctx["candidates"]
    date = ctx.get("date", dt.date.today().isoformat())
    lines = [f"# 每日選股研究簡報 {date}", "",
             f"> ⚠️ 研究用途,非投資建議。資料模式:{ctx.get('mode')}。", ""]
    lines.append(f"社群市場情緒:{ctx.get('social_market_sentiment',0):+.2f}"
                 f"({ctx.get('n_social_posts',0)} 則貼文)")
    lines.append("")
    for m in sorted(cand["market"].unique()) if not cand.empty else []:
        sub = cand[cand["market"] == m]
        lines.append(f"## {m} 候選({len(sub)} 檔)")
        lines.append("| 標的 | 綜合分 | PR | 基本面 | 籌碼 | 技術 | 被動 | 風險旗標 |")
        lines.append("|---|---|---|---|---|---|---|---|")
        for _, r in sub.iterrows():
            lines.append(f"| {r['ticker']} | {r.get('composite')} | {r.get('percentile')} "
                         f"| {r.get('score_fundamental')} | {r.get('score_chip')} "
                         f"| {r.get('score_technical')} | {r.get('score_passive_flow')} "
                         f"| {'、'.join(r.get('risk_flags', [])) or '無'} |")
        lines.append("")
    return "\n".join(lines)


def save_report(ctx: dict, out_dir: Path | None = None) -> dict[str, Path]:
    out_dir = out_dir or REPORTS_DIR
    out_dir.mkdir(parents=True, exist_ok=True)
    date = ctx.get("date", dt.date.today().isoformat())
    html_path = out_dir / f"daily_brief_{date}.html"
    md_path = out_dir / f"daily_brief_{date}.md"
    latest = out_dir / "latest.html"
    html_path.write_text(render_html(ctx), encoding="utf-8")
    md_path.write_text(render_markdown(ctx), encoding="utf-8")
    latest.write_text(render_html(ctx), encoding="utf-8")
    return {"html": html_path, "md": md_path, "latest": latest}
