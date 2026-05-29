export interface ParsedItem {
  name: string;
  drink: string;
  price: number;
}

export interface ParsedReceipt {
  items: ParsedItem[];
  shopName: string;
  date?: string; // ISO string, if detectable
}

export function parseUberEatsReceiptText(raw: string): ParsedReceipt | null {
  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);

  // Extract shop name: "以下是您在{shop}訂購的電子明細" or "以下是您在{shop}的電子明細"
  let shopName = '';
  for (const line of lines) {
    const m = line.match(/以下是您在(.+?)(?:訂購的電子明細|的電子明細)/);
    if (m) { shopName = m[1].trim(); break; }
  }

  // Extract date: "2026 年 5 月 20 日" + "上午/下午 H:MM"
  let date: string | undefined;
  const fullText = raw.replace(/\n/g, ' ');
  const dateMatch = fullText.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  if (dateMatch) {
    const y = parseInt(dateMatch[1]);
    const mo = parseInt(dateMatch[2]) - 1;
    const d = parseInt(dateMatch[3]);
    let h = 12, min = 0;
    const timeMatch = fullText.match(/([上下])午\s*(\d{1,2}):(\d{2})/);
    if (timeMatch) {
      h = parseInt(timeMatch[2]);
      min = parseInt(timeMatch[3]);
      if (timeMatch[1] === '下' && h < 12) h += 12;
      if (timeMatch[1] === '上' && h === 12) h = 0;
    }
    date = new Date(y, mo, d, h, min).toISOString();
  }

  // Find item blocks: standalone integer at index i, lines[i+2] starts with $
  const quantityIndices: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    if (/^\d+$/.test(lines[i]) && i + 2 < lines.length && /^\$[\d.]+$/.test(lines[i + 2])) {
      quantityIndices.push(i);
    }
  }

  if (quantityIndices.length === 0) return null;

  function looksLikePersonName(line: string): boolean {
    if (!line || line.length === 0) return false;
    if (/\(\$[\d.]+\)/.test(line)) return false;       // add-on price: ($ 10.00)
    if (/^\$[\d.]+$/.test(line)) return false;          // standalone price
    if (/^\d+$/.test(line)) return false;               // pure number
    if (/無糖|少糖|半糖|全糖|微糖|无糖/.test(line)) return false;
    if (/無冰|少冰|微冰|去冰|多冰|常溫|熱飲/.test(line)) return false;
    if (/大杯|中杯|小杯|Large|Medium|Small/.test(line)) return false;
    if (/分糖|分冰/.test(line)) return false;           // 三分冰, 1分糖…
    if (/Sugar.Free|Sugar|% Ice|% Sugar/.test(line)) return false;
    return true;
  }

  const items: ParsedItem[] = [];
  let currentPersonName = '';

  for (let qi = 0; qi < quantityIndices.length; qi++) {
    const idx = quantityIndices[qi];
    const prevLine = lines[idx - 1] || '';
    if (looksLikePersonName(prevLine)) {
      currentPersonName = prevLine.replace(/\s*\(您\)\s*/g, '').replace(/\s*\(you\)\s*/gi, '').trim();
    }
    const qty = parseInt(lines[idx], 10);
    const drink = lines[idx + 1];
    const priceRaw = lines[idx + 2];
    const price = Math.round(parseFloat(priceRaw.replace('$', '')));

    for (let q = 0; q < qty; q++) {
      items.push({ name: currentPersonName, drink, price });
    }
  }

  return items.length > 0 ? { items, shopName, date } : null;
}

export function isKaitugoFormat(raw: string): boolean {
  return raw.includes('account_circle') && raw.includes('訂購人姓名：');
}

export function parseKaitugoText(raw: string): ParsedReceipt | null {
  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
  const items: ParsedItem[] = [];

  for (let i = 0; i < lines.length; i++) {
    const personMatch = lines[i].match(/account_circle\s+訂購人姓名：(.+)/);
    if (!personMatch) continue;
    const name = personMatch[1].trim();
    const optLine = i >= 1 ? lines[i - 1] : '';
    const drinkLine = i >= 2 ? lines[i - 2] : '';
    const priceMatch = optLine.match(/\$(\d+(?:\.\d+)?)/);
    if (!priceMatch || !drinkLine) continue;
    const price = Math.round(parseFloat(priceMatch[1]));
    if (price > 0) items.push({ name, drink: drinkLine, price });
  }

  return items.length > 0 ? { items, shopName: '' } : null;
}

// ＋收款 format: each person's block separated by ＋收款, name on first line
export function isKaitugoGroupFormat(raw: string): boolean {
  return raw.includes('＋收款');
}

export function parseKaitugoGroupText(raw: string): ParsedReceipt | null {
  // Split on ＋收款 (fullwidth plus + 收款)
  const sections = raw.split('＋收款').map((s) => s.trim()).filter(Boolean);
  const items: ParsedItem[] = [];

  for (const section of sections) {
    const lines = section.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length < 2) continue;

    // First line = person name (section header)
    const personName = lines[0]
      .replace(/\s*\(you\)\s*/i, '')
      .replace(/\s*\(您\)\s*/, '')
      .trim();
    if (!personName) continue;

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      // Item options line: contains $price / N份 where 份 directly follows digit (no space)
      // Section total lines use "N 份" (space before 份) and won't match
      const priceMatch = line.match(/\$(\d+(?:\.\d+)?)\s*\/\s*(\d+)份/);
      if (!priceMatch) continue;

      const price = Math.round(parseFloat(priceMatch[1]));
      const qty = parseInt(priceMatch[2]);
      if (price <= 0) continue;

      const prevLine = lines[i - 1] ?? '';
      if (!prevLine) continue;
      if (prevLine === personName) continue;
      if (/^\$\d/.test(prevLine)) continue;          // another price line
      if (/account_circle/.test(prevLine)) continue;

      for (let q = 0; q < qty; q++) {
        items.push({ name: personName, drink: prevLine, price });
      }
    }
  }

  return items.length > 0 ? { items, shopName: '' } : null;
}

export function isUberEatsReceiptText(raw: string): boolean {
  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
  for (let i = 1; i < lines.length; i++) {
    if (/^\d+$/.test(lines[i]) && i + 2 < lines.length && /^\$[\d.]+$/.test(lines[i + 2])) {
      return true;
    }
  }
  return false;
}
