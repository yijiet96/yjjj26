import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Camera, Loader2, CheckCircle2, AlertTriangle, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useStore } from '@/lib/store';
import { parsePaymentImage, friendlyAnthropicError } from '@/lib/anthropic';
import { fileToBase64 } from '@/lib/image';
import { findColleagueByAlias, unpaidItemsFor, matchByAmount } from '@/lib/matching';
import { ntd, fmtDate, nowIso } from '@/lib/format';
import type { PaymentMethod } from '@/types';

interface Candidate {
  id: string;
  imageBase64: string;
  payerNameRaw: string;
  amount: number;
  method: PaymentMethod;
  receivedAt: string;
  matchedColleagueId?: string;
  selectedItems: Array<{ orderId: string; itemId: string; drinkName: string; shopName: string; price: number }>;
  status: 'auto_exact' | 'auto_combo' | 'pending' | 'no_match';
  notes?: string;
}

const methodOptions: { value: PaymentMethod | 'unknown'; label: string }[] = [
  { value: 'linepay', label: 'LINE Pay' },
  { value: 'transfer', label: '銀行轉帳' },
  { value: 'cash', label: '現金' },
  { value: 'unknown', label: '其他' },
];

export default function ImportPayment() {
  const navigate = useNavigate();
  const apiKey = useStore((s) => s.settings.apiKey);
  const model = useStore((s) => s.settings.model);
  const colleagues = useStore((s) => s.colleagues);
  const orders = useStore((s) => s.orders);
  const setItemsPaid = useStore((s) => s.setItemsPaid);
  const addPayment = useStore((s) => s.addPayment);
  const addAlias = useStore((s) => s.addAlias);
  const bumpTokens = useStore((s) => s.bumpTokens);

  const fileInput = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    if (!apiKey) {
      setError('尚未設定 Anthropic API key');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const newCandidates: Candidate[] = [];
      for (const file of Array.from(files)) {
        const base64 = await fileToBase64(file);
        const { data, usage } = await parsePaymentImage(apiKey, base64, model);
        bumpTokens((usage.input_tokens ?? 0) + (usage.output_tokens ?? 0));
        const matched = findColleagueByAlias(colleagues, data.payerName ?? '');
        const items = matched ? unpaidItemsFor(orders, matched.id) : [];
        let selected: Candidate['selectedItems'] = [];
        let status: Candidate['status'] = 'no_match';
        if (matched) {
          const m = matchByAmount(items, data.amount);
          if (m.type !== 'none') {
            selected = m.matched.map((i) => ({
              orderId: i.orderId,
              itemId: i.itemId,
              drinkName: i.drinkName,
              shopName: i.shopName,
              price: i.price,
            }));
            status = m.type === 'exact' ? 'auto_exact' : 'auto_combo';
          } else {
            status = 'pending';
          }
        }
        newCandidates.push({
          id: crypto.randomUUID(),
          imageBase64: base64,
          payerNameRaw: data.payerName ?? '',
          amount: data.amount,
          method: data.method === 'unknown' ? 'transfer' : data.method,
          receivedAt: data.receivedAt ?? nowIso(),
          matchedColleagueId: matched?.id,
          selectedItems: selected,
          status,
          notes: data.notes,
        });
      }
      setCandidates((prev) => [...newCandidates, ...prev]);
    } catch (err) {
      setError(friendlyAnthropicError(err));
    } finally {
      setLoading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  function updateCandidate(id: string, patch: Partial<Candidate>) {
    setCandidates((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }

  function toggleItem(
    candidateId: string,
    item: { orderId: string; itemId: string; drinkName: string; shopName: string; price: number },
  ) {
    setCandidates((cs) =>
      cs.map((c) => {
        if (c.id !== candidateId) return c;
        const exists = c.selectedItems.find((s) => s.itemId === item.itemId);
        return {
          ...c,
          selectedItems: exists
            ? c.selectedItems.filter((s) => s.itemId !== item.itemId)
            : [...c.selectedItems, item],
        };
      }),
    );
  }

  function confirm(cand: Candidate) {
    setItemsPaid(
      cand.selectedItems.map((s) => ({ orderId: s.orderId, itemId: s.itemId })),
      cand.method,
    );
    if (cand.matchedColleagueId && cand.payerNameRaw) {
      const colleague = colleagues.find((c) => c.id === cand.matchedColleagueId);
      if (colleague) {
        const norm = cand.payerNameRaw.trim().toLowerCase();
        const known =
          colleague.name.toLowerCase() === norm ||
          colleague.aliases.some((a) => a.toLowerCase() === norm);
        if (!known) addAlias(colleague.id, cand.payerNameRaw.trim());
      }
    }
    addPayment({
      source: 'screenshot',
      rawImageBase64: cand.imageBase64,
      method: cand.method,
      amount: cand.amount,
      payerNameRaw: cand.payerNameRaw,
      receivedAt: cand.receivedAt,
      matchedItemIds: cand.selectedItems.map((s) => s.itemId),
      status: 'confirmed',
      notes: cand.notes,
    });
    setCandidates((cs) => cs.filter((c) => c.id !== cand.id));
  }

  function reject(cand: Candidate) {
    addPayment({
      source: 'screenshot',
      rawImageBase64: cand.imageBase64,
      method: cand.method,
      amount: cand.amount,
      payerNameRaw: cand.payerNameRaw,
      receivedAt: cand.receivedAt,
      matchedItemIds: [],
      status: 'rejected',
      notes: cand.notes,
    });
    setCandidates((cs) => cs.filter((c) => c.id !== cand.id));
  }

  return (
    <div>
      <PageHeader title="付款通知匯入" back />
      <div className="space-y-3 p-4">
        {error && <Card className="border-destructive/40 bg-destructive/10 p-3 text-sm">{error}</Card>}

        <Card
          className="p-6 border-dashed flex flex-col items-center justify-center text-center cursor-pointer hover:bg-accent transition-colors"
          onClick={() => fileInput.current?.click()}
        >
          {loading ? (
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          ) : (
            <Camera className="h-8 w-8 text-muted-foreground mb-2" />
          )}
          <div className="font-medium mt-1">{loading ? '解析中…' : '選擇付款通知截圖'}</div>
          <div className="text-xs text-muted-foreground mt-1">可一次選多張</div>
        </Card>
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />

        {candidates.map((cand) => {
          const colleague = colleagues.find((c) => c.id === cand.matchedColleagueId);
          const unpaid = colleague ? unpaidItemsFor(orders, colleague.id) : [];
          return (
            <Card key={cand.id} className="p-3 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{cand.payerNameRaw || '（無名字）'}</span>
                    {cand.status === 'auto_exact' && (
                      <Badge variant="success" className="gap-1">
                        <CheckCircle2 className="h-3 w-3" /> 自動配對
                      </Badge>
                    )}
                    {cand.status === 'auto_combo' && (
                      <Badge variant="success">組合配對</Badge>
                    )}
                    {cand.status === 'pending' && (
                      <Badge variant="warning" className="gap-1">
                        <AlertTriangle className="h-3 w-3" /> 金額不符
                      </Badge>
                    )}
                    {cand.status === 'no_match' && <Badge variant="outline">找不到對應</Badge>}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {fmtDate(cand.receivedAt)} · {ntd(cand.amount)}
                  </div>
                </div>
                <Button size="icon" variant="ghost" onClick={() => reject(cand)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <select
                  value={cand.matchedColleagueId ?? ''}
                  onChange={(e) =>
                    updateCandidate(cand.id, {
                      matchedColleagueId: e.target.value || undefined,
                      selectedItems: [],
                      status: e.target.value ? 'pending' : 'no_match',
                    })
                  }
                  className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                >
                  <option value="">-- 選同事 --</option>
                  {colleagues.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                <select
                  value={cand.method}
                  onChange={(e) =>
                    updateCandidate(cand.id, { method: e.target.value as PaymentMethod })
                  }
                  className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                >
                  {methodOptions.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>

              {colleague && unpaid.length > 0 && (
                <div className="space-y-1.5">
                  <div className="text-xs text-muted-foreground">勾選實際付款的品項</div>
                  {unpaid.map((it) => {
                    const checked = cand.selectedItems.some((s) => s.itemId === it.itemId);
                    return (
                      <label
                        key={it.itemId}
                        className="flex items-center gap-2 rounded-md border p-2 text-sm cursor-pointer hover:bg-accent"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            toggleItem(cand.id, {
                              orderId: it.orderId,
                              itemId: it.itemId,
                              drinkName: it.drinkName,
                              shopName: it.shopName,
                              price: it.price,
                            })
                          }
                        />
                        <div className="flex-1 min-w-0">
                          <div className="truncate">{it.drinkName}</div>
                          <div className="text-xs text-muted-foreground">{it.shopName}</div>
                        </div>
                        <div className="tabular-nums">{ntd(it.price)}</div>
                      </label>
                    );
                  })}
                </div>
              )}

              {colleague && unpaid.length === 0 && (
                <div className="rounded-md bg-muted p-2 text-xs text-muted-foreground">
                  {colleague.name} 目前沒有未付款項目
                </div>
              )}

              <div className="flex items-center justify-between rounded-md bg-muted px-3 py-2 text-sm">
                <span>已選 {cand.selectedItems.length} 項</span>
                <span className="tabular-nums">
                  {ntd(cand.selectedItems.reduce((a, b) => a + b.price, 0))} / {ntd(cand.amount)}
                </span>
              </div>

              {cand.notes && (
                <div className="text-xs text-amber-600 dark:text-amber-400">AI 備註：{cand.notes}</div>
              )}

              <Button
                className="w-full"
                disabled={cand.selectedItems.length === 0}
                onClick={() => confirm(cand)}
              >
                確認並標記已付
              </Button>
            </Card>
          );
        })}

        {candidates.length === 0 && !loading && (
          <Card className="p-4 text-center text-sm text-muted-foreground">
            匯入後可在這裡確認 AI 解析的付款配對結果
          </Card>
        )}

        <Button variant="outline" className="w-full" onClick={() => navigate('/payments')}>
          查看所有付款記錄
        </Button>
      </div>
    </div>
  );
}
