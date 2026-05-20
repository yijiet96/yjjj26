import { useMemo, useState } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useStore } from '@/lib/store';
import { ntd, fmtDate, monthKey } from '@/lib/format';

export default function Reconcile() {
  const orders = useStore((s) => s.orders);
  const colleagues = useStore((s) => s.colleagues);
  const payments = useStore((s) => s.payments);

  const months = useMemo(() => {
    const set = new Set<string>();
    orders.forEach((o) => set.add(monthKey(o.createdAt)));
    payments.forEach((p) => set.add(monthKey(p.receivedAt)));
    const arr = [...set].sort((a, b) => (a < b ? 1 : -1));
    if (arr.length === 0) arr.push(monthKey(new Date().toISOString()));
    return arr;
  }, [orders, payments]);

  const [month, setMonth] = useState<string>(months[0]);
  const cMap = new Map(colleagues.map((c) => [c.id, c]));

  const stats = useMemo(() => {
    const monthOrders = orders.filter((o) => monthKey(o.createdAt) === month);
    const monthPayments = payments.filter((p) => monthKey(p.receivedAt) === month);
    let total = 0;
    let collected = 0;
    let outstanding = 0;
    const byPerson = new Map<
      string,
      { name: string; total: number; paid: number; owed: number }
    >();
    for (const o of monthOrders) {
      for (const i of o.items) {
        total += i.price;
        if (i.paid) collected += i.price;
        else outstanding += i.price;
        const cName = cMap.get(i.colleagueId)?.name ?? '(已刪除)';
        const row = byPerson.get(i.colleagueId) ?? {
          name: cName,
          total: 0,
          paid: 0,
          owed: 0,
        };
        row.total += i.price;
        if (i.paid) row.paid += i.price;
        else row.owed += i.price;
        byPerson.set(i.colleagueId, row);
      }
    }
    const paymentsSum = monthPayments
      .filter((p) => p.status === 'confirmed')
      .reduce((a, b) => a + b.amount, 0);
    return {
      total,
      collected,
      outstanding,
      paymentsSum,
      perPerson: [...byPerson.values()].sort((a, b) => b.owed - a.owed),
      orderCount: monthOrders.length,
      paymentCount: monthPayments.length,
    };
  }, [orders, payments, month, cMap]);

  return (
    <div>
      <PageHeader title="對帳" back />
      <div className="space-y-4 p-4">
        <select
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
        >
          {months.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>

        <div className="grid grid-cols-2 gap-3">
          <Card className="p-3">
            <div className="text-xs text-muted-foreground">本月總金額</div>
            <div className="text-xl font-semibold tabular-nums">{ntd(stats.total)}</div>
          </Card>
          <Card className="p-3">
            <div className="text-xs text-muted-foreground">{stats.orderCount} 筆訂單</div>
            <div className="text-xl font-semibold tabular-nums">
              {stats.paymentCount} <span className="text-sm">筆收款</span>
            </div>
          </Card>
          <Card className="p-3">
            <div className="text-xs text-muted-foreground">已收（標已付總額）</div>
            <div className="text-xl font-semibold tabular-nums text-emerald-600">
              {ntd(stats.collected)}
            </div>
          </Card>
          <Card className="p-3">
            <div className="text-xs text-muted-foreground">待收</div>
            <div className="text-xl font-semibold tabular-nums text-amber-600">
              {ntd(stats.outstanding)}
            </div>
          </Card>
        </div>

        <Card className="p-3">
          <div className="text-xs text-muted-foreground">付款記錄總額（已確認）</div>
          <div className="text-lg font-semibold tabular-nums">{ntd(stats.paymentsSum)}</div>
          {stats.paymentsSum !== stats.collected && (
            <div className="mt-1 text-xs text-amber-600">
              ⚠ 付款記錄總額與「已收」不一致，可能有手動標記為已付的項目沒對應到記錄
            </div>
          )}
        </Card>

        <div>
          <h2 className="text-sm font-medium text-muted-foreground mb-2 px-1">每人明細</h2>
          {stats.perPerson.length === 0 ? (
            <Card className="p-4 text-center text-sm text-muted-foreground">本月沒有訂單</Card>
          ) : (
            <div className="space-y-2">
              {stats.perPerson.map((p) => (
                <Card key={p.name} className="p-3">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{p.name}</span>
                    <div className="text-right">
                      <div className="tabular-nums font-semibold">{ntd(p.total)}</div>
                      {p.owed > 0 ? (
                        <Badge variant="warning" className="text-[10px]">
                          欠 {ntd(p.owed)}
                        </Badge>
                      ) : (
                        <Badge variant="success" className="text-[10px]">已結</Badge>
                      )}
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
