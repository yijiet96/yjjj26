import Anthropic from '@anthropic-ai/sdk';

export const UBEREATS_PARSE_PROMPT = `你是訂單解析助手。使用者會給你 UberEats 團購訂單的截圖。
請仔細辨識每一筆品項，並回傳純 JSON（不要加 markdown code fence）：

{
  "items": [
    { "name": "下單者名字（截圖上顯示的）", "drink": "飲料完整描述（含糖冰加料）", "price": 整數金額 }
  ],
  "shopName": "店家名稱（如果截圖有顯示）",
  "totalAmount": 整數總金額,
  "confidence": "high" | "medium" | "low",
  "notes": "任何辨識上不確定的地方，例如「第三筆價格被遮住」"
}

注意：
- price 必須為新台幣整數
- 如果同一個人點兩杯，拆成兩筆
- 如果看不清楚某項，仍要回傳並把 confidence 設為 medium 或 low，notes 標註`;

export const PAYMENT_PARSE_PROMPT = `你是付款通知解析助手。使用者會給你一張付款收款通知的截圖
（可能來自 LINE Pay、台灣的銀行 App 通知、簡訊等）。

截圖可能包含一筆或多筆付款記錄，請全部辨識出來。

請回傳純 JSON（不要加 markdown code fence）：

{
  "payments": [
    {
      "method": "linepay" | "transfer" | "unknown",
      "amount": 整數金額,
      "payerName": "付款人名字或暱稱",
      "receivedAt": "ISO 8601 時間（若截圖有時間戳記，沒有則回傳 null）"
    }
  ],
  "confidence": "high" | "medium" | "low",
  "notes": "任何不確定的細節"
}

注意：
- LinePay 通知通常有「您已收到 XXX 元，付款人：XXX」字樣
- 銀行通知通常顯示「收到一筆轉入 XXX 元，轉出戶名：XXX」
- 若截圖顯示多筆付款清單，請逐筆列出，不要只取第一筆
- 若無法判斷 method，回 "unknown"，讓使用者手動選`;

export const AUTO_PARSE_PROMPT = `你會收到一段使用者分享過來的文字，可能是 UberEats 訂單明細，也可能是 LINE Pay / 銀行付款通知。
請先判斷是哪一種，再回傳純 JSON（不要 markdown code fence）：

{
  "type": "ubereats" | "payment" | "unknown",
  "ubereats": {
    "items": [{ "name": "...", "drink": "...", "price": 整數 }],
    "shopName": "...",
    "totalAmount": 整數
  } | null,
  "payment": {
    "method": "linepay" | "transfer" | "unknown",
    "amount": 整數,
    "payerName": "...",
    "receivedAt": "ISO 時間或 null"
  } | null,
  "confidence": "high" | "medium" | "low",
  "notes": "..."
}`;

export interface UbereatsParseResult {
  items: Array<{ name: string; drink: string; price: number }>;
  shopName?: string;
  totalAmount?: number;
  confidence?: 'high' | 'medium' | 'low';
  notes?: string;
}

export interface PaymentParseItem {
  method: 'linepay' | 'transfer' | 'unknown';
  amount: number;
  payerName: string;
  receivedAt: string | null;
}

export interface PaymentParseResult {
  payments: PaymentParseItem[];
  confidence?: 'high' | 'medium' | 'low';
  notes?: string;
}

export interface AutoParseResult {
  type: 'ubereats' | 'payment' | 'unknown';
  ubereats?: UbereatsParseResult | null;
  payment?: PaymentParseItem | null;
  confidence?: 'high' | 'medium' | 'low';
  notes?: string;
}

export type ModelId = 'claude-sonnet-4-5' | 'claude-opus-4-7';

export function getClient(apiKey: string) {
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
}

function stripJson(text: string): string {
  return text
    .replace(/```json\s*/gi, '')
    .replace(/```\s*$/g, '')
    .replace(/```/g, '')
    .trim();
}

function pickText(content: Anthropic.Messages.ContentBlock[]): string {
  return content
    .filter((c): c is Anthropic.Messages.TextBlock => c.type === 'text')
    .map((c) => c.text)
    .join('\n');
}

export async function parseUbereatsImage(
  apiKey: string,
  base64: string,
  model: ModelId = 'claude-sonnet-4-5',
): Promise<{ data: UbereatsParseResult; usage: Anthropic.Messages.Usage }> {
  const client = getClient(apiKey);
  const res = await client.messages.create({
    model,
    max_tokens: 2000,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64 } },
          { type: 'text', text: UBEREATS_PARSE_PROMPT },
        ],
      },
    ],
  });
  const text = pickText(res.content);
  const data = JSON.parse(stripJson(text)) as UbereatsParseResult;
  return { data, usage: res.usage };
}

export async function parsePaymentImage(
  apiKey: string,
  base64: string,
  model: ModelId = 'claude-sonnet-4-5',
): Promise<{ data: PaymentParseResult; usage: Anthropic.Messages.Usage }> {
  const client = getClient(apiKey);
  const res = await client.messages.create({
    model,
    max_tokens: 1000,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64 } },
          { type: 'text', text: PAYMENT_PARSE_PROMPT },
        ],
      },
    ],
  });
  const text = pickText(res.content);
  const data = JSON.parse(stripJson(text)) as PaymentParseResult;
  return { data, usage: res.usage };
}

export async function parseAutoText(
  apiKey: string,
  rawText: string,
  model: ModelId = 'claude-sonnet-4-5',
): Promise<{ data: AutoParseResult; usage: Anthropic.Messages.Usage }> {
  const client = getClient(apiKey);
  const res = await client.messages.create({
    model,
    max_tokens: 2000,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: AUTO_PARSE_PROMPT },
          { type: 'text', text: `---\n以下是使用者分享的文字：\n${rawText}` },
        ],
      },
    ],
  });
  const text = pickText(res.content);
  const data = JSON.parse(stripJson(text)) as AutoParseResult;
  return { data, usage: res.usage };
}

export async function testApiKey(apiKey: string): Promise<boolean> {
  try {
    const client = getClient(apiKey);
    await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 16,
      messages: [{ role: 'user', content: 'pong' }],
    });
    return true;
  } catch {
    return false;
  }
}

export function friendlyAnthropicError(err: unknown): string {
  if (err instanceof Anthropic.APIError) {
    if (err.status === 401) return 'API key 失效，請到設定頁重設。';
    if (err.status === 429) return '呼叫過於頻繁，請稍後再試。';
    if (err.status === 400) return 'AI 請求格式錯誤，請重新嘗試或檢查截圖。';
    return `AI 服務錯誤（${err.status}）：${err.message}`;
  }
  if (err instanceof SyntaxError) return 'AI 回傳格式無法解析，請重試或手動輸入。';
  if (err instanceof Error) return err.message;
  return '未知錯誤';
}
