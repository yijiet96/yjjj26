import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Link2, Loader2, Plus, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useStore } from '@/lib/store';
import { ntd } from '@/lib/format';
import { findColleagueByAlias } from '@/lib/matching';

type Step = 'input' | 'review';

interface ReviewRow {
  rawName: string;
  drinkName: string;
  price: string;
  colleagueId: string;
  newColleagueName: string;
}

export default function ImportGroupOrder() {
  const navigate = useNavigate();
  const colleagues = useStore((s) => s.colleagues);
  const shops = useStore((s) => s.shops);
  const addColleague = useStore((s) => s.addColleague);
  const addAlias = useStore((s) => s.addAlias);
  const addOrder = useStore((s) => s.addOrder);

  const [step, setStep] = useState<Step>('input');
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [shopName, setShopName] = useState('');
  const [rows, setRows] = useState<ReviewRow[]>([]);

  async function handleFetch() {
    if (!url.trim()) return;
    setError(null);
    setHint(null);
    setLoading(true);

    try {
      const res = await fetch(`/api/group-order?url=${encodeURIComponent(url.trim())}&debug=1`);
      const rawText = await res.text();

      let data: any;
      try {
        data = JSON.parse(rawText);
      } catch {
        setError(`Server error (${res.status}): ${rawText.substring(0, 300)}`);
        return;
      }

      if (!res.ok || data.error) {
        setError(data.error || data.hint || 'Failed to fetch group order');
        return;
      }

      if (data.success && data.items?.length) {
        const reviewRows: ReviewRow[] = data.items.map((it: any) => {
          const matched = findColleagueByAlias(colleagues, it.name);
          return {
            rawName: it.name,
            drinkName: it.drink,
            price: String(it.price),
            colleagueId: matched?.id ?? '',
            newColleagueName: matched ? '' : it.name,
          };
        });
        setShopName(data.shopName || '');
        setRows(reviewRows);
        setStep('review');
        return;
      }

      if (data.fallback) {
        const debugInfo = data.debug ? JSON.stringify(data.debug) : '';
        const pageTextSnippet = data.pageText ? `\n\nPageText (first 500):\n${data.pageText.substring(0, 500)}` : '';
        setError(`自動解析失敗。Debug: ${debugInfo}${pageTextSnippet}`);
        if (data.screenshot) {
          setHint(data.screenshot);
        }
        return;
      }

      setError('無法取得訂單資料');
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  function updateRow(i: number, patch: Partial<ReviewRow>) {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  function removeRow(i: number) {
    setRows((rs) => rs.filter((_, idx) => idx !== i));
  }

  function addRow() {
    setRows((rs) => [
      ...rs,
      { rawName: '', drinkName: '', price: '', colleagueId: '', newColleagueName: '' },
    ]);
  }

  const canSubmit =
    shopName.trim().length > 0 &&
    rows.length > 0 &&
    rows.every((r) => {
      const hasPerson = r.colleagueId || r.newColleagueName.trim();
      return hasPerson && r.drinkName.trim() && Number(r.price) > 0;
    });

  function handleCreate() {
    const items = rows.map((r) => {
      let colleagueId = r.colleagueId;
      if (!colleagueId && r.newColleagueName.trim()) {
        const c = addColleague(r.newColleagueName.trim());
        colleagueId = c.id;
        if (r.rawName && r.rawName !== r.newColleagueName.trim()) {
          addAlias(c.id, r.rawName);
        }
      } else if (colleagueId && r.rawName) {
        const existing = colleagues.find((c) => c.id === colleagueId);
        const norm = r.rawName.trim().toLowerCase();
        if (
          existing &&
          existing.name.toLowerCase() !== norm &&
          !existing.aliases.some((a) => a.toLowerCase() === norm)
        ) {
          addAlias(colleagueId, r.rawName.trim());
        }
      }
      return {
        colleagueId,
        drinkName: r.drinkName.trim(),
        price: Math.round(Number(r.price)),
      };
    });
    const order = addOrder({
      shopName: shopName.trim(),
      items,
      source: 'manual',
      note: '從 UberEats 團購網址匯入',
    });
    navigate(`/orders/${order.id}`, { replace: true });
  }

  return (
    <div>
      <PageHeader title="UberEats 團購網址匯入" back />
      <div className="space-y-4 p-4">
        {error && (
          <Card className="border-destructive/40 bg-destructive/10 p-3 text-sm">{error}</Card>
        )}
        {hint && (
          hint.startsWith('data:image') ? (
            <Card className="p-2">
              <div className="text-xs text-muted-foreground mb-1">Puppeteer 截圖（debug）</div>
              <img src={hint} alt="debug screenshot" className="w-full rounded" />
            </Card>
          ) : (
            <Card className="bg-blue-500/10 border-blue-500/30 p-3 text-sm">{hint}</Card>
          )
        )}

        {step === 'input' && (
          <>
            <Card className="bg-muted p-3 text-xs text-muted-foreground space-y-1">
              <div className="font-medium text-foreground">使用方式</div>
              <div>貼上 UberEats 團購分享連結，系統自動以「DrinkRun」身份加入並讀取所有訂單</div>
            </Card>

            <div className="space-y-2">
              <Label htmlFor="url">團購連結</Label>
              <Input
                id="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://eats.uber.com/group-orders/..."
                type="url"
                inputMode="url"
              />
            </div>

            <Button
              className="w-full"
              size="lg"
              onClick={handleFetch}
              disabled={loading || !url.trim()}
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
              {loading ? '讀取中（約 10–20 秒）…' : '讀取訂單'}
            </Button>
          </>
        )}

        {step === 'review' && (
          <>
            <div className="space-y-2">
              <Label htmlFor="shop">店家名稱</Label>
              <Input
                id="shop"
                value={shopName}
                onChange={(e) => setShopName(e.target.value)}
                list="shop-options"
                placeholder="例：50 嵐"
              />
              <datalist id="shop-options">
                {shops.map((s) => (
                  <option key={s.id} value={s.name} />
                ))}
              </datalist>
            </div>

            <div className="space-y-2">
              <Label>解析結果（請確認）</Label>
              {rows.map((row, i) => {
                const matched = colleagues.find((c) => c.id === row.colleagueId);
                const isNewName = !matched && row.rawName;
                return (
                  <Card key={i} className="p-3 space-y-2">
                    <div className="flex items-start gap-2">
                      <div className="flex-1 space-y-2">
                        <div className="text-xs text-muted-foreground">
                          名字：<span className="font-mono">{row.rawName || '—'}</span>
                          {matched && (
                            <span className="ml-2 text-emerald-600">✓ 對應「{matched.name}」</span>
                          )}
                          {isNewName && <span className="ml-2 text-amber-600">⚠ 新名字</span>}
                        </div>
                        <select
                          value={row.colleagueId || (row.newColleagueName ? '__new__' : '')}
                          onChange={(e) => {
                            if (e.target.value === '__new__') {
                              updateRow(i, { colleagueId: '', newColleagueName: row.rawName });
                            } else {
                              updateRow(i, { colleagueId: e.target.value, newColleagueName: '' });
                            }
                          }}
                          className="flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                        >
                          <option value="">-- 選擇同事 --</option>
                          {colleagues.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                          <option value="__new__">＋ 建立新同事</option>
                        </select>
                        {!row.colleagueId && (row.newColleagueName || isNewName) && (
                          <Input
                            value={row.newColleagueName}
                            onChange={(e) => updateRow(i, { newColleagueName: e.target.value })}
                            placeholder="新同事的稱呼"
                            className="h-9"
                          />
                        )}
                        <Input
                          value={row.drinkName}
                          onChange={(e) => updateRow(i, { drinkName: e.target.value })}
                          placeholder="飲料"
                          className="h-9"
                        />
                        <Input
                          type="number"
                          inputMode="numeric"
                          value={row.price}
                          onChange={(e) => updateRow(i, { price: e.target.value })}
                          placeholder="金額"
                          className="h-9"
                        />
                      </div>
                      <Button size="icon" variant="ghost" onClick={() => removeRow(i)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </Card>
                );
              })}
              <Button variant="outline" className="w-full" onClick={addRow}>
                <Plus className="h-4 w-4" />
                新增一項
              </Button>
            </div>

            <Card className="p-3 flex items-center justify-between">
              <div className="text-sm text-muted-foreground">總金額</div>
              <div className="font-semibold tabular-nums">
                {ntd(rows.reduce((a, b) => a + (Number(b.price) || 0), 0))}
              </div>
            </Card>

            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" onClick={() => setStep('input')}>
                重新輸入
              </Button>
              <Button onClick={handleCreate} disabled={!canSubmit}>
                建立訂單
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
