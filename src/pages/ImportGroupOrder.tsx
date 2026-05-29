import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Link2, Loader2, Plus, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useStore } from '@/lib/store';
import { ntd } from '@/lib/format';
import { findColleagueByAlias } from '@/lib/matching';

type Step = 'input' | 'mapping' | 'review';

interface ReviewRow {
  rawName: string;
  drinkName: string;
  price: string;
  colleagueId: string;
  newColleagueName: string;
}

interface NameMapping {
  rawId: string;
  hint: string; // all drinks for this uuid, used as identification hint
  colleagueId: string;
  newColleagueName: string;
}

export default function ImportGroupOrder() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const colleagues = useStore((s) => s.colleagues);
  const shops = useStore((s) => s.shops);
  const addColleague = useStore((s) => s.addColleague);
  const addAlias = useStore((s) => s.addAlias);
  const addOrder = useStore((s) => s.addOrder);

  const [step, setStep] = useState<Step>('input');
  const [url, setUrl] = useState(() => searchParams.get('url') ?? '');

  useEffect(() => {
    if (url) return;
    const tryClipboard = async () => {
      try {
        const text = await navigator.clipboard.readText();
        if (text && (text.includes('ubereats.com') || text.includes('eats.uber.com'))) {
          setUrl(text.trim());
        }
      } catch { /* permission denied or not supported */ }
    };
    const t = setTimeout(tryClipboard, 400);
    return () => clearTimeout(t);
  }, []);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [shopName, setShopName] = useState('');
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [mappings, setMappings] = useState<NameMapping[]>([]);

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
          const isUnknown = String(it.name).startsWith('?');
          const matched = isUnknown ? null : findColleagueByAlias(colleagues, it.name);
          return {
            rawName: it.name,
            drinkName: it.drink,
            price: String(it.price),
            colleagueId: matched?.id ?? '',
            newColleagueName: matched ? '' : (isUnknown ? '' : it.name),
          };
        });
        setShopName(data.shopName || '');
        setRows(reviewRows);

        // Collect unique ?uuid IDs that need mapping
        const unknownIds = [...new Set(
          reviewRows.filter((r) => r.rawName.startsWith('?')).map((r) => r.rawName)
        )];

        if (unknownIds.length > 0) {
          // Build hint: all drink names for each uuid
          const idMappings: NameMapping[] = unknownIds.map((id) => {
            const drinks = reviewRows
              .filter((r) => r.rawName === id)
              .map((r) => `${r.drinkName} $${r.price}`)
              .join('、');
            const matched = findColleagueByAlias(colleagues, id);
            return {
              rawId: id,
              hint: drinks,
              colleagueId: matched?.id ?? '',
              newColleagueName: '',
            };
          });
          setMappings(idMappings);
          setStep('mapping');
        } else {
          setStep('review');
        }
        return;
      }

      if (data.fallback) {
        const debugInfo = data.debug ? JSON.stringify(data.debug) : '';
        const pageTextSnippet = data.pageText ? `\n\nPageText (first 500):\n${data.pageText.substring(0, 500)}` : '';
        setError(`自動解析失敗。Debug: ${debugInfo}${pageTextSnippet}`);
        if (data.screenshot) setHint(data.screenshot);
        return;
      }

      setError('無法取得訂單資料');
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  function updateMapping(i: number, patch: Partial<NameMapping>) {
    setMappings((ms) => ms.map((m, idx) => (idx === i ? { ...m, ...patch } : m)));
  }

  function applyMappings() {
    const idToMap: Record<string, Pick<NameMapping, 'colleagueId' | 'newColleagueName'>> = {};
    for (const m of mappings) {
      idToMap[m.rawId] = { colleagueId: m.colleagueId, newColleagueName: m.newColleagueName };
    }
    setRows((rs) =>
      rs.map((r) => {
        if (!r.rawName.startsWith('?')) return r;
        const m = idToMap[r.rawName];
        if (!m) return r;
        return { ...r, colleagueId: m.colleagueId, newColleagueName: m.newColleagueName };
      })
    );
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
        if (r.rawName && !r.rawName.startsWith('?') && r.rawName !== r.newColleagueName.trim()) {
          addAlias(c.id, r.rawName);
        }
      } else if (colleagueId && r.rawName && !r.rawName.startsWith('?')) {
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

        {/* ── Step 1: URL input ── */}
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

        {/* ── Step 2: Batch name mapping ── */}
        {step === 'mapping' && (
          <>
            <Card className="bg-amber-500/10 border-amber-500/30 p-3 text-sm space-y-1">
              <div className="font-medium">對應點餐者（共 {mappings.length} 位）</div>
              <div className="text-xs text-muted-foreground">系統無法自動取得部分點餐者姓名，請依飲料對應同事後繼續</div>
            </Card>

            <div className="space-y-2">
              {mappings.map((m, i) => (
                <Card key={m.rawId} className="p-3 space-y-1.5">
                  <div className="text-sm font-medium truncate">{m.hint || m.rawId}</div>
                  <select
                    value={m.colleagueId || (m.newColleagueName ? '__new__' : '')}
                    onChange={(e) => {
                      if (e.target.value === '__new__') {
                        updateMapping(i, { colleagueId: '', newColleagueName: '新同事' });
                      } else {
                        updateMapping(i, { colleagueId: e.target.value, newColleagueName: '' });
                      }
                    }}
                    className="flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                  >
                    <option value="">-- 選擇同事 --</option>
                    {colleagues.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                    <option value="__new__">＋ 建立新同事</option>
                  </select>
                  {!m.colleagueId && m.newColleagueName && (
                    <Input
                      value={m.newColleagueName}
                      onChange={(e) => updateMapping(i, { newColleagueName: e.target.value })}
                      placeholder="新同事的稱呼"
                      className="h-9"
                    />
                  )}
                </Card>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" onClick={() => setStep('review')}>
                略過，直接確認
              </Button>
              <Button onClick={applyMappings}>
                套用 →
              </Button>
            </div>
          </>
        )}

        {/* ── Step 3: Review ── */}
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
                const isUnknown = row.rawName.startsWith('?');
                const isNewName = !matched && !isUnknown && row.rawName;
                return (
                  <Card key={i} className="p-3 space-y-2">
                    <div className="flex items-start gap-2">
                      <div className="flex-1 space-y-2">
                        <div className="text-xs text-muted-foreground">
                          {isUnknown
                            ? <span className="text-amber-600">未對應</span>
                            : <span>名字：<span className="font-mono">{row.rawName || '—'}</span></span>
                          }
                          {matched && (
                            <span className="ml-2 text-emerald-600">✓ 對應「{matched.name}」</span>
                          )}
                          {isNewName && <span className="ml-2 text-amber-600">⚠ 新名字</span>}
                        </div>
                        <select
                          value={row.colleagueId || (row.newColleagueName ? '__new__' : '')}
                          onChange={(e) => {
                            if (e.target.value === '__new__') {
                              updateRow(i, { colleagueId: '', newColleagueName: row.rawName.startsWith('?') ? '' : row.rawName });
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
              <Button variant="outline" onClick={() => setStep(mappings.length > 0 ? 'mapping' : 'input')}>
                {mappings.length > 0 ? '回名字對應' : '重新輸入'}
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
