import { format, setDefaultOptions } from 'date-fns';
import { zhTW } from 'date-fns/locale';

setDefaultOptions({ locale: zhTW });

export function ntd(n: number): string {
  return `NT$ ${n.toLocaleString('zh-TW')}`;
}

export function fmtDate(iso: string, pattern = 'M/d HH:mm'): string {
  try {
    return format(new Date(iso), pattern);
  } catch {
    return iso;
  }
}

export function fmtDay(iso: string): string {
  return fmtDate(iso, 'yyyy/MM/dd');
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function monthKey(iso: string): string {
  return fmtDate(iso, 'yyyy-MM');
}
