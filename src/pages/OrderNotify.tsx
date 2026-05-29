import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Copy, MessageCircle, Check } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { useStore } from '@/lib/store';
import { ntd, fmtDate } from '@/lib/format';
import { renderTemplate } from '@/lib/matching';

export default function OrderNotify() {
  const { id } = useParams();
  const order = useStore((s) => s.orders.find((o) => o.id === id));
  const colleagues = useStore((s) => s.colleagues);
  const template = useStore((s) => s.settings.messageTemplate);

  const colMap = new Map(colleagues.map((c) => [c.id, c]));
  const groups = useMemo(() => {
    if (!order) return [];
    type Group = { colleagueId: string; name: string; lineName?: string; total: number; drinks: string[] };
    const map = new Map<string, Group>();
    for (const i of order.items) {
      if (i.paid) continue;
      const c = colMap.get(i.colleagueId);
      const g = map.get(i.colleagueId) ?? {
        colleagueId: i.colleagueId,
        name: c?.name ?? '(已刪除)',
        lineName: c?.lineDisplayName,
        total: 0,
        drinks: [],
      };
      g.total += i.price;
      g.drinks.push(i.drinkName);
      map.set(i.colleagueId, g);
    }
    return [...map.values()].sort((a, b) => b.total - a.total);
  }, [order, colMap]);

  const dateStr = order ? fmtDate(order.createdAt, 'M/d') : '';
  const initialMsgs = useMemo(
    () =>
      Object.fromEntries(
        groups.map((g) => [
          g.colleagueId,
          renderTemplate(template, {
            name: g.name,
            drinks: g.drinks.join('、'),
            amount: g.total,
            shop: order?.shopName ?? '',
            date: dateStr,
          }),
        ]),
      ),
    [groups, template, order, dateStr],
  );
  const [messages, setMessages] = useState<Record<string, string>>(initialMsgs);
  const [copied, setCopied] = useState<string | null>(null);

  if (!order) {
    return (
      <div>
        <PageHeader title="訂單不存在" back />
      </div>
    );
  }

  async function copyText(key: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
    }
  }

  function openLine(text: string) {
    const url = `https://line.me/R/share?text=${encodeURIComponent(text)}`;
    window.location.href = url;
  }

  function copyAll() {
    const text = groups
      .map((g) => `【${g.name}】\n${messages[g.colleagueId]}`)
      .join('\n\n———\n\n');
    copyText('__all__', text);
  }

  if (groups.length === 0) {
    return (
      <div>
        <PageHeader title="通知未付者" back />
        <div className="p-6 text-center text-muted-foreground">這筆訂單沒有待收款項目</div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title={`通知 ${groups.length} 位未付者`} subtitle={order.shopName} back />
      <div className="space-y-4 p-4">
        <Card className="p-3 flex items-center justify-between">
          <div className="text-sm text-muted-foreground">
            可在 <span className="underline">設定 → 訊息範本</span> 調整預設文字
          </div>
        </Card>

        {groups.map((g) => {
          const text = messages[g.colleagueId];
          return (
            <Card key={g.colleagueId} className="p-3 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium">{g.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {g.drinks.join('、')}
                  </div>
                </div>
                <Badge variant="warning">{ntd(g.total)}</Badge>
              </div>
              <Textarea
                value={text}
                onChange={(e) =>
                  setMessages((m) => ({ ...m, [g.colleagueId]: e.target.value }))
                }
                rows={4}
              />
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" onClick={() => copyText(g.colleagueId, text)}>
                  {copied === g.colleagueId ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  複製訊息
                </Button>
                <Button onClick={() => openLine(text)}>
                  <MessageCircle className="h-4 w-4" />
                  在 LINE 開啟
                </Button>
              </div>
            </Card>
          );
        })}

        <Button variant="secondary" className="w-full" onClick={copyAll}>
          {copied === '__all__' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          全部複製（適合貼到群組）
        </Button>
      </div>
    </div>
  );
}
