import { useState } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Empty } from '@/components/ui/empty';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useStore } from '@/lib/store';
import { ntd, fmtDate } from '@/lib/format';
import { Banknote, Trash2 } from 'lucide-react';
import type { PaymentMethod, ParsedPayment } from '@/types';

const methodLabel: Record<PaymentMethod, string> = {
  linepay: 'LINE Pay',
  transfer: '轉帳',
  cash: '現金',
  prepaid: '預付扣抵',
};

export default function Payments() {
  const payments = useStore((s) => s.payments);
  const deletePayment = useStore((s) => s.deletePayment);

  const [active, setActive] = useState<ParsedPayment | null>(null);

  return (
    <div>
      <PageHeader title="付款記錄" back />
      <div className="space-y-3 p-4">
        {payments.length === 0 ? (
          <Empty
            icon={<Banknote className="h-8 w-8" />}
            title="尚無付款記錄"
            description="從匯入頁上傳付款截圖後會自動產生記錄"
          />
        ) : (
          payments.map((p) => (
            <Card
              key={p.id}
              className="p-3 cursor-pointer hover:bg-accent transition-colors"
              onClick={() => setActive(p)}
            >
              <div className="flex items-center justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium truncate">
                      {p.payerNameRaw || '（無名字）'}
                    </span>
                    <Badge
                      variant={
                        p.status === 'confirmed'
                          ? 'success'
                          : p.status === 'rejected'
                          ? 'destructive'
                          : 'warning'
                      }
                      className="text-[10px]"
                    >
                      {p.status === 'confirmed' ? '已確認' : p.status === 'rejected' ? '已擱置' : '待確認'}
                    </Badge>
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {fmtDate(p.receivedAt)} · {methodLabel[p.method]}
                  </div>
                </div>
                <div className="tabular-nums font-semibold">{ntd(p.amount)}</div>
              </div>
            </Card>
          ))
        )}
      </div>

      <Dialog open={Boolean(active)} onOpenChange={(o) => !o && setActive(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>付款記錄詳情</DialogTitle>
          </DialogHeader>
          {active && (
            <div className="space-y-3 text-sm">
              <div>
                <div className="text-xs text-muted-foreground">付款人</div>
                <div>{active.payerNameRaw || '—'}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">金額 · 方式</div>
                <div>{ntd(active.amount)} · {methodLabel[active.method]}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">時間</div>
                <div>{fmtDate(active.receivedAt, 'yyyy/MM/dd HH:mm')}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">配對項目</div>
                <div>{active.matchedItemIds.length} 項</div>
              </div>
              {active.notes && (
                <div>
                  <div className="text-xs text-muted-foreground">AI 備註</div>
                  <div>{active.notes}</div>
                </div>
              )}
              {active.rawText && (
                <div>
                  <div className="text-xs text-muted-foreground">原始文字</div>
                  <pre className="whitespace-pre-wrap text-xs bg-muted p-2 rounded-md">
                    {active.rawText}
                  </pre>
                </div>
              )}
              {active.rawImageBase64 && (
                <div>
                  <div className="text-xs text-muted-foreground mb-1">原始截圖</div>
                  <img
                    src={`data:image/jpeg;base64,${active.rawImageBase64}`}
                    alt="截圖"
                    className="w-full rounded-md"
                  />
                </div>
              )}
              <Button
                variant="destructive"
                className="w-full"
                onClick={() => {
                  deletePayment(active.id);
                  setActive(null);
                }}
              >
                <Trash2 className="h-4 w-4" />
                刪除這筆紀錄
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
