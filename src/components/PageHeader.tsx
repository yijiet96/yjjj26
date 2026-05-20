import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from './ui/button';

export function PageHeader({
  title,
  subtitle,
  back = false,
  right,
}: {
  title: string;
  subtitle?: string;
  back?: boolean;
  right?: React.ReactNode;
}) {
  const navigate = useNavigate();
  return (
    <header className="sticky top-0 z-30 border-b bg-background/85 px-4 py-3 backdrop-blur">
      <div className="mx-auto flex max-w-screen-sm items-center gap-2">
        {back && (
          <Button size="icon" variant="ghost" onClick={() => navigate(-1)} aria-label="返回">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        )}
        <div className="flex-1 min-w-0">
          <h1 className="truncate text-lg font-semibold">{title}</h1>
          {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        {right}
      </div>
    </header>
  );
}
