import type { Colleague, Order, OrderItem } from '@/types';

export function findColleagueByAlias(
  colleagues: Colleague[],
  raw: string,
): Colleague | undefined {
  if (!raw) return undefined;
  const norm = raw.trim().toLowerCase();
  if (!norm) return undefined;

  // Pass 1: exact match
  for (const c of colleagues) {
    if (c.name.toLowerCase() === norm) return c;
    if (c.aliases.some((a) => a.toLowerCase() === norm)) return c;
  }

  // Pass 2: substring match
  for (const c of colleagues) {
    if (c.name.toLowerCase().includes(norm) || norm.includes(c.name.toLowerCase())) return c;
    if (c.aliases.some((a) => {
      const al = a.toLowerCase();
      return al.includes(norm) || norm.includes(al);
    })) return c;
  }

  // Pass 3: masked name (LINE Pay format "林*" or "吳*澄")
  if (norm.includes('*')) {
    const starIdx = norm.indexOf('*');
    const prefix = norm.slice(0, starIdx);
    const suffix = norm.slice(starIdx + 1);
    const matchesName = (name: string) => {
      const n = name.toLowerCase();
      if (prefix && !n.startsWith(prefix)) return false;
      if (suffix && !n.endsWith(suffix)) return false;
      // name must be longer than prefix+suffix (the * represents ≥1 char)
      return n.length > prefix.length + suffix.length;
    };
    for (const c of colleagues) {
      if (matchesName(c.name) || c.aliases.some((a) => matchesName(a))) return c;
    }
  }

  return undefined;
}

export interface ItemRef {
  orderId: string;
  itemId: string;
  shopName: string;
  drinkName: string;
  price: number;
  createdAt: string;
}

export function unpaidItemsFor(orders: Order[], colleagueId: string): ItemRef[] {
  const refs: ItemRef[] = [];
  for (const o of orders) {
    for (const i of o.items) {
      if (i.colleagueId === colleagueId && !i.paid) {
        refs.push({
          orderId: o.id,
          itemId: i.id,
          shopName: o.shopName,
          drinkName: i.drinkName,
          price: i.price,
          createdAt: o.createdAt,
        });
      }
    }
  }
  return refs;
}

export function matchByAmount(
  items: ItemRef[],
  amount: number,
): { type: 'exact' | 'combo' | 'none'; matched: ItemRef[] } {
  const exact = items.find((i) => i.price === amount);
  if (exact) return { type: 'exact', matched: [exact] };

  const n = items.length;
  if (n === 0 || n > 12) return { type: 'none', matched: [] };
  for (let mask = 1; mask < 1 << n; mask++) {
    let total = 0;
    const picked: ItemRef[] = [];
    for (let b = 0; b < n; b++) {
      if (mask & (1 << b)) {
        total += items[b].price;
        picked.push(items[b]);
      }
    }
    if (total === amount) {
      return { type: picked.length === 1 ? 'exact' : 'combo', matched: picked };
    }
  }
  return { type: 'none', matched: [] };
}

export function totalOwed(items: OrderItem[]): number {
  return items.filter((i) => !i.paid).reduce((a, b) => a + b.price, 0);
}

export function totalPaid(items: OrderItem[]): number {
  return items.filter((i) => i.paid).reduce((a, b) => a + b.price, 0);
}

export function renderTemplate(
  template: string,
  ctx: { name: string; drinks: string; amount: number; shop: string; date: string },
): string {
  return template
    .replaceAll('{name}', ctx.name)
    .replaceAll('{drinks}', ctx.drinks)
    .replaceAll('{amount}', String(ctx.amount))
    .replaceAll('{shop}', ctx.shop)
    .replaceAll('{date}', ctx.date);
}
