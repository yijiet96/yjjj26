# 台股 × 美股 多因子選股模型 ＋ 全自動每日研究代理

一套**已經建好、可直接執行**的橫斷面多因子選股系統,整合**基本面、籌碼面、技術面、
被動資金(ETF)**四大構面,再疊加**最新新聞影響**與**社群意見領袖輿情**,
每日自動產出一份專業研究簡報(HTML + Email)。

> ⚠️ **重要免責**:本系統輸出為**研究候選清單,非投資建議**,且**不會自動下單**。
> 歷史回測不保證未來績效;新聞/社群只作小幅短期參考。沒有任何模型能「100% 保證獲利」——
> 本系統的價值在於用紀律化、抗偏誤的方法每天幫你做完研究功課,最終買賣與風險請自行判斷。

---

## ✨ 這套系統幫你做什麼(專為忙碌上班族設計)

1. **全市場評分排序**:用四大構面數十個有學術理論支撐的因子,對台股/美股個股打分。
2. **讀懂最新新聞**:抓每檔候選股的近期新聞,用 LLM(或規則式)判斷情緒與衝擊。
3. **追蹤社群意見領袖**:分析具市場影響力人物(如 Musk、Trump 等)的貼文可能影響哪些標的。
4. **每日自動產簡報**:把以上整合成一頁清楚的 HTML 簡報,可自動寄到你信箱。
5. **嚴防三大偏誤**:前視偏誤、生存者偏誤、過度擬合 —— 全程內建防線(見 `CLAUDE.md` 第 8 節)。

---

## 🚀 三分鐘上手(零金鑰、離線即可看到成果)

```bash
python -m venv .venv && source .venv/bin/activate    # Windows: .venv\Scripts\activate
pip install -r requirements.txt

python run.py daily            # 用內建合成資料跑完整流程,產出今日簡報
python run.py serve            # 用瀏覽器打開最新簡報
```

`daily` 預設是 **demo 模式**(合成資料、規則式分析),讓你**不用任何金鑰、不用網路**就先看懂
輸出長相。報告會存在 `reports/daily_brief_<日期>.html`。

驗證因子真的有效(分組回測 + IC):
```bash
python run.py backtest         # 分組報酬單調性、IC/IC-IR、夏普、最大回撤、換手率…
python run.py validate         # 因子多重共線性檢查(>0.7 需擇一/正交化)
pytest tests/ -q               # 跑測試(含前視/生存者偏誤防線驗證)
```

---

## 🔌 接真實資料(免費為主,每月 ~$10 就很夠)

1. 複製金鑰範本並填入(全部選用,填越多功能越完整):
   ```bash
   cp .env.example .env        # 然後編輯 .env
   ```
   | 金鑰 | 用途 | 費用 | 沒有會怎樣 |
   |------|------|------|-----------|
   | `FINMIND_TOKEN` | 台股法人/融資券/財報 | 免費有額度 | 台股額度受限 |
   | (yfinance) | 美股價量 | 免費免金鑰 | — |
   | `GEMINI_API_KEY` | 新聞/社群 LLM 分析 | Google AI Studio 有免費額度 | 退回規則式關鍵詞分析 |
   | `ANTHROPIC_API_KEY` | 同上(擇一即可) | 付費 | 同上 |
   | `SMTP_*` / `REPORT_TO` | 每日簡報寄信 | 免費 | 只存檔不寄信 |

   > 💡 你的 Claude Enterprise / Gemini Pro 是**網頁訂閱**,自動程式無法呼叫;
   > 要讓代理自動分析新聞,需在上面申請 **API 金鑰**(Gemini 免費額度即可起步)。

2. 用真實資料跑:
   ```bash
   python run.py daily --live              # 接真實市場資料
   python run.py daily --live --email      # 跑完並寄到你信箱
   python run.py daily --live --markets US # 只跑美股
   ```

---

## 🤖 設定成「100% 全自動」每日執行

**方式 A:GitHub Actions(推薦,免顧電腦)**
專案已附 `.github/workflows/daily-stock-brief.yml`,每個交易日盤後自動執行並寄信。
只要到 GitHub repo → Settings → Secrets 把上面那些金鑰加進去即可,不用開電腦。

**方式 B:本機排程(macOS/Linux cron)**
```bash
# 每個工作日台北時間 14:40 執行(crontab -e 後貼入,路徑改成你的)
40 14 * * 1-5 cd /path/to/stock-factor-model && ./.venv/bin/python run.py daily --live --email
```

---

## 🧱 系統架構(五層 + 新聞/社群/代理)

```
config/        股票池、因子(權重/方向/理論)、回測參數、社群追蹤清單(YAML 外部化)
src/data       第一層:資料抓取(yfinance/FinMind)、PIT 對齊、合成資料(demo)
src/factors    第二層:四大構面因子計算
src/stats      第三層:去極值 → 標準化 → 產業中性化 → 合成 → 排序、IC/Fama-MacBeth
src/backtest   第四層:十分位分組回測、交易成本、績效指標、單調性
src/output     第五層:候選清單(四構面拆解 + 風險旗標)、HTML/Markdown 簡報
src/news       新增:新聞抓取(RSS)+ LLM 影響分析
src/social     新增:社群意見領袖貼文抓取 + 輿情分析(config/social_sources.yaml)
src/llm        新增:統一 LLM 客戶端(Claude / Gemini / 規則式 fallback)
src/agent      新增:每日主流程 orchestrator + Email 通知
run.py         統一 CLI(daily / backtest / validate / serve)
```

## 設計原則(摘自 `CLAUDE.md`)
- 因子需有經濟邏輯與學術理論支撐;沒有理論能解釋的因子一律存疑。
- 嚴防三大偏誤:前視偏誤、生存者偏誤、過度擬合。
- 台股、美股分開標準化與回測,最後才在投組層整合。
- **新聞與社群是「煙霧」,因子才是「火」**:新聞/社群只作有上限的小幅傾斜,不取代因子模型。

## 資料來源
- 台股:FinMind(法人、融資券、借券、財報)、TWSE/TPEx 開放資料。
- 美股:yfinance(價量)、Financial Modeling Prep / SEC EDGAR(財報、13F、Form 4)。
- 新聞:Google News / Yahoo Finance RSS(免費)。社群:X API / Nitter / 手動貼文檔。
