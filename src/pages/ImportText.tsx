import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useStore } from '@/lib/store';
import { parseAutoText, friendlyAnthropicError } from '@/lib/anthropic';
import { findColleagueByAlias } from '@/lib/matching';
import { nowIso } from '@/lib/format';

type ImportType = 'ubereats' | 'payment' | 'auto';

export default function ImportText() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const apiKey = useStore((s) => s.settings.apiKey);
  const model = useStore((s) => s.settings.model);
  const colleagues = useStore((s) => s.colleagues);
  const addColleague = useStore((s) => s.addColleague);
  const addOrder = useStore((s) => s.addOrder);
  const addAlias = useStore((s) => s.addAlias);
  const addPayment = useStore((s) => s.addPayment);
  const bumpTokens = useStore((s) => s.bumpTokens);

  const initialText = params.get('text') ?? '';
  const requestedType = (params.get('type') as ImportType | null) ?? 'auto';

  const [text, setText] = useState(initialText);
  const [hint, setHint] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoStart, setAutoStart] = useState(Boolean(initialText));

  useEffect(() => {
    if (autoStart && text && apiKey) {
      setAutoStart(false);
      handleParse();
    }
  }, [autoStart, text, apiKey]);

  async function handleParse() {
    if (!apiKey) {
      setError('尚未設定 Anthropic API key');
      return;
    }
    if (!text.trim()) return;
    setError(null);
    setLoading(true);
    setHint('AI 解析中…');
    try {
      const { data, usage } = await parseAutoText(apiKey, text, model);
      bumpTokens((usage.input_tokens ?? 0) + (usage.output_tokens ?? 0));

      const inferredType: ImportType =
        requestedType !== 'auto' ? requestedType : (data.type === 'unknown' ? 'auto' : data.type);

      if (inferredType === 'ubereats' && data.ubereats?.items?.length) {
        const items = data.ubereats.items.map((it) => {
          const matched = findColleagueByAlias(colleagues, it.name);
          let colleagueId = matched?.id;
          if (!colleagueId) {
            const c = addColleague(it.name);
            colleagueId = c.id;
          } else {
            const norm = it.name.trim().toLowerCase();
            if (
              matched &&
              matched.name.toLowerCase() !== norm &&
              !matched.aliases.some((a) => a.toLowerCase() === norm)
            ) {
              addAlias(matched.id, it.name);
            }
          }
          return { colleagueId, drinkName: it.drink, price: Math.round(it.price) };
        });
        const order = addOrder({
          shopName: data.ubereats.shopName || '（未指定店家）',
          items,
          source: 'manual',
          note: '從文字匯入',
        });
        navigate(`/orders/${order.id}`, { replace: true });
        return;
      }

      if (inferredType === 'payment' && data.payment) {
        const matched = findColleagueByAlias(colleagues, data.payment.payerName ?? '');
        addPayment({
          source: 'shortcut',
          rawText: text,
          method:
            data.payment.method === 'unknown' ? 'transfer' : data.payment.method,
          amount: data.payment.amount,
          payerNameRaw: data.payment.payerName ?? '',
          receivedAt: data.payment.receivedAt ?? nowIso(),
          matchedItemIds: [],
          status: 'pending_review',
          notes: data.notes,
        });
        setHint(
          matched
            ? `已建立付款待確認紀錄，請到付款記錄頁確認與 ${matched.name} 的配對`
            : 'AI 無法判斷付款人，請到付款記錄頁手動處理',
        );
        setTimeout(() => navigate('/payments', { replace: true }), 800);
        return;
      }

      setError(`AI 無法判斷類型（${data.type}），請改用截圖匯入或手動建立`);
      setHint('');
    } catch (err) {
      setError(friendlyAnthropicError(err));
      setHint('');
    } finally {
      setLoading(false);
    }
  }

  const titleMap: Record<ImportType, string> = {
    auto: '從文字匯入',
    ubereats: '從文字匯入 · UberEats',
    payment: '從文字匯入 · 付款通知',
  };

  return (
    <div>
      <PageHeader title={titleMap[requestedType]} back />
      <div className="space-y-3 p-4">
        {error && <Card className="border-destructive/40 bg-destructive/10 p-3 text-sm">{error}</Card>}
        {hint && !error && (
          <Card className="bg-blue-500/10 border-blue-500/30 p-3 text-sm">{hint}</Card>
        )}

        <div className="space-y-2">
          <Label htmlFor="text">貼上文字內容</Label>
          <Textarea
            id="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={10}
            placeholder="貼上 UberEats 訂單明細或 LINE Pay / 銀行通知內容"
          />
        </div>

        <Button className="w-full" size="lg" onClick={handleParse} disabled={loading || !text.trim()}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {loading ? '解析中' : 'AI 解析'}
        </Button>

        <Card className="bg-muted p-3 text-xs text-muted-foreground">
          提示：搭配 iOS 捷徑可從任何 App 通知一鍵帶入。詳見
          <span className="underline mx-1 cursor-pointer" onClick={() => navigate('/settings/shortcut')}>
            設定 → iOS 捷徑教學
          </span>
        </Card>
      </div>
    </div>
  );
}
