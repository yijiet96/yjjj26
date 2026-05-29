import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Clipboard, Plus, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useStore } from '@/lib/store';
import { ntd } from '@/lib/format';
import { findColleagueByAlias } from '@/lib/matching';
import {
  parseUberEatsReceiptText,
  parseKaitugoText, isKaitugoFormat,
  parseKaitugoGroupText, isKaitugoGroupFormat,
} from '@/lib/ubereats-parser';

type Step = 'paste' | 'review';

interface ReviewRow {
  rawName: string;
  drinkName: string;
  price: string;
  colleagueId: string;
  newColleagueName: string;
}

function isoToDatetimeLocal(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function datetimeLocalToIso(val: string): string {
  return new Date(val).toISOString();
}

export default function ImportUberEatsText() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const colleagues = useStore((s) => s.colleagues);
  const shops = useStore((s) => s.shops);
  const addColleague = useStore((s) => s.addColleague);
  const addAlias = useStore((s) => s.addAlias);
  const addOrder = useStore((s) => s.addOrder);

  const [step, setStep] = useState<Step>('paste');
  const [text, setText] = useState(() => searchParams.get('text') ?? '');
  const [error, setError] = useState<string | null>(null);
  const [shopName, setShopName] = useState('');
  const [orderDate, setOrderDate] = useState(() => isoToDatetimeLocal(new Date().toISOString()));
  const [rows, setRows] = useState<ReviewRow[]>([]);

  async function handlePaste() {
    try {
      const clip = await navigator.clipboard.readText();
      setText(clip);
    } catch {
      // fallback: user pastes manually
    }
  }

  function handleParse() {
    setError(null);
    const result = isKaitugoGroupFormat(text)
      ? parseKaitugoGroupText(text)
      : isKaitugoFormat(text)
        ? parseKaitugoText(text)
        : parseUberEatsReceiptText(text);
    if (!result) {
      setError('無法辨識格式。請確認貼上的是 UberEats 電子明細或開圖購訂單明細');
      return;
    }
    if (result.shopName) setShopName(result.shopName);
    if (result.date) setOrderDate(isoToDatetimeLocal(result.date));
    const reviewRows: ReviewRow[] = result.items.map((it) => {
      const matched = findColleagueByAlias(colleagues, it.name);
      return {
        rawName: it.name,
        drinkName: it.drink,
        price: String(it.price),
        colleagueId: matched?.id ?? '',
        newColleagueName: matched ? '' : it.name,
      };
    });
    setRows(reviewRows);
    setStep('review');
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
      note: '從文字明細匯入',
      createdAt: datetimeLocalToIso(orderDate),
    });
    navigate(`/orders/${order.id}`, { replace: true });
  }

  return (
    <div>
      <PageHeader title="文字明細貼上" back />
      <div className="space-y-4 p-4">
        {error && (
          <Card className="border-destructive/40 bg-destructive/10 p-3 text-sm">{error}</Card>
        )}

        {step === 'paste' && (
          <>
            <Card className="bg-muted p-3 text-xs text-muted-foreground space-y-1">
              <div className="font-medium text-foreground">支援格式</div>
              <div>• <b>UberEats 電子明細</b>：訂單 → 訂單詳情 → 長按全選複製</div>
              <div>• <b>開圖購（個人下單）</b>：含 account_circle 訂購人姓名 的明細</div>
              <div>• <b>開圖購（各自加入）</b>：含 ＋收款 區塊分隔的明細</div>
              <div className="mt-1">自動偵測格式，無需選擇</div>
            </Card>

            <div className="space-y-2">
              <Label htmlFor="receipt">貼上電子明細</Label>
              <Textarea
                id="receipt"
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={12}
                placeholder={`貼上 UberEats 電子明細 或 開圖購訂單明細…\n\n【開圖購格式範例】\n春青菊花\nL / 無糖 / 少冰 / $55 / 1份\naccount_circle 訂購人姓名：怡潔`}
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" onClick={handlePaste}>
                <Clipboard className="h-4 w-4" />
                從剪貼簿貼上
              </Button>
              <Button onClick={handleParse} disabled={!text.trim()}>
                解析明細
              </Button>
            </div>
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
                placeholder="例：大茗本位製茶堂"
              />
              <datalist id="shop-options">
                {shops.map((s) => (
                  <option key={s.id} value={s.name} />
                ))}
              </datalist>
            </div>

            <div className="space-y-2">
              <Label htmlFor="order-date">訂單日期</Label>
              <Input
                id="order-date"
                type="datetime-local"
                value={orderDate}
                onChange={(e) => setOrderDate(e.target.value)}
              />
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
              <Button variant="outline" onClick={() => { setStep('paste'); setText(''); }}>
                重新貼上
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
