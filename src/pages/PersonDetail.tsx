import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Trash2, X, Plus, GitMerge } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { useStore } from '@/lib/store';
import { ntd, fmtDate } from '@/lib/format';

export default function PersonDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const colleague = useStore((s) => s.colleagues.find((c) => c.id === id));
  const colleagues = useStore((s) => s.colleagues);
  const orders = useStore((s) => s.orders);
  const updateColleague = useStore((s) => s.updateColleague);
  const addAlias = useStore((s) => s.addAlias);
  const removeAlias = useStore((s) => s.removeAlias);
  const deleteColleague = useStore((s) => s.deleteColleague);
  const mergeColleagues = useStore((s) => s.mergeColleagues);

  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState(colleague?.name ?? '');
  const [lineName, setLineName] = useState(colleague?.lineDisplayName ?? '');
  const [newAlias, setNewAlias] = useState('');
  const [showDelete, setShowDelete] = useState(false);
  const [showMerge, setShowMerge] = useState(false);
  const [mergeTarget, setMergeTarget] = useState('');

  if (!colleague) {
    return (
      <div>
        <PageHeader title="同事不存在" back />
      </div>
    );
  }

  const items: Array<{ orderId: string; orderShop: string; orderDate: string; itemId: string; drink: string; price: number; paid: boolean }> = [];
  for (const o of orders) {
    for (const i of o.items) {
      if (i.colleagueId === colleague.id) {
        items.push({
          orderId: o.id,
          orderShop: o.shopName,
          orderDate: o.createdAt,
          itemId: i.id,
          drink: i.drinkName,
          price: i.price,
          paid: i.paid,
        });
      }
    }
  }
  const owed = items.filter((i) => !i.paid).reduce((a, b) => a + b.price, 0);

  function saveName() {
    if (name.trim()) {
      updateColleague(colleague!.id, { name: name.trim(), lineDisplayName: lineName.trim() || undefined });
      setEditingName(false);
    }
  }

  function handleAddAlias() {
    if (newAlias.trim()) {
      addAlias(colleague!.id, newAlias.trim());
      setNewAlias('');
    }
  }

  function handleDelete() {
    deleteColleague(colleague!.id);
    navigate('/people', { replace: true });
  }

  function handleMerge() {
    if (mergeTarget) {
      mergeColleagues(colleague!.id, mergeTarget);
      navigate(`/people/${mergeTarget}`, { replace: true });
    }
  }

  const others = colleagues.filter((c) => c.id !== colleague.id);

  return (
    <div>
      <PageHeader title={colleague.name} back />
      <div className="space-y-4 p-4">
        <Card className="p-4 space-y-3">
          {editingName ? (
            <>
              <div className="space-y-2">
                <Label>主名字</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>LINE 顯示名（可選）</Label>
                <Input
                  value={lineName}
                  onChange={(e) => setLineName(e.target.value)}
                  placeholder="用於 LINE 訊息預填"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" onClick={() => setEditingName(false)}>取消</Button>
                <Button onClick={saveName}>儲存</Button>
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs text-muted-foreground">主名字</div>
                  <div className="font-medium">{colleague.name}</div>
                  {colleague.lineDisplayName && (
                    <div className="text-xs text-muted-foreground mt-1">
                      LINE：{colleague.lineDisplayName}
                    </div>
                  )}
                </div>
                <Button size="sm" variant="outline" onClick={() => setEditingName(true)}>
                  編輯
                </Button>
              </div>
            </>
          )}
        </Card>

        <Card className="p-4">
          <div className="flex items-center justify-between mb-2">
            <Label>別名 (aliases)</Label>
          </div>
          <div className="flex flex-wrap gap-1.5 mb-3">
            {colleague.aliases.length === 0 && (
              <span className="text-xs text-muted-foreground">尚未設定別名</span>
            )}
            {colleague.aliases.map((a) => (
              <Badge key={a} variant="secondary" className="gap-1">
                {a}
                <button onClick={() => removeAlias(colleague.id, a)} aria-label={`移除 ${a}`}>
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
          <div className="flex gap-2">
            <Input
              value={newAlias}
              onChange={(e) => setNewAlias(e.target.value)}
              placeholder="例：Lisa W."
              onKeyDown={(e) => e.key === 'Enter' && handleAddAlias()}
            />
            <Button size="icon" onClick={handleAddAlias}>
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          <div className="mt-2 text-xs text-muted-foreground">
            匯入截圖時，AI 解析到這些名字會自動配對到此同事
          </div>
        </Card>

        <Card className="p-3">
          <div className="text-xs text-muted-foreground">目前欠款</div>
          <div className="text-2xl font-semibold tabular-nums">{ntd(owed)}</div>
        </Card>

        <div>
          <div className="text-sm font-medium text-muted-foreground mb-2 px-1">歷史品項</div>
          {items.length === 0 ? (
            <Card className="p-4 text-sm text-center text-muted-foreground">尚無紀錄</Card>
          ) : (
            <div className="space-y-2">
              {items
                .sort((a, b) => new Date(b.orderDate).getTime() - new Date(a.orderDate).getTime())
                .map((it) => (
                  <Link key={`${it.orderId}-${it.itemId}`} to={`/orders/${it.orderId}`}>
                    <Card className="p-3 hover:bg-accent transition-colors">
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium truncate">{it.drink}</div>
                          <div className="text-xs text-muted-foreground">
                            {it.orderShop} · {fmtDate(it.orderDate)}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="tabular-nums font-semibold">{ntd(it.price)}</div>
                          <Badge variant={it.paid ? 'success' : 'warning'} className="text-[10px]">
                            {it.paid ? '已付' : '未付'}
                          </Badge>
                        </div>
                      </div>
                    </Card>
                  </Link>
                ))}
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2 pt-2">
          <Button variant="outline" onClick={() => setShowMerge(true)} disabled={others.length === 0}>
            <GitMerge className="h-4 w-4" />
            合併到其他
          </Button>
          <Button variant="destructive" onClick={() => setShowDelete(true)}>
            <Trash2 className="h-4 w-4" />
            刪除
          </Button>
        </div>
      </div>

      <Dialog open={showDelete} onOpenChange={setShowDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>刪除「{colleague.name}」？</DialogTitle>
            <DialogDescription>
              歷史訂單中的姓名快照會保留，但建議清單中不再出現。此操作無法復原。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDelete(false)}>取消</Button>
            <Button variant="destructive" onClick={handleDelete}>確定刪除</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showMerge} onOpenChange={setShowMerge}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>合併「{colleague.name}」到其他同事</DialogTitle>
            <DialogDescription>
              所有歷史訂單會改掛在目標同事，這個同事的別名也會被合併過去。
            </DialogDescription>
          </DialogHeader>
          <select
            value={mergeTarget}
            onChange={(e) => setMergeTarget(e.target.value)}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">-- 選擇目標 --</option>
            {others.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowMerge(false)}>取消</Button>
            <Button onClick={handleMerge} disabled={!mergeTarget}>合併</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
