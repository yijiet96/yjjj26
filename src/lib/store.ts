import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { nanoid } from 'nanoid';
import type {
  AppState,
  AppSettings,
  Colleague,
  Order,
  OrderItem,
  ParsedPayment,
  Shop,
  PaymentMethod,
} from '@/types';
import { DEFAULT_MESSAGE_TEMPLATE } from '@/types';
import { nowIso, monthKey } from './format';

const defaultSettings: AppSettings = {
  apiKey: undefined,
  model: 'claude-sonnet-4-5',
  messageTemplate: DEFAULT_MESSAGE_TEMPLATE,
  tokensUsedThisMonth: 0,
  tokensMonth: monthKey(nowIso()),
};

interface Actions {
  updateSettings: (patch: Partial<AppSettings>) => void;
  addColleague: (name: string, aliases?: string[]) => Colleague;
  updateColleague: (id: string, patch: Partial<Colleague>) => void;
  deleteColleague: (id: string) => void;
  mergeColleagues: (sourceId: string, targetId: string) => void;
  addAlias: (colleagueId: string, alias: string) => void;
  removeAlias: (colleagueId: string, alias: string) => void;
  addShop: (name: string) => Shop;
  addOrder: (input: {
    shopName: string;
    items: Array<Omit<OrderItem, 'id' | 'paid'>>;
    source?: Order['source'];
    rawImageBase64?: string;
    note?: string;
  }) => Order;
  updateOrder: (id: string, patch: Partial<Order>) => void;
  deleteOrder: (id: string) => void;
  setItemPaid: (orderId: string, itemId: string, method: PaymentMethod) => void;
  setItemUnpaid: (orderId: string, itemId: string) => void;
  setItemsPaid: (matches: Array<{ orderId: string; itemId: string }>, method: PaymentMethod) => void;
  addPayment: (payment: Omit<ParsedPayment, 'id'>) => ParsedPayment;
  updatePayment: (id: string, patch: Partial<ParsedPayment>) => void;
  deletePayment: (id: string) => void;
  bumpTokens: (n: number) => void;
  clearImages: () => void;
  clearAll: () => void;
  importJson: (state: AppState) => void;
}

const initial: AppState = {
  settings: defaultSettings,
  orders: [],
  colleagues: [],
  shops: [],
  payments: [],
  schemaVersion: 2,
};

export const useStore = create<AppState & Actions>()(
  persist(
    (set, get) => ({
      ...initial,
      updateSettings: (patch) =>
        set((s) => ({ settings: { ...s.settings, ...patch } })),
      addColleague: (name, aliases = []) => {
        const c: Colleague = {
          id: nanoid(),
          name: name.trim(),
          aliases: aliases.map((a) => a.trim()).filter(Boolean),
          createdAt: nowIso(),
        };
        set((s) => ({ colleagues: [...s.colleagues, c] }));
        return c;
      },
      updateColleague: (id, patch) =>
        set((s) => ({
          colleagues: s.colleagues.map((c) => (c.id === id ? { ...c, ...patch } : c)),
        })),
      deleteColleague: (id) =>
        set((s) => ({ colleagues: s.colleagues.filter((c) => c.id !== id) })),
      mergeColleagues: (sourceId, targetId) => {
        const { colleagues, orders } = get();
        const source = colleagues.find((c) => c.id === sourceId);
        const target = colleagues.find((c) => c.id === targetId);
        if (!source || !target) return;
        const aliases = Array.from(new Set([...target.aliases, source.name, ...source.aliases]));
        const newOrders = orders.map((o) => ({
          ...o,
          items: o.items.map((i) =>
            i.colleagueId === sourceId ? { ...i, colleagueId: targetId } : i,
          ),
        }));
        set({
          colleagues: colleagues
            .filter((c) => c.id !== sourceId)
            .map((c) => (c.id === targetId ? { ...c, aliases } : c)),
          orders: newOrders,
        });
      },
      addAlias: (colleagueId, alias) => {
        const cleaned = alias.trim();
        if (!cleaned) return;
        set((s) => ({
          colleagues: s.colleagues.map((c) =>
            c.id === colleagueId && !c.aliases.includes(cleaned)
              ? { ...c, aliases: [...c.aliases, cleaned] }
              : c,
          ),
        }));
      },
      removeAlias: (colleagueId, alias) =>
        set((s) => ({
          colleagues: s.colleagues.map((c) =>
            c.id === colleagueId ? { ...c, aliases: c.aliases.filter((a) => a !== alias) } : c,
          ),
        })),
      addShop: (name) => {
        const trimmed = name.trim();
        const existing = get().shops.find((s) => s.name === trimmed);
        if (existing) return existing;
        const shop: Shop = { id: nanoid(), name: trimmed, createdAt: nowIso() };
        set((s) => ({ shops: [...s.shops, shop] }));
        return shop;
      },
      addOrder: ({ shopName, items, source = 'manual', rawImageBase64, note }) => {
        const shop = get().addShop(shopName);
        const order: Order = {
          id: nanoid(),
          shopId: shop.id,
          shopName: shop.name,
          source,
          rawImageBase64,
          createdAt: nowIso(),
          note,
          items: items.map((it) => ({ ...it, id: nanoid(), paid: false })),
        };
        set((s) => ({ orders: [order, ...s.orders] }));
        return order;
      },
      updateOrder: (id, patch) =>
        set((s) => ({
          orders: s.orders.map((o) => (o.id === id ? { ...o, ...patch } : o)),
        })),
      deleteOrder: (id) => set((s) => ({ orders: s.orders.filter((o) => o.id !== id) })),
      setItemPaid: (orderId, itemId, method) =>
        set((s) => ({
          orders: s.orders.map((o) =>
            o.id === orderId
              ? {
                  ...o,
                  items: o.items.map((i) =>
                    i.id === itemId
                      ? { ...i, paid: true, paymentMethod: method, paidAt: nowIso() }
                      : i,
                  ),
                }
              : o,
          ),
        })),
      setItemUnpaid: (orderId, itemId) =>
        set((s) => ({
          orders: s.orders.map((o) =>
            o.id === orderId
              ? {
                  ...o,
                  items: o.items.map((i) =>
                    i.id === itemId
                      ? { ...i, paid: false, paymentMethod: undefined, paidAt: undefined }
                      : i,
                  ),
                }
              : o,
          ),
        })),
      setItemsPaid: (matches, method) => {
        const lookup = new Set(matches.map((m) => `${m.orderId}::${m.itemId}`));
        const t = nowIso();
        set((s) => ({
          orders: s.orders.map((o) => ({
            ...o,
            items: o.items.map((i) =>
              lookup.has(`${o.id}::${i.id}`)
                ? { ...i, paid: true, paymentMethod: method, paidAt: t }
                : i,
            ),
          })),
        }));
      },
      addPayment: (p) => {
        const payment: ParsedPayment = { id: nanoid(), ...p };
        set((s) => ({ payments: [payment, ...s.payments] }));
        return payment;
      },
      updatePayment: (id, patch) =>
        set((s) => ({
          payments: s.payments.map((p) => (p.id === id ? { ...p, ...patch } : p)),
        })),
      deletePayment: (id) =>
        set((s) => ({ payments: s.payments.filter((p) => p.id !== id) })),
      bumpTokens: (n) =>
        set((s) => {
          const m = monthKey(nowIso());
          if (s.settings.tokensMonth !== m) {
            return { settings: { ...s.settings, tokensMonth: m, tokensUsedThisMonth: n } };
          }
          return {
            settings: { ...s.settings, tokensUsedThisMonth: s.settings.tokensUsedThisMonth + n },
          };
        }),
      clearImages: () =>
        set((s) => ({
          orders: s.orders.map((o) => ({ ...o, rawImageBase64: undefined })),
          payments: s.payments.map((p) => ({ ...p, rawImageBase64: undefined })),
        })),
      clearAll: () => set(() => ({ ...initial })),
      importJson: (state) => set(() => ({ ...initial, ...state, schemaVersion: 2 })),
    }),
    {
      name: 'drinkrun-v2',
      version: 2,
    },
  ),
);

export function exportJson(): string {
  const { settings, orders, colleagues, shops, payments, schemaVersion } = useStore.getState();
  return JSON.stringify(
    {
      settings: { ...settings, apiKey: undefined },
      orders,
      colleagues,
      shops,
      payments,
      schemaVersion,
    },
    null,
    2,
  );
}
