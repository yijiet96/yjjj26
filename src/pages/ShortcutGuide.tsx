import { PageHeader } from '@/components/PageHeader';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Copy } from 'lucide-react';
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
            從任何 App 的通知頁（LinePay、銀行 App、UberEats 等）按分享 → 選「執行捷徑」→ 選「Send to DrinkRun」→
            DrinkRun 開啟並自動進入匯入流程。
          </div>
        </Card>

        <Card className="p-4 space-y-3">
          <div className="font-semibold">步驟（在 iOS「捷徑」App）</div>
          <ol className="space-y-2 text-sm list-decimal pl-5">
            <li>新增捷徑，點右上 ＋</li>
            <li>加入動作「<b>取得分享輸入內容</b>」，輸入類型勾「文字」</li>
            <li>加入動作「<b>打開 URL</b>」，URL 設為下方提供的網址 + 「分享的輸入內容」變數</li>
            <li>設定捷徑名稱「Send to DrinkRun」</li>
            <li>在「捷徑詳細資訊」開啟「<b>顯示於分享表單中</b>」</li>
            <li>完成。日後在任何 App 通知點分享，往下捲到「執行捷徑」即可</li>
          </ol>
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
            把這個 URL 貼到捷徑的「打開 URL」動作中，再接上「分享的輸入內容」變數即可。
          </div>
        </Card>

        <Card className="p-4 space-y-2">
          <div className="font-semibold">⚠️ 限制</div>
          <div className="text-sm text-muted-foreground">
            iOS 捷徑可傳純文字，但圖片受 URL 長度限制無法直接傳。
            若要解析圖片，仍須回到 App 內用「上傳截圖」流程。
            LinePay 通知純文字版本資訊已足夠（金額、付款人都有）。
          </div>
        </Card>
      </div>
    </div>
  );
}
