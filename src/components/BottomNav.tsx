import { NavLink } from 'react-router-dom';
import { Home, Upload, Clock, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';

const items = [
  { to: '/', label: '首頁', icon: Home, end: true },
  { to: '/import', label: '匯入', icon: Upload },
  { to: '/history', label: '歷史', icon: Clock },
  { to: '/settings', label: '設定', icon: Settings },
];

export function BottomNav() {
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/90 backdrop-blur"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <ul className="mx-auto grid max-w-screen-sm grid-cols-4">
        {items.map(({ to, label, icon: Icon, end }) => (
          <li key={to}>
            <NavLink
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  'flex flex-col items-center gap-1 py-2.5 text-xs',
                  isActive ? 'text-primary' : 'text-muted-foreground',
                )
              }
            >
              <Icon className="h-5 w-5" />
              <span>{label}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
