export interface ParsedItem {
  name: string;
  drink: string;
  price: number;
}

export interface ParsedReceipt {
  items: ParsedItem[];
  shopName: string;
}

export function parseUberEatsReceiptText(raw: string): ParsedReceipt | null {
  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);

  // Find item blocks: a standalone integer at index i where lines[i+2] starts with $
  const quantityIndices: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    if (/^\d+$/.test(lines[i]) && i + 2 < lines.length && /^\$[\d.]+$/.test(lines[i + 2])) {
      quantityIndices.push(i);
    }
  }

  if (quantityIndices.length === 0) return null;

  const items: ParsedItem[] = [];
  for (let qi = 0; qi < quantityIndices.length; qi++) {
    const idx = quantityIndices[qi];
    const rawName = lines[idx - 1];
    const name = rawName.replace(/\s*\(您\)\s*/, '').trim();
    const qty = parseInt(lines[idx], 10);
    const drink = lines[idx + 1];
    const priceRaw = lines[idx + 2];
    let price = Math.round(parseFloat(priceRaw.replace('$', '')));

    // Add-ons: lines between this price line and next block (exclusive of name line of next block)
    const nextNameIdx =
      qi + 1 < quantityIndices.length ? quantityIndices[qi + 1] - 1 : lines.length;
    for (let j = idx + 3; j < nextNameIdx; j++) {
      const m = lines[j].match(/\(\$(\d+(?:\.\d+)?)\)/);
      if (m) price += Math.round(parseFloat(m[1]));
    }

    for (let q = 0; q < qty; q++) {
      items.push({ name, drink, price });
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
