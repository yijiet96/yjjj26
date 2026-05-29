import { PageHeader } from '@/components/PageHeader';
import { Card } from '@/components/ui/card';

export default function ShortcutGuide() {
  return (
    <div>
      <PageHeader title="iOS 分享整合" back />
      <div className="space-y-4 p-4">

        {/* Method A: Web Share Target */}
        <Card className="p-4 space-y-3 border-emerald-500/40 bg-emerald-500/5">
          <div className="flex items-center gap-2">
            <span className="text-lg">⭐</span>
            <div className="font-semibold">方法一：系統分享表單（推薦）</div>
          </div>
          <div className="text-sm text-muted-foreground">
            DrinkRun 加到主畫面後，直接出現在 iOS 分享表單，零設定。
          </div>
          <div className="text-sm font-medium">首次設定（一次就好）</div>
          <ol className="space-y-1.5 text-sm list-decimal pl-5">
            <li>Safari 開啟 <b>drinkrun.pages.dev</b></li>
            <li>點底部分享 <span className="font-mono bg-muted px-1 rounded">⬆</span> → 加入主畫面</li>
            <li>完成</li>
          </ol>
          <div className="text-sm font-medium">每次使用</div>
          <ol className="space-y-1.5 text-sm list-decimal pl-5">
            <li>UberEats 開啟團購連結</li>
            <li>點分享 <span className="font-mono bg-muted px-1 rounded">⬆</span> → 往下找 <b>DrinkRun</b></li>
            <li>自動跳到讀取頁面，無需額外操作</li>
          </ol>
          <Card className="p-3 bg-muted text-xs text-muted-foreground">
            需求：iOS 16.4 以上 + Safari + DrinkRun 已加到主畫面
          </Card>
        </Card>

        {/* Method B: Shortcut + Open App (clipboard) */}
        <Card className="p-4 space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-lg">📋</span>
            <div className="font-semibold">方法二：iOS 捷徑</div>
          </div>
          <div className="text-sm text-muted-foreground">
            適用所有 iOS 版本。需先把 DrinkRun 加到主畫面。
          </div>

          <div className="text-sm font-medium">建立捷徑（一次）</div>
          <ol className="space-y-2 text-sm list-decimal pl-5">
            <li>打開「<b>捷徑</b>」App → 右上 <b>＋</b></li>
            <li>
              搜尋動作：<b>接受輸入</b><br />
              <span className="text-xs text-muted-foreground">接受：URL ｜ 輸入來源：分享表單</span>
            </li>
            <li>
              搜尋動作：<b>拷貝到剪貼簿</b><br />
              <span className="text-xs text-muted-foreground">輸入：捷徑輸入</span>
            </li>
            <li>
              搜尋動作：<b>開啟 App</b> → 選 <b>DrinkRun</b>（主畫面圖示）<br />
              <span className="text-xs text-amber-600">⚠ 是「開啟 App」，不是「打開 URL」</span>
            </li>
            <li>點右上 <b>⋯</b> → 詳細資訊 → 開啟「<b>顯示於分享表單</b>」</li>
            <li>命名「DrinkRun 團購」→ 完成</li>
          </ol>

          <div className="text-sm font-medium">每次使用</div>
          <ol className="space-y-1.5 text-sm list-decimal pl-5">
            <li>UberEats 開啟團購連結頁面</li>
            <li>點分享 <span className="font-mono bg-muted px-1 rounded">⬆</span> → 選「<b>DrinkRun 團購</b>」</li>
            <li>DrinkRun 開啟，iOS 詢問「允許貼上內容」→ <b>允許</b></li>
            <li>自動跳到讀取頁面，網址已填入 → 點「讀取訂單」</li>
          </ol>

          <Card className="p-3 bg-muted text-xs text-muted-foreground space-y-1">
            <div>第一次會問剪貼板權限，允許後之後不再詢問</div>
            <div>DrinkRun 無論停在哪一頁，都會自動跳到讀取頁面</div>
          </Card>
        </Card>

        <Card className="p-3 space-y-1 text-xs text-muted-foreground">
          <div className="font-medium text-foreground">注意事項</div>
          <div>• 兩種方法都需要 DrinkRun 已加到 iOS 主畫面</div>
          <div>• 付款通知（LINE Pay、銀行）也支援分享 → 自動解析</div>
          <div>• 圖片無法透過捷徑傳送，請回到 App 內用截圖上傳</div>
        </Card>
      </div>
    </div>
  );
}
