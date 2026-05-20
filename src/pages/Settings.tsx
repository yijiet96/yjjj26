import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Key,
  Cpu,
  MessageSquare,
  Smartphone,
  Database,
  Users,
  Banknote,
  Calculator,
  Loader2,
  CheckCircle2,
  XCircle,
  ChevronRight,
  Eye,
  EyeOff,
} from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useStore, exportJson } from '@/lib/store';
import { testApiKey } from '@/lib/anthropic';
import { DEFAULT_MESSAGE_TEMPLATE } from '@/types';
import { renderTemplate } from '@/lib/matching';

export default function Settings() {
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);
  const clearAll = useStore((s) => s.clearAll);
  const clearImages = useStore((s) => s.clearImages);
  const importJsonAction = useStore((s) => s.importJson);

  const [apiKeyInput, setApiKeyInput] = useState(settings.apiKey ?? '');
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<'ok' | 'fail' | null>(null);
  const [templateDraft, setTemplateDraft] = useState(settings.messageTemplate);
  const [confirmClear, setConfirmClear] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    const ok = await testApiKey(apiKeyInput.trim());
    setTestResult(ok ? 'ok' : 'fail');
    setTesting(false);
  }

  function saveKey() {
    updateSettings({ apiKey: apiKeyInput.trim() || undefined });
  }

  function saveTemplate() {
    updateSettings({ messageTemplate: templateDraft });
  }

  function resetTemplate() {
    setTemplateDraft(DEFAULT_MESSAGE_TEMPLATE);
    updateSettings({ messageTemplate: DEFAULT_MESSAGE_TEMPLATE });
  }

  function handleExport() {
    const blob = new Blob([exportJson()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `drinkrun-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const json = JSON.parse(reader.result as string);
        importJsonAction(json);
        alert('匯入完成');
      } catch {
        alert('檔案格式錯誤');
      }
    };
    reader.readAsText(file);
    if (fileInput.current) fileInput.current.value = '';
  }

  const previewMsg = renderTemplate(templateDraft, {
    name: '阿明',
    drinks: '珍奶微糖少冰',
    amount: 55,
    shop: '50 嵐',
    date: '5/20',
  });

  return (
    <div>
      <PageHeader title="設定" />
      <div className="space-y-4 p-4">
        <Section icon={<Key />} title="AI 解析" description="使用者自備 Anthropic API key">
          <div className="space-y-2">
            <Label htmlFor="apikey">Anthropic API key</Label>
            <div className="flex gap-2">
              <Input
                id="apikey"
                type={showKey ? 'text' : 'password'}
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                placeholder="sk-ant-..."
                autoComplete="off"
              />
              <Button size="icon" variant="ghost" onClick={() => setShowKey((v) => !v)}>
                {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </div>
            <div className="text-xs text-muted-foreground">
              金鑰僅儲存於本機 localStorage，不會上傳任何伺服器。
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={handleTest} disabled={!apiKeyInput || testing}>
                {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                測試連線
              </Button>
              <Button onClick={saveKey} disabled={apiKeyInput.trim() === (settings.apiKey ?? '')}>
                儲存
              </Button>
            </div>
            {testResult === 'ok' && (
              <div className="text-xs text-emerald-600 flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3" /> 連線成功
              </div>
            )}
            {testResult === 'fail' && (
              <div className="text-xs text-destructive flex items-center gap-1">
                <XCircle className="h-3 w-3" /> 無法連線，請確認 key 是否正確
              </div>
            )}
          </div>
        </Section>

        <Section icon={<Cpu />} title="模型" description="預設 Sonnet 4.5，Opus 4.7 解析品質最高但成本較高">
          <div className="space-y-2">
            <select
              value={settings.model}
              onChange={(e) => updateSettings({ model: e.target.value as typeof settings.model })}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="claude-sonnet-4-5">claude-sonnet-4-5（建議）</option>
              <option value="claude-opus-4-7">claude-opus-4-7</option>
            </select>
            <div className="text-xs text-muted-foreground">
              本月已用 token 估算：{settings.tokensUsedThisMonth.toLocaleString()} tokens ·{' '}
              {settings.tokensMonth}
            </div>
          </div>
        </Section>

        <Section icon={<MessageSquare />} title="訊息範本" description="支援變數：{name}、{drinks}、{amount}、{shop}、{date}">
          <div className="space-y-2">
            <Textarea
              value={templateDraft}
              onChange={(e) => setTemplateDraft(e.target.value)}
              rows={5}
            />
            <Card className="bg-muted p-3 text-sm whitespace-pre-wrap">{previewMsg}</Card>
            <div className="flex gap-2">
              <Button variant="outline" onClick={resetTemplate}>回到預設</Button>
              <Button
                onClick={saveTemplate}
                disabled={templateDraft === settings.messageTemplate}
              >
                儲存
              </Button>
            </div>
          </div>
        </Section>

        <Section icon={<Smartphone />} title="iOS 捷徑教學" description="從任何 App 通知一鍵帶入文字">
          <Link to="/settings/shortcut">
            <Card className="p-3 flex items-center justify-between hover:bg-accent transition-colors">
              <span className="text-sm">查看教學與下載連結</span>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </Card>
          </Link>
        </Section>

        <Section icon={<Database />} title="其他" description={undefined}>
          <div className="space-y-2">
            <Link to="/people">
              <Card className="p-3 flex items-center justify-between hover:bg-accent transition-colors">
                <span className="flex items-center gap-2 text-sm"><Users className="h-4 w-4" /> 同事管理</span>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </Card>
            </Link>
            <Link to="/payments">
              <Card className="p-3 flex items-center justify-between hover:bg-accent transition-colors">
                <span className="flex items-center gap-2 text-sm"><Banknote className="h-4 w-4" /> 付款記錄</span>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </Card>
            </Link>
            <Link to="/reconcile">
              <Card className="p-3 flex items-center justify-between hover:bg-accent transition-colors">
                <span className="flex items-center gap-2 text-sm"><Calculator className="h-4 w-4" /> 對帳</span>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </Card>
            </Link>
          </div>
        </Section>

        <Section icon={<Database />} title="資料管理" description="匯出 / 匯入 JSON、清除資料">
          <div className="space-y-2">
            <Button variant="outline" className="w-full" onClick={handleExport}>
              匯出 JSON 備份
            </Button>
            <Button variant="outline" className="w-full" onClick={() => fileInput.current?.click()}>
              匯入 JSON
            </Button>
            <input
              ref={fileInput}
              type="file"
              accept="application/json"
              className="hidden"
              onChange={handleImport}
            />
            <Button variant="outline" className="w-full" onClick={clearImages}>
              清除所有截圖（節省空間）
            </Button>
            <Button variant="destructive" className="w-full" onClick={() => setConfirmClear(true)}>
              清除所有資料
            </Button>
          </div>
        </Section>

        <div className="pt-4 text-center text-xs text-muted-foreground">DrinkRun v2</div>
      </div>

      <Dialog open={confirmClear} onOpenChange={setConfirmClear}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>確定清除所有資料？</DialogTitle>
            <DialogDescription>
              所有訂單、同事、付款記錄與 API key 設定都會被刪除。建議先匯出備份。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmClear(false)}>取消</Button>
            <Button
              variant="destructive"
              onClick={() => {
                clearAll();
                setConfirmClear(false);
              }}
            >
              全部清除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Section({
  icon,
  title,
  description,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center gap-2">
        <div className="text-muted-foreground">{icon}</div>
        <div>
          <div className="font-medium">{title}</div>
          {description && <div className="text-xs text-muted-foreground">{description}</div>}
        </div>
      </div>
      {children}
    </Card>
  );
}
