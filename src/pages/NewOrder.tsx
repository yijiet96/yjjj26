import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useStore } from '@/lib/store';

interface Row {
  colleagueId: string;
  newName: string;
  drinkName: string;
  price: string;
}

function emptyRow(): Row {
  return { colleagueId: '', newName: '', drinkName: '', price: '' };
}

export default function NewOrder() {
  const navigate = useNavigate();
  const shops = useStore((s) => s.shops);
  const colleagues = useStore((s) => s.colleagues);
  const addColleague = useStore((s) => s.addColleague);
  const addOrder = useStore((s) => s.addOrder);

  const [shopName, setShopName] = useState('');
  const [note, setNote] = useState('');
  const [rows, setRows] = useState<Row[]>([emptyRow()]);

  const shopOptions = useMemo(() => shops.map((s) => s.name), [shops]);

  const updateRow = (i: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const addRow = () => setRows((rs) => [...rs, emptyRow()]);
  const removeRow = (i: number) => setRows((rs) => rs.filter((_, idx) => idx !== i));

  const canSubmit =
    shopName.trim().length > 0 &&
    rows.every((r) => {
      const hasPerson = r.colleagueId || r.newName.trim();
      return hasPerson && r.drinkName.trim() && Number(r.price) > 0;
    });

  function handleSubmit() {
    const items = rows.map((r) => {
      let colleagueId = r.colleagueId;
      if (!colleagueId && r.newName.trim()) {
        const c = addColleague(r.newName.trim());
        colleagueId = c.id;
      }
      return {
        colleagueId,
        drinkName: r.drinkName.trim(),
        price: Math.round(Number(r.price)),
      };
    });
    const order = addOrder({ shopName: shopName.trim(), items, note: note.trim() || undefined });
    navigate(`/orders/${order.id}`, { replace: true });
  }

  return (
    <div>
      <PageHeader title="手動建立訂單" back />
      <div className="space-y-4 p-4">
        <div className="space-y-2">
          <Label htmlFor="shop">店家</Label>
          <Input
            id="shop"
            list="shop-options"
            value={shopName}
            onChange={(e) => setShopName(e.target.value)}
            placeholder="例：50 嵐 公館店"
            autoComplete="off"
          />
          <datalist id="shop-options">
            {shopOptions.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
        </div>

        <div className="space-y-2">
          <Label>品項</Label>
          {rows.map((row, i) => (
            <Card key={i} className="p-3 space-y-2">
              <div className="flex items-center gap-2">
                <select
                  value={row.colleagueId}
                  onChange={(e) => updateRow(i, { colleagueId: e.target.value, newName: '' })}
                  className="flex h-10 flex-1 rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">-- 選擇同事 --</option>
                  {colleagues.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                  <option value="__new__">＋ 新增同事</option>
                </select>
                {rows.length > 1 && (
                  <Button size="icon" variant="ghost" onClick={() => removeRow(i)} aria-label="刪除">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
              {row.colleagueId === '__new__' && (
                <Input
                  value={row.newName}
                  onChange={(e) => updateRow(i, { newName: e.target.value })}
                  placeholder="新同事的名字"
                />
              )}
              <Input
                value={row.drinkName}
                onChange={(e) => updateRow(i, { drinkName: e.target.value })}
                placeholder="飲料（例：珍奶 微糖 少冰）"
              />
              <Input
                type="number"
                inputMode="numeric"
                value={row.price}
                onChange={(e) => updateRow(i, { price: e.target.value })}
                placeholder="金額"
              />
            </Card>
          ))}
          <Button variant="outline" className="w-full" onClick={addRow}>
            <Plus className="h-4 w-4" />
            新增一項
          </Button>
        </div>

        <div className="space-y-2">
          <Label htmlFor="note">備註（可選）</Label>
          <Textarea id="note" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>

        <Button className="w-full" size="lg" disabled={!canSubmit} onClick={handleSubmit}>
          建立訂單
        </Button>
      </div>
    </div>
  );
}
