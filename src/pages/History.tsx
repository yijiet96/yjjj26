import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Empty } from '@/components/ui/empty';
import { Input } from '@/components/ui/input';
import { useStore } from '@/lib/store';
import { ntd, fmtDate, monthKey } from '@/lib/format';
import { totalOwed } from '@/lib/matching';

export default function History() {
  const orders = useStore((s) => s.orders);
  const [q, setQ] = useState('');

  const filtered = useMemo(() => {
    const norm = q.trim().toLowerCase();
    if (!norm) return orders;
    return orders.filter((o) => {
      if (o.shopName.toLowerCase().includes(norm)) return true;
      if (o.note?.toLowerCase().includes(norm)) return true;
      return o.items.some((i) => i.drinkName.toLowerCase().includes(norm));
    });
  }, [orders, q]);

  const grouped = useMemo(() => {
    const map = new Map<string, typeof filtered>();
    for (const o of filtered) {
      const key = monthKey(o.createdAt);
      const arr = map.get(key) ?? [];
      arr.push(o);
      map.set(key, arr);
    }
    return [...map.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [filtered]);

  return (
    <div>
      <PageHeader title="歷史訂單" />
      <div className="space-y-4 p-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜尋店家、飲料、備註"
            className="pl-9"
          />
        </div>

        {orders.length === 0 && (
          <Empty title="尚無歷史訂單" description="第一筆訂單建立後會顯示在這裡" />
        )}

        {grouped.map(([month, list]) => {
          const monthTotal = list.reduce(
            (a, o) => a + o.items.reduce((b, i) => b + i.price, 0),
            0,
          );
          return (
            <div key={month}>
              <div className="flex items-center justify-between mb-2 px-1">
                <h2 className="text-sm font-medium text-muted-foreground">{month}</h2>
                <span className="text-xs text-muted-foreground tabular-nums">
                  共 {ntd(monthTotal)}
                </span>
              </div>
              <div className="space-y-2">
                {list.map((o) => {
                  const owed = totalOwed(o.items);
                  return (
                    <Link key={o.id} to={`/orders/${o.id}`}>
                      <Card className="p-3 flex items-center justify-between hover:bg-accent transition-colors">
                        <div className="min-w-0">
                          <div className="font-medium truncate">{o.shopName}</div>
                          <div className="text-xs text-muted-foreground">
                            {fmtDate(o.createdAt)} · {o.items.length} 杯
                          </div>
                        </div>
                        <div>
                          {owed > 0 ? (
                            <Badge variant="warning">欠 {ntd(owed)}</Badge>
                          ) : (
                            <Badge variant="success">已結清</Badge>
                          )}
                        </div>
                      </Card>
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
