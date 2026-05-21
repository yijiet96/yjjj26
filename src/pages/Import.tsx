import { useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Camera, Banknote, Pencil, AlertCircle, Users, FileText, Link2 } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { Card } from '@/components/ui/card';
import { useStore } from '@/lib/store';

export default function Import() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const hasApiKey = useStore((s) => Boolean(s.settings.apiKey));

  useEffect(() => {
    const type = params.get('type');
    const text = params.get('text');
    if (!type) return;
    if (text) {
      const q = new URLSearchParams({ text, type });
      navigate(`/import/text?${q.toString()}`, { replace: true });
      return;
    }
    if (type === 'ubereats') navigate('/import/ubereats', { replace: true });
    else if (type === 'payment') navigate('/import/payment', { replace: true });
  }, [params, navigate]);

  return (
    <div>
      <PageHeader title="匯入" subtitle="上傳截圖或貼文字，由 AI 自動解析" />
      <div className="space-y-3 p-4">
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
              <div className="font-semibold">UberEats 電子明細貼上</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                複製電子明細文字直接貼上，免截圖免 AI
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

        <Link to="/import/text">
          <Card className="p-4 flex items-center gap-4 hover:bg-accent transition-colors">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-purple-500/15 text-purple-600">
              <Pencil className="h-6 w-6" />
            </div>
            <div className="flex-1">
              <div className="font-semibold">貼上文字</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                AI 自動判斷是訂單還是付款通知
              </div>
            </div>
          </Card>
        </Link>

        <Link to="/people">
          <Card className="p-4 flex items-center gap-4 hover:bg-accent transition-colors">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-slate-500/15 text-slate-600">
              <Users className="h-6 w-6" />
            </div>
            <div className="flex-1">
              <div className="font-semibold">同事管理</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                維護名字別名，提升自動配對命中率
              </div>
            </div>
          </Card>
        </Link>
      </div>
    </div>
  );
}
