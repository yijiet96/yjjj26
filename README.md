# DrinkRun v2 · 飲料代訂智慧記帳本

> 給經常用 UberEats 幫同事訂飲料的 iPhone 使用者用的 PWA。
> AI 輔助：截圖匯入訂單、付款通知自動解析、一鍵生成 LINE 通知訊息。

---

## TL;DR — 我現在該怎麼用？

1. **拿 API key**：到 [console.anthropic.com](https://console.anthropic.com/) → API Keys → 建立一把 `sk-ant-...`，到 Billing 加幾塊美金信用額度。
2. **本機跑起來**：在這個 repo 目錄下執行
   ```bash
   npm install
   npm run dev
   ```
   開 `http://localhost:5173`。
3. **設定金鑰**：App 進到 **設定 → AI 解析**，貼上 API key，按「測試連線」確認 OK，按「儲存」。
4. **第一筆訂單**：
   - 有 UberEats 團購截圖 → **匯入 → UberEats 訂單截圖**，AI 解析後確認。
   - 沒截圖 → 首頁 **手動建立**。
5. **收到付款通知** → **匯入 → 付款通知截圖**，AI 配對 → 確認標記已付。
6. **催款** → 訂單詳情點「通知未付者」→ 對每人「在 LINE 開啟」。

詳細步驟見下面各章節。

---

## 1. 環境需求

- Node.js 18+（建議 20 LTS）
- 一把 Anthropic API key（用量約 NT$ 0.1–0.5 / 解析一張截圖）
- 想加到主畫面 → iPhone iOS 16.4+，用 **Safari**（Chrome on iOS 沒辦法加 PWA 到主畫面）

---

## 2. 本機開發

```bash
npm install
npm run dev      # 開發伺服器，預設 http://localhost:5173
npm run build    # 編譯出 dist/
npm run preview  # 跑 dist/ 起來，可用實機連上來測
```

讓 iPhone 連上你電腦上的 dev server：
```bash
npm run dev -- --host  # 印出 LAN IP，例如 http://192.168.1.42:5173
```
手機跟電腦同網段 → Safari 開那個 URL。

> ⚠️ **PWA 加到主畫面只有 HTTPS 才會啟用所有功能**。`localhost` 算例外可以加，但 LAN IP HTTP 的話 service worker / 截圖權限會受限。最完整體驗請見「部署」章節。

---

## 3. 部署到雲端（要做才能在 iPhone 上長期用）

### 推薦：Cloudflare Pages（免費，可設 Access policy）

1. 把這個 branch push 到一個 GitHub repo
2. Cloudflare Dashboard → Workers & Pages → Create application → Pages → Connect to Git
3. Build command: `npm run build`，Output directory: `dist`
4. 部署完後到 **Settings → Cloudflare Access** 設一個 policy 限制只有你自己的 email 能進

### 替代：Vercel

```bash
npx vercel
# Build Command: npm run build
# Output Directory: dist
```

跟 Cloudflare 一樣，到 dashboard 加 Password Protection / Vercel Auth。

> ⚠️ **不要部署到公開 URL 沒設 access policy**。API key 雖然存在 localStorage 不在 bundle 裡，但任何能打開你 App 的人也能用同一個 origin 把 key 拿走。**這份程式碼也不要 push 到 public repo 後直接接 CI 部署**。

---

## 4. 加到 iPhone 主畫面

1. iPhone Safari 開你的部署 URL（或 localhost）
2. 下面分享按鈕 → 加到主畫面
3. 命名 `DrinkRun` → 加入
4. 從主畫面點圖示開啟，會以全螢幕 standalone 模式啟動

---

## 5. 設定 iOS 捷徑（可選，但超推薦）

讓你在 **任何 App 的通知頁**（LINE Pay、銀行、UberEats）按分享 → 「執行捷徑」→ 「Send to DrinkRun」→ App 自動開啟並進入匯入流程。

設定步驟在 App 內：**設定 → iOS 捷徑教學**，已內建 URL 字首一鍵複製。

簡述：
1. iOS「捷徑」App → 新增捷徑
2. 加動作「取得分享輸入內容」（類型勾「文字」）
3. 加動作「打開 URL」，URL 設為 `https://<your-host>/import?type=auto&text=` 接「分享的輸入內容」變數
4. 在「捷徑詳細資訊」開啟「顯示於分享表單中」

> 限制：iOS 捷徑只能傳純文字，圖片受 URL 長度限制傳不過去。要解析圖片仍需在 App 內用「上傳截圖」。

---

## 6. 日常使用流程

### A. 建立訂單

| 情境 | 怎麼做 |
| --- | --- |
| 我用 UberEats 揪同事訂飲料 | App 內 **匯入 → UberEats 訂單截圖** → 選截圖 → 裁切（可選）→ AI 解析 → 確認每個名字對應的同事 → 建立訂單 |
| 我自己跑腿買 | 首頁 **手動建立** → 一行一筆輸入 |

第一次匯入時，每個新名字都會跳「這是誰？」對話框，你選 **建立新同事** 或 **對應到既有同事**。下次同一個名字出現會自動配對（截圖名字會自動進 aliases）。

### B. 收到付款

| 情境 | 怎麼做 |
| --- | --- |
| LINE Pay / 銀行 App 跳出收款通知 | 截圖 → **匯入 → 付款通知截圖**（可一次選多張）→ AI 解析金額 + 付款人 → 自動配對未付項目 |
| 我已經設定 iOS 捷徑 | 直接從通知頁分享 → Send to DrinkRun → App 開啟並自動建立待確認紀錄 |
| 同事用現金付 | 訂單詳情點該品項 → bottom sheet 選「現金已收」 |

配對邏輯：
- 找到付款人 + 金額剛好等於某一筆 → 自動勾選，按「確認」即可
- 金額等於某幾筆未付加總 → 組合配對，標記為「組合配對」
- 找不到對應 → 你手動選同事 + 勾項目

### C. 催款

訂單詳情頁 → **通知 N 位未付者** → 每人一張卡：
- 編輯訊息（用 `{name}/{drinks}/{amount}/{shop}/{date}` 變數）
- **📋 複製訊息** — fallback
- **💬 在 LINE 開啟** — iPhone 上會跳出 LINE 分享選人介面，預填好訊息

訊息範本可以在 **設定 → 訊息範本** 改成你自己的口吻。

### D. 對帳

**設定 → 對帳** → 選月份 → 看本月總額、已收、待收、每人明細。

---

## 7. 資料與隱私

- 所有資料（訂單、同事、付款記錄、API key）**只存在 localStorage**，沒有後端、沒有雲端同步
- AI 解析時截圖會直接傳給 Anthropic API（你的 key、你的 prompt、你的圖）
- 原始截圖會壓縮到 1568px 長邊、JPEG quality 0.8 後存進 localStorage 方便日後查證
- localStorage 上限約 5 MB，**設定 → 資料管理 → 清除所有截圖** 可只刪截圖、保留訂單資料
- 備份用 **匯出 JSON**（不含 API key，方便給別台手機）；**匯入 JSON** 會整包覆蓋現有資料

---

## 8. 技術棧

- Vite + React 18 + TypeScript + Tailwind CSS
- shadcn-style 元件（Radix UI primitives）
- Zustand + persist middleware
- React Router v6（BrowserRouter，支援 URL query params）
- date-fns + zh-TW locale
- `@anthropic-ai/sdk`（前端直接呼叫，`dangerouslyAllowBrowser: true`）
- react-image-crop
- vite-plugin-pwa（manifest + Workbox SW）

模型預設 `claude-sonnet-4-5`，可在設定切到 `claude-opus-4-7`（解析品質更高、成本更高）。

---

## 9. 已知限制

- 不會自動讀通知（iOS / Android 平台禁止）
- 不會自動發 LINE 訊息（LINE 不允許主動發未加好友者）
- 沒有後端、沒有多人協作、沒有跨裝置同步（v3+ 可能加）
- 不支援 Chrome on iOS 加主畫面（必須 Safari）
- 一次匯入太多張截圖會撞 Anthropic rate limit，慢慢來

---

## 10. 故障排除

| 症狀 | 解法 |
| --- | --- |
| 設定頁「測試連線」失敗 | 確認 key 是 `sk-ant-...` 開頭、Anthropic Console 有 credit |
| 解析回來「AI 解析失敗」 | 通常是 JSON 包 markdown fence，已內建處理；仍失敗請改用較清楚的截圖、或裁切只留訂單區域 |
| 截圖匯入卡住 | 圖太大／網路慢，先把 iPhone 的「畫面截圖」設定關掉 HEIC 用 JPG 比較快 |
| LINE 沒跳出 | 確認 LINE App 已安裝、是用 Safari 開 DrinkRun，而非桌面 Chrome |
| 加到主畫面後白屏 | service worker 第一次裝完需要重新整理一次 |
| localStorage 滿了 | 設定 → 清除所有截圖；或匯出 JSON 後 → 清除所有資料 → 匯入回來 |

---

## 11. Roadmap（v3+ 可能加）

- 雲端備份（GitHub Gist token 或 iCloud Drive Public URL）
- 純文字訂單解析（省 vision token）
- 統計圖表：每月飲料花費、Top 10 飲料、欠款排行榜
- 英文介面
