import { useEffect, useRef } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Camera, Banknote, AlertCircle, FileText, Link2, ClipboardPaste } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { Card } from '@/components/ui/card';
import { useStore } from '@/lib/store';
import { isKaitugoFormat, isKaitugoGroupFormat } from '@/lib/ubereats-parser';

const UBEREATS_RE = /https?:\/\/eats\.uber\.com\/[^\s"']+/i;

export default function Import() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const hasApiKey = useStore((s) => Boolean(s.settings.apiKey));
  const pasteRef = useRef<HTMLInputElement>(null);

  function handlePasteInput(text: string) {
    const t = text.trim();
    if (!t) return;
    const m = t.match(UBEREATS_RE);
    if (m) {
      navigate(`/import/group-order?url=${encodeURIComponent(m[0])}`);
    } else if (isKaitugoGroupFormat(t) || isKaitugoFormat(t)) {
      navigate(`/import/ubereats-text?text=${encodeURIComponent(t)}`);
    } else {
      const q = new URLSearchParams({ text: t, type: 'auto' });
      navigate(`/import/text?${q.toString()}`);
    }
  }

  useEffect(() => {
    const sharedUrl = params.get('url');
    if (sharedUrl) {
      navigate(`/import/group-order?url=${encodeURIComponent(sharedUrl)}`, { replace: true });
      return;
    }
    const sharedText = params.get('text');
    if (sharedText) {
      const q = new URLSearchParams({ text: sharedText, type: 'auto' });
      navigate(`/import/text?${q.toString()}`, { replace: true });
      return;
    }
    const type = params.get('type');
    if (!type) return;
    if (type === 'ubereats') navigate('/import/ubereats', { replace: true });
    else if (type === 'payment') navigate('/import/payment', { replace: true });
  }, [params, navigate]);

  return (
    <div>
      <PageHeader title="匯入" subtitle="上傳截圖或貼文字，由 AI 自動解析" />
      <div className="space-y-3 p-4">

        {/* Smart paste box */}
        <div
          className="flex items-center gap-3 rounded-xl border-2 border-dashed border-orange-400/60 bg-orange-500/5 p-4 cursor-text"
          onClick={() => pasteRef.current?.focus()}
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-orange-500/15 text-orange-600 flex-shrink-0">
            <ClipboardPaste className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-sm">長按貼上</div>
            <input
              ref={pasteRef}
              type="text"
              inputMode="url"
              className="mt-0.5 w-full bg-transparent text-xs text-muted-foreground outline-none placeholder:text-muted-foreground/60 caret-orange-500"
              placeholder="UberEats 團購連結 / 開圖購明細 / 付款通知文字…"
              onPaste={(e) => {
                e.preventDefault();
                const text = e.clipboardData.getData('text');
                handlePasteInput(text);
              }}
              onChange={(e) => {
                if (e.target.value) handlePasteInput(e.target.value);
              }}
            />
          </div>
        </div>

        {!hasApiKey && (
          <Card className="border-amber-500/40 bg-amber-50 dark:bg-amber-950/30 p-3 flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1 text-sm">
              使用匯入功能前，需先在
              <Link to="/settings" className="underline mx-1">設定</Link>
              填入 Anthropic API key。
            </div>
          </Card>
        )}

        <Link to="/import/group-order">
          <Card className="p-4 flex items-center gap-4 hover:bg-accent transition-colors">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-orange-500/15 text-orange-600">
              <Link2 className="h-6 w-6" />
            </div>
            <div className="flex-1">
              <div className="font-semibold">UberEats 團購網址</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                貼上團購連結，自動讀取所有人訂單（無需截圖）
              </div>
            </div>
          </Card>
        </Link>

        <Link to="/import/ubereats">
          <Card className="p-4 flex items-center gap-4 hover:bg-accent transition-colors">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-600">
              <Camera className="h-6 w-6" />
            </div>
            <div className="flex-1">
              <div className="font-semibold">UberEats 訂單截圖</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                AI 解析品項與金額，自動配對下單者
              </div>
            </div>
          </Card>
        </Link>

        <Link to="/import/ubereats-text">
          <Card className="p-4 flex items-center gap-4 hover:bg-accent transition-colors">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-600">
              <FileText className="h-6 w-6" />
            </div>
            <div className="flex-1">
              <div className="font-semibold">文字明細貼上</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                UberEats 電子明細 或 開圖購訂單明細，免截圖免 AI
              </div>
            </div>
          </Card>
        </Link>

        <Link to="/import/payment">
          <Card className="p-4 flex items-center gap-4 hover:bg-accent transition-colors">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-500/15 text-blue-600">
              <Banknote className="h-6 w-6" />
            </div>
            <div className="flex-1">
              <div className="font-semibold">付款通知截圖</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                LINE Pay / 銀行通知 → 自動配對未付款項
              </div>
            </div>
          </Card>
        </Link>

      </div>
    </div>
  );
}
