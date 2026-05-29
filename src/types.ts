export type PaymentMethod = 'linepay' | 'transfer' | 'cash' | 'prepaid';

export interface Colleague {
  id: string;
  name: string;
  aliases: string[];
  lineDisplayName?: string;
  prepaidBalance?: number;
  createdAt: string;
}

export interface Shop {
  id: string;
  name: string;
  createdAt: string;
}

export interface OrderItem {
  id: string;
  colleagueId: string;
  drinkName: string;
  price: number;
  paid: boolean;
  paymentMethod?: PaymentMethod;
  paidAt?: string;
  note?: string;
}

export interface Order {
  id: string;
  shopName: string;
  shopId?: string;
  source: 'manual' | 'ubereats_screenshot';
  rawImageBase64?: string;
  createdAt: string;
  items: OrderItem[];
  note?: string;
}

export interface ParsedPayment {
  id: string;
  source: 'manual' | 'screenshot' | 'shortcut';
  rawText?: string;
  rawImageBase64?: string;
  method: PaymentMethod;
  amount: number;
  payerNameRaw: string;
  receivedAt: string;
  matchedItemIds: string[];
  status: 'pending_review' | 'confirmed' | 'rejected';
  notes?: string;
}

export interface AppSettings {
  apiKey?: string;
  model: 'claude-sonnet-4-5' | 'claude-opus-4-7';
  messageTemplate: string;
  tokensUsedThisMonth: number;
  tokensMonth: string;
}

export interface AppState {
  settings: AppSettings;
  orders: Order[];
  colleagues: Colleague[];
  shops: Shop[];
  payments: ParsedPayment[];
  schemaVersion: number;
}

export const DEFAULT_MESSAGE_TEMPLATE = `嗨 {name}！
上次 {shop} 的飲料 ({drinks}) 共 NT$ {amount} 還沒收到，
方便結一下嗎？感謝 🙏`;
