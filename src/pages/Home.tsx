import { Link } from 'react-router-dom';
import { Plus, Upload, Coffee, AlertCircle, ChevronRight } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Empty } from '@/components/ui/empty';
import { Badge } from '@/components/ui/badge';
import { useStore } from '@/lib/store';
import { ntd, fmtDate } from '@/lib/format';

export default function Home() {
  const orders = useStore((s) => s.orders);
  const colleagues = useStore((s) => s.colleagues);
  const settings = useStore((s) => s.settings);

  const colleagueMap = new Map(colleagues.map((c) => [c.id, c]));

  type Row = { colleagueId: string; name: string; total: number; items: number; lastShop: string; lastDate: string };
  const owedMap = new Map<string, Row>();
  for (const o of orders) {
    for (const i of o.items) {
      if (i.paid) continue;
      const c = colleagueMap.get(i.colleagueId);
      const name = c?.name ?? '(已刪除)';
      const row = owedMap.get(i.colleagueId) ?? {
        colleagueId: i.colleagueId,
        name,
        total: 0,
        items: 0,
        lastShop: o.shopName,
        lastDate: o.createdAt,
      };
      row.total += i.price;
      row.items += 1;
      if (new Date(o.createdAt) > new Date(row.lastDate)) {
        row.lastShop = o.shopName;
        row.lastDate = o.createdAt;
      }
      owedMap.set(i.colleagueId, row);
    }
  }

  const owed = [...owedMap.values()].sort((a, b) => b.total - a.total);
  const grandTotal = owed.reduce((a, b) => a + b.total, 0);

  const hasApiKey = Boolean(settings.apiKey);

  return (
    <div>
      <PageHeader title="DrinkRun" subtitle="飲料代訂智慧記帳本" />
      <div className="space-y-4 p-4">
        {!hasApiKey && (
          <Card className="border-amber-500/40 bg-amber-50 dark:bg-amber-950/30 p-4 flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <div className="text-sm font-medium">尚未設定 AI 解析金鑰</div>
              <div className="text-xs text-muted-foreground mt-0.5">設定 Anthropic API key 即可使用截圖匯入功能</div>
              <Link to="/settings" className="text-xs underline mt-2 inline-block">前往設定 →</Link>
            </div>
          </Card>
        )}

        <Card className="p-4">
          <div className="flex items-baseline justify-between">
            <div>
              <div className="text-xs text-muted-foreground">目前待收</div>
              <div className="mt-1 text-3xl font-bold tabular-nums">{ntd(grandTotal)}</div>
            </div>
            <div className="text-sm text-muted-foreground">
              {owed.length} 人 · {owed.reduce((a, b) => a + b.items, 0)} 筆
            </div>
          </div>
        </Card>

        <div className="grid grid-cols-2 gap-3">
          <Button asChild size="lg" className="h-14">
            <Link to="/import">
              <Upload className="h-5 w-5" />
              匯入截圖
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline" className="h-14">
            <Link to="/orders/new">
              <Plus className="h-5 w-5" />
              手動建立
            </Link>
          </Button>
        </div>

        <div>
          <h2 className="mb-2 px-1 text-sm font-medium text-muted-foreground">待收款</h2>
          {owed.length === 0 ? (
            <Empty
              icon={<Coffee className="h-8 w-8" />}
              title="目前沒有待收款"
              description="從匯入截圖或手動建立開始第一筆訂單"
            />
          ) : (
            <div className="space-y-2">
              {owed.map((row) => (
                <Link key={row.colleagueId} to={`/people/${row.colleagueId}`}>
                  <Card className="p-3 flex items-center justify-between hover:bg-accent transition-colors">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{row.name}</span>
                        <Badge variant="secondary" className="text-xs">{row.items} 筆</Badge>
                      </div>
                      <div className="text-xs text-muted-foreground truncate mt-0.5">
                        {row.lastShop} · {fmtDate(row.lastDate)}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="text-right">
                        <div className="font-semibold tabular-nums">{ntd(row.total)}</div>
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </div>

        {orders.length > 0 && (
          <div>
            <h2 className="mb-2 px-1 text-sm font-medium text-muted-foreground">最近訂單</h2>
            <div className="space-y-2">
              {orders.slice(0, 5).map((o) => {
                const unpaid = o.items.filter((i) => !i.paid).length;
                return (
                  <Link key={o.id} to={`/orders/${o.id}`}>
                    <Card className="p-3 flex items-center justify-between hover:bg-accent transition-colors">
                      <div className="min-w-0">
                        <div className="font-medium truncate">{o.shopName}</div>
                        <div className="text-xs text-muted-foreground">
                          {fmtDate(o.createdAt)} · {o.items.length} 杯
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {unpaid > 0 ? (
                          <Badge variant="warning">{unpaid} 筆未付</Badge>
                        ) : (
                          <Badge variant="success">已結清</Badge>
                        )}
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </div>
                    </Card>
                  </Link>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
