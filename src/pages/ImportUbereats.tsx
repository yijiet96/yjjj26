import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ReactCrop, { type Crop, centerCrop, makeAspectCrop } from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';
import { Camera, Loader2, Trash2, Plus, ArrowRight } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useStore } from '@/lib/store';
import { parseUbereatsImage, friendlyAnthropicError } from '@/lib/anthropic';
import { cropToCanvas, fileToImageElement, resizeToBase64 } from '@/lib/image';
import { findColleagueByAlias } from '@/lib/matching';
import { ntd } from '@/lib/format';

type Step = 'pick' | 'crop' | 'review';

interface ReviewRow {
  rawName: string;
  drinkName: string;
  price: string;
  colleagueId: string;
  newColleagueName: string;
}

export default function ImportUbereats() {
  const navigate = useNavigate();
  const apiKey = useStore((s) => s.settings.apiKey);
  const model = useStore((s) => s.settings.model);
  const colleagues = useStore((s) => s.colleagues);
  const shops = useStore((s) => s.shops);
  const addColleague = useStore((s) => s.addColleague);
  const addAlias = useStore((s) => s.addAlias);
  const addOrder = useStore((s) => s.addOrder);
  const bumpTokens = useStore((s) => s.bumpTokens);

  const [step, setStep] = useState<Step>('pick');
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageEl, setImageEl] = useState<HTMLImageElement | null>(null);
  const [crop, setCrop] = useState<Crop>();
  const [shopName, setShopName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [notes, setNotes] = useState('');
  const [croppedBase64, setCroppedBase64] = useState<string | undefined>();
  const fileInput = useRef<HTMLInputElement>(null);

  function reset() {
    setStep('pick');
    setImageUrl(null);
    setImageEl(null);
    setRows([]);
    setError(null);
    setCroppedBase64(undefined);
  }

  async function handleFile(file: File) {
    setError(null);
    const url = URL.createObjectURL(file);
    setImageUrl(url);
    setStep('crop');
  }

  function onImageLoad(e: React.SyntheticEvent<HTMLImageElement>) {
    setImageEl(e.currentTarget);
    const c = centerCrop(
      makeAspectCrop({ unit: '%', width: 90 }, 1, e.currentTarget.width, e.currentTarget.height),
      e.currentTarget.width,
      e.currentTarget.height,
    );
    setCrop(c);
  }

  async function handleParse(useCrop: boolean) {
    if (!apiKey) {
      setError('尚未設定 Anthropic API key');
      return;
    }
    if (!imageEl) return;
    setLoading(true);
    setError(null);
    try {
      let base64: string;
      if (useCrop && crop && (crop.width ?? 0) > 0 && (crop.height ?? 0) > 0) {
        const pixelCrop = {
          x: (crop.unit === '%' ? (crop.x / 100) * imageEl.width : crop.x) || 0,
          y: (crop.unit === '%' ? (crop.y / 100) * imageEl.height : crop.y) || 0,
          width: (crop.unit === '%' ? (crop.width / 100) * imageEl.width : crop.width) || 0,
          height: (crop.unit === '%' ? (crop.height / 100) * imageEl.height : crop.height) || 0,
        };
        const canvas = await cropToCanvas(imageEl, pixelCrop);
        base64 = await resizeToBase64(canvas);
      } else {
        base64 = await resizeToBase64(imageEl);
      }
      setCroppedBase64(base64);
      const { data, usage } = await parseUbereatsImage(apiKey, base64, model);
      bumpTokens((usage.input_tokens ?? 0) + (usage.output_tokens ?? 0));
      if (data.shopName && !shopName) setShopName(data.shopName);
      setNotes(data.notes ?? '');
      const reviewRows: ReviewRow[] = data.items.map((it) => {
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
    } catch (err) {
      setError(friendlyAnthropicError(err));
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
      source: 'ubereats_screenshot',
      rawImageBase64: croppedBase64,
      note: notes || undefined,
    });
    navigate(`/orders/${order.id}`, { replace: true });
  }

  return (
    <div>
      <PageHeader title="UberEats 訂單匯入" back />
      <div className="space-y-4 p-4">
        {error && (
          <Card className="border-destructive/40 bg-destructive/10 p-3 text-sm">{error}</Card>
        )}

        {step === 'pick' && (
          <>
            <Card
              className="p-8 border-dashed flex flex-col items-center justify-center text-center cursor-pointer hover:bg-accent transition-colors"
              onClick={() => fileInput.current?.click()}
            >
              <Camera className="h-10 w-10 text-muted-foreground mb-3" />
              <div className="font-medium">點此選擇截圖</div>
              <div className="text-xs text-muted-foreground mt-1">
                建議裁切只留訂單明細以節省 token
              </div>
            </Card>
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
            />
          </>
        )}

        {step === 'crop' && imageUrl && (
          <>
            <Card className="p-3 space-y-3">
              <Label>裁切想保留的訂單區域（可選，整張送也可以）</Label>
              <div className="rounded-md overflow-hidden bg-black/5">
                <ReactCrop crop={crop} onChange={(c) => setCrop(c)}>
                  <img src={imageUrl} alt="預覽" onLoad={onImageLoad} />
                </ReactCrop>
              </div>
            </Card>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" onClick={reset}>重選</Button>
              <Button onClick={() => handleParse(true)} disabled={loading}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                開始解析
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
                placeholder="例：50 嵐"
              />
              <datalist id="shop-options">
                {shops.map((s) => <option key={s.id} value={s.name} />)}
              </datalist>
            </div>

            {notes && (
              <Card className="bg-amber-50 dark:bg-amber-950/30 border-amber-500/30 p-3 text-xs text-amber-700 dark:text-amber-300">
                AI 備註：{notes}
              </Card>
            )}

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
                          截圖名字：<span className="font-mono">{row.rawName || '—'}</span>
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
                            <option key={c.id} value={c.id}>{c.name}</option>
                          ))}
                          <option value="__new__">＋ 建立新同事</option>
                        </select>
                        {(!row.colleagueId && (row.newColleagueName || isNewName)) && (
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
              <Button variant="outline" onClick={reset}>重新匯入</Button>
              <Button onClick={handleCreate} disabled={!canSubmit}>建立訂單</Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
