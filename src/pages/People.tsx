import { useState } from 'react';
import { Link } from 'react-router-dom';
import { UserPlus, Users } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Empty } from '@/components/ui/empty';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useStore } from '@/lib/store';
import { unpaidItemsFor } from '@/lib/matching';
import { ntd } from '@/lib/format';

export default function People() {
  const colleagues = useStore((s) => s.colleagues);
  const orders = useStore((s) => s.orders);
  const addColleague = useStore((s) => s.addColleague);

  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [aliases, setAliases] = useState('');

  function handleAdd() {
    if (!name.trim()) return;
    addColleague(
      name,
      aliases
        .split(',')
        .map((a) => a.trim())
        .filter(Boolean),
    );
    setName('');
    setAliases('');
    setOpen(false);
  }

  return (
    <div>
      <PageHeader
        title="同事管理"
        back
        right={
          <Button size="icon" variant="ghost" onClick={() => setOpen(true)} aria-label="新增">
            <UserPlus className="h-5 w-5" />
          </Button>
        }
      />
      <div className="space-y-3 p-4">
        {colleagues.length === 0 ? (
          <Empty
            icon={<Users className="h-8 w-8" />}
            title="尚未有同事"
            description="第一次匯入訂單時會自動建立"
            action={<Button onClick={() => setOpen(true)}>手動新增</Button>}
          />
        ) : (
          colleagues.map((c) => {
            const owed = unpaidItemsFor(orders, c.id).reduce((a, b) => a + b.price, 0);
            return (
              <Link key={c.id} to={`/people/${c.id}`}>
                <Card className="p-3 hover:bg-accent transition-colors">
                  <div className="flex items-center justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{c.name}</div>
                      {c.aliases.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {c.aliases.slice(0, 4).map((a) => (
                            <Badge key={a} variant="outline" className="text-[10px] font-normal">
                              {a}
                            </Badge>
                          ))}
                          {c.aliases.length > 4 && (
                            <span className="text-xs text-muted-foreground">+{c.aliases.length - 4}</span>
                          )}
                        </div>
                      )}
                    </div>
                    {owed > 0 && <Badge variant="warning">{ntd(owed)}</Badge>}
                  </div>
                </Card>
              </Link>
            );
          })
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新增同事</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="cname">主名字（你的稱呼）</Label>
              <Input id="cname" value={name} onChange={(e) => setName(e.target.value)} placeholder="阿明" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="caliases">別名（用逗號分隔，可選）</Label>
              <Input
                id="caliases"
                value={aliases}
                onChange={(e) => setAliases(e.target.value)}
                placeholder="Ming Chen, 陳明, M.Chen"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button onClick={handleAdd} disabled={!name.trim()}>
              建立
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
