import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Send, Trash2, MoreVertical, ImageIcon } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useStore } from '@/lib/store';
import { ntd, fmtDate } from '@/lib/format';
import { totalOwed, totalPaid } from '@/lib/matching';
import type { OrderItem, PaymentMethod } from '@/types';

const methodLabel: Record<PaymentMethod, string> = {
  linepay: 'LINE Pay',
  transfer: '轉帳',
  cash: '現金',
};

export default function OrderDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const order = useStore((s) => s.orders.find((o) => o.id === id));
  const colleagues = useStore((s) => s.colleagues);
  const setItemPaid = useStore((s) => s.setItemPaid);
  const setItemUnpaid = useStore((s) => s.setItemUnpaid);
  const deleteOrder = useStore((s) => s.deleteOrder);

  const [activeItem, setActiveItem] = useState<OrderItem | null>(null);
  const [showImage, setShowImage] = useState(false);
  const [showDelete, setShowDelete] = useState(false);

  if (!order) {
    return (
      <div>
        <PageHeader title="訂單不存在" back />
        <div className="p-6 text-center text-muted-foreground">找不到此訂單</div>
      </div>
    );
  }

  const colMap = new Map(colleagues.map((c) => [c.id, c]));
  const owed = totalOwed(order.items);
  const paid = totalPaid(order.items);
  const unpaidCount = order.items.filter((i) => !i.paid).length;

  function handlePay(method: PaymentMethod) {
    if (!activeItem) return;
    setItemPaid(order!.id, activeItem.id, method);
    setActiveItem(null);
  }

  function handleUnpay() {
    if (!activeItem) return;
    setItemUnpaid(order!.id, activeItem.id);
    setActiveItem(null);
  }

  function handleDelete() {
    deleteOrder(order!.id);
    navigate('/', { replace: true });
  }

  return (
    <div>
      <PageHeader
        title={order.shopName}
        subtitle={`${fmtDate(order.createdAt)} · ${order.items.length} 杯`}
        back
        right={
          <Button size="icon" variant="ghost" onClick={() => setShowDelete(true)} aria-label="更多">
            <MoreVertical className="h-5 w-5" />
          </Button>
        }
      />
      <div className="space-y-4 p-4">
        <div className="grid grid-cols-2 gap-3">
          <Card className="p-3">
            <div className="text-xs text-muted-foreground">未收</div>
            <div className="text-xl font-semibold tabular-nums">{ntd(owed)}</div>
          </Card>
          <Card className="p-3">
            <div className="text-xs text-muted-foreground">已收</div>
            <div className="text-xl font-semibold tabular-nums text-emerald-600">{ntd(paid)}</div>
          </Card>
        </div>

        {unpaidCount > 0 && (
          <Button asChild className="w-full" size="lg">
            <Link to={`/orders/${order.id}/notify`}>
              <Send className="h-5 w-5" />
              通知 {unpaidCount} 位未付者
            </Link>
          </Button>
        )}

        {order.rawImageBase64 && (
          <Button variant="outline" className="w-full" onClick={() => setShowImage(true)}>
            <ImageIcon className="h-4 w-4" />
            查看原始截圖
          </Button>
        )}

        <div className="space-y-2">
          {order.items.map((item) => {
            const c = colMap.get(item.colleagueId);
            return (
              <Card
                key={item.id}
                className="p-3 cursor-pointer hover:bg-accent transition-colors"
                onClick={() => setActiveItem(item)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{c?.name ?? '(已刪除)'}</span>
                      {item.paid ? (
                        <Badge variant="success">
                          {item.paymentMethod ? methodLabel[item.paymentMethod] : '已付'}
                        </Badge>
                      ) : (
                        <Badge variant="warning">未付</Badge>
                      )}
                    </div>
                    <div className="text-sm text-muted-foreground truncate mt-0.5">
                      {item.drinkName}
                    </div>
                  </div>
                  <div className="text-right font-semibold tabular-nums">{ntd(item.price)}</div>
                </div>
              </Card>
            );
          })}
        </div>

        {order.note && (
          <Card className="p-3">
            <div className="text-xs text-muted-foreground mb-1">備註</div>
            <div className="text-sm whitespace-pre-wrap">{order.note}</div>
          </Card>
        )}
      </div>

      <Sheet open={Boolean(activeItem)} onOpenChange={(o) => !o && setActiveItem(null)}>
        <SheetContent>
          {activeItem && (
            <>
              <SheetHeader>
                <SheetTitle>{colMap.get(activeItem.colleagueId)?.name ?? '(已刪除)'}</SheetTitle>
              </SheetHeader>
              <div className="mt-3 text-sm text-muted-foreground">
                {activeItem.drinkName} · {ntd(activeItem.price)}
              </div>
              <div className="mt-5 space-y-2">
                {activeItem.paid ? (
                  <>
                    <div className="text-sm text-muted-foreground">
                      已於 {activeItem.paidAt ? fmtDate(activeItem.paidAt) : '—'} 收款（
                      {activeItem.paymentMethod ? methodLabel[activeItem.paymentMethod] : '—'}）
                    </div>
                    <Button variant="outline" className="w-full" onClick={handleUnpay}>
                      標記為未付
                    </Button>
                  </>
                ) : (
                  <>
                    <Button className="w-full" onClick={() => handlePay('linepay')}>
                      LINE Pay 已收
                    </Button>
                    <Button className="w-full" variant="secondary" onClick={() => handlePay('transfer')}>
                      銀行轉帳已收
                    </Button>
                    <Button className="w-full" variant="secondary" onClick={() => handlePay('cash')}>
                      現金已收
                    </Button>
                  </>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      <Dialog open={showImage} onOpenChange={setShowImage}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle>原始截圖</DialogTitle>
          </DialogHeader>
          {order.rawImageBase64 && (
            <img
              src={`data:image/jpeg;base64,${order.rawImageBase64}`}
              alt="原始截圖"
              className="w-full rounded-md"
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={showDelete} onOpenChange={setShowDelete}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle>刪除訂單？</DialogTitle>
            <DialogDescription>此操作無法復原。</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDelete(false)}>
              取消
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              <Trash2 className="h-4 w-4" />
              確定刪除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
