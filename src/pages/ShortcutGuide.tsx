import { PageHeader } from '@/components/PageHeader';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Copy, AlertTriangle } from 'lucide-react';
import { useState } from 'react';

const URLS = {
  auto: '/import?type=auto&text=',
  ubereats: '/import?type=ubereats&text=',
  payment: '/import?type=payment&text=',
};

export default function ShortcutGuide() {
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://drinkrun.app';
  const [copied, setCopied] = useState<string | null>(null);

  function copy(url: string) {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(url);
      setTimeout(() => setCopied((c) => (c === url ? null : c)), 1500);
    });
  }

  return (
    <div>
      <PageHeader title="iOS 捷徑教學" back />
      <div className="space-y-4 p-4">
        <Card className="p-4 space-y-2 bg-blue-500/10 border-blue-500/30">
          <div className="font-semibold">設計目標</div>
          <div className="text-sm">
            從任何 App 的通知頁（LINE Pay、銀行 App、UberEats 等）按分享 → 選「Send to DrinkRun」→
            DrinkRun 自動開啟並進入匯入流程。
          </div>
        </Card>

        <Card className="p-4 space-y-3">
          <div className="font-semibold">步驟（在 iOS「捷徑」App）</div>
          <p className="text-xs text-muted-foreground">
            iOS 沒有「取得分享輸入內容」這個動作 ──「分享進來的內容」是自動提供的
            <b className="text-foreground">「捷徑輸入」</b>變數，要靠捷徑設定裡的
            <b className="text-foreground">「在分享表單中顯示」</b>來啟用。
          </p>
          <ol className="space-y-3 text-sm list-decimal pl-5">
            <li>打開「捷徑」App → 點右上「<b>＋</b>」新增捷徑</li>
            <li>
              點右上的 <b>ⓘ 資訊</b> →
              <ul className="list-disc pl-4 mt-1 space-y-0.5 text-xs">
                <li>開啟「<b>在分享表單中顯示</b>」</li>
                <li>「接受的類型」只勾「<b>文字</b>」，其他全部取消</li>
                <li>按右上「完成」回到捷徑編輯畫面</li>
              </ul>
            </li>
            <li>
              加入動作「<b>對 URL 編碼</b>」（搜尋 <code className="text-xs bg-muted px-1 rounded">URL Encode</code>）
              <ul className="list-disc pl-4 mt-1 space-y-0.5 text-xs">
                <li>點動作中的「文字」欄位 → 從鍵盤上方的變數列選「<b>捷徑輸入</b>」</li>
              </ul>
            </li>
            <li>
              加入動作「<b>打開 URL</b>」（搜尋 <code className="text-xs bg-muted px-1 rounded">Open URL</code>）
              <ul className="list-disc pl-4 mt-1 space-y-0.5 text-xs">
                <li>在 URL 欄位先貼上下方的網址字首</li>
                <li>把游標停在最後 → 從變數列選「<b>已 URL 編碼</b>」（上一步的輸出）</li>
              </ul>
            </li>
            <li>把捷徑命名「<b>Send to DrinkRun</b>」→ 右上「完成」儲存</li>
            <li>
              日後在任何 App 通知 / 簡訊 / 備忘錄選文字 → 分享 →
              捲到下方的「<b>Send to DrinkRun</b>」即可
            </li>
          </ol>
        </Card>

        <Card className="p-4 space-y-3">
          <div className="font-semibold">最終捷徑長這樣（3 個動作）</div>
          <pre className="text-xs bg-muted p-3 rounded-md overflow-x-auto whitespace-pre">{`接收：分享表單  ▸  類型「文字」
─────────────────────────
① 對 URL 編碼
   文字： 〈捷徑輸入〉
   ↓
② 文字（可選，方便除錯）
   "${origin}/import?type=auto&text=" + 〈已 URL 編碼〉
   ↓
③ 打開 URL
   URL： 上一步的「文字」
        （或直接「網址字首」+ 〈已 URL 編碼〉）`}</pre>
          <p className="text-xs text-muted-foreground">
            最精簡只要兩個動作：「對 URL 編碼」+「打開 URL」。中間加一個「文字」動作只是讓 URL 比較好讀。
          </p>
        </Card>

        <Card className="p-4 space-y-3">
          <div className="font-semibold">捷徑要用的 URL 字首</div>
          {(
            [
              ['萬用（自動判斷類型）', URLS.auto],
              ['付款通知專用', URLS.payment],
              ['UberEats 訂單專用', URLS.ubereats],
            ] as const
          ).map(([label, path]) => {
            const url = origin + path;
            return (
              <div key={path} className="space-y-1">
                <div className="text-xs text-muted-foreground">{label}</div>
                <div className="flex gap-2">
                  <code className="flex-1 text-xs bg-muted px-2 py-1.5 rounded-md break-all">
                    {url}
                  </code>
                  <Button size="sm" variant="outline" onClick={() => copy(url)}>
                    <Copy className="h-4 w-4" />
                    {copied === url ? '已複製' : '複製'}
                  </Button>
                </div>
              </div>
            );
          })}
          <div className="text-xs text-muted-foreground">
            記得在「打開 URL」最後接上「<b>已 URL 編碼</b>」變數，不能直接接「捷徑輸入」（會被特殊字元卡住）。
          </div>
        </Card>

        <Card className="p-4 space-y-2 bg-amber-500/10 border-amber-500/30">
          <div className="font-semibold flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            常見坑
          </div>
          <ul className="text-sm text-muted-foreground space-y-1.5 list-disc pl-5">
            <li>
              <b className="text-foreground">沒看到「捷徑輸入」變數？</b>
              代表「在分享表單中顯示」沒開、或「接受的類型」沒勾文字。回到 ⓘ 設定檢查。
            </li>
            <li>
              <b className="text-foreground">App 打開但什麼都沒解析？</b>
              代表 URL 裡的 text 是空的。檢查是用「已 URL 編碼」而不是「捷徑輸入」。
            </li>
            <li>
              <b className="text-foreground">分享表單裡找不到？</b>
              在分享面板往下捲，最下面有「編輯動作」可以把捷徑釘到上面常用區。
            </li>
            <li>
              <b className="text-foreground">圖片無法傳？</b>
              iOS 捷徑可傳純文字，但圖片受 URL 長度限制傳不過去。要解析圖片仍須回到 App 內用「上傳截圖」流程。
              LINE Pay 通知純文字版本資訊已足夠（金額、付款人都有）。
            </li>
          </ul>
        </Card>
      </div>
    </div>
  );
}
