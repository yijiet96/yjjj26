import puppeteer from "@cloudflare/puppeteer";

interface Env {
  MYBROWSER: Fetcher;
}

function parseCartSummaryText(text: string): { name: string; drink: string; price: number }[] {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const items: { name: string; drink: string; price: number }[] = [];

  // Pattern: lines with NT$XX or $XX prices indicate item lines
  // Participant name appears before their items
  // Format varies but price lines match /NT\$\d+/ or /\$\d+/
  let currentName = "";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Price line: "NT$45", "$45", "NT$ 45"
    const priceMatch = line.match(/(?:NT\$|NT\s*\$|\$)\s*(\d+(?:\.\d+)?)/);
    if (priceMatch && currentName) {
      const price = Math.round(parseFloat(priceMatch[1]));
      // Drink name is the previous non-empty line that isn't a quantity/option
      let drink = "";
      for (let j = i - 1; j >= 0 && j >= i - 3; j--) {
        const prev = lines[j];
        // Skip quantity lines like "1 ×", "x1", pure numbers
        if (/^[\d×x\s×]+$/.test(prev)) continue;
        // Skip option lines (short descriptors like "無糖, 微冰")
        if (prev.length < 3) continue;
        // Skip if it looks like another price
        if (/(?:NT\$|\$)\d+/.test(prev)) break;
        drink = prev;
        break;
      }
      if (drink && price > 0) {
        items.push({ name: currentName, drink, price });
      }
      continue;
    }

    // Quantity indicator: "1 ×", "2 ×" — next meaningful line is drink name
    if (/^\d+\s*[×x]/.test(line)) continue;

    // If line looks like a participant name (not a price, not a quantity, not options)
    // Heuristic: all-caps or no price, appears before items
    const isPriceLine = /(?:NT\$|\$)\d+/.test(line);
    const isQuantity = /^\d+\s*[×x]/.test(line);
    const isOption = /[,，]/.test(line) && line.length < 20;
    const isTotal = /(total|subtotal|小計|合計|總計)/i.test(line);

    if (!isPriceLine && !isQuantity && !isOption && !isTotal && line.length > 0 && line.length < 40) {
      // Check if next few lines contain a price — if so, this is likely a participant
      const hasNearbyPrice = lines.slice(i + 1, i + 6).some((l) =>
        /(?:NT\$|\$)\s*\d+/.test(l)
      );
      if (hasNearbyPrice) {
        currentName = line.replace(/\s*\(you\)\s*/i, "").replace(/\s*\(您\)\s*/, "").trim();
      }
    }
  }

  return items;
}

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  const urlParam = new URL(ctx.request.url).searchParams.get("url");
  const debug = new URL(ctx.request.url).searchParams.get("debug") === "1";

  if (!urlParam) {
    return Response.json({ error: "url parameter required" }, { status: 400 });
  }

  if (!urlParam.includes("ubereats.com") && !urlParam.includes("eats.uber.com")) {
    return Response.json({ error: "Must be a UberEats group order URL" }, { status: 400 });
  }

  let browser;
  try {
    browser = await puppeteer.launch(ctx.env.MYBROWSER);
    const page = await browser.newPage();

    await page.setViewport({ width: 390, height: 844 });
    await page.setUserAgent(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
    );

    // Use CDP to reliably capture response bodies (avoids body-already-consumed issue)
    const capturedResponses: { url: string; body: string }[] = [];
    const capturedRequests: { url: string; method: string; postData: string }[] = [];

    const cdpClient = await page.createCDPSession();
    await cdpClient.send("Network.enable");

    const pendingRequests = new Map<string, { url: string; postData: string; method: string }>();

    cdpClient.on("Network.requestWillBeSent", (params: any) => {
      const url: string = params.request.url;
      if (url.includes("getDraftOrder") || url.includes("getGroupOrder")) {
        const postData = params.request.postData ?? "";
        pendingRequests.set(params.requestId, { url, postData, method: params.request.method });
        capturedRequests.push({ url, method: params.request.method, postData });
      }
    });

    cdpClient.on("Network.loadingFinished", async (params: any) => {
      const req = pendingRequests.get(params.requestId);
      if (!req) return;
      pendingRequests.delete(params.requestId);
      try {
        const result: any = await cdpClient.send("Network.getResponseBody", { requestId: params.requestId });
        const body: string = result.base64Encoded
          ? Buffer.from(result.body, "base64").toString("utf-8")
          : result.body;
        if (body && body.length < 200000) capturedResponses.push({ url: req.url, body });
      } catch { /* ignore */ }
    });

    const targetUrl = urlParam.replace("eats.uber.com", "www.ubereats.com");
    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 25000 });
    await new Promise((r) => setTimeout(r, 3000));

    // Find name input using Puppeteer native selector
    const nameInputHandle = await page.$(
      'input[placeholder*="name" i], input[placeholder*="名"], input[type="text"]'
    );
    const inputFound: any = { found: false };

    if (nameInputHandle) {
      const ph = await page.evaluate((el) => el.placeholder, nameInputHandle);
      inputFound.found = true;
      inputFound.placeholder = ph;
      // Click to focus, clear, then type with real keypresses
      await nameInputHandle.click({ clickCount: 3 });
      await nameInputHandle.type("DrinkRun", { delay: 50 });
      inputFound.typed = true;
    }

    // Find the join button (not sign-in)
    const buttonClicked: any = { clicked: false };
    const allButtonTexts: string[] = await page.evaluate(() =>
      Array.from(document.querySelectorAll("button"))
        .map((b) => b.textContent?.trim() || "")
        .filter(Boolean)
    );
    buttonClicked.allButtons = allButtonTexts.slice(0, 10);

    // Find join button handle - prefer "Join order", avoid "Sign in"
    const joinBtnHandle = await page.evaluateHandle(() => {
      const buttons = Array.from(document.querySelectorAll("button"));
      return buttons.find((b) => {
        const text = (b.textContent || "").toLowerCase();
        const isSignIn = text.includes("sign in") || text.includes("log in") || text.includes("登入");
        return !isSignIn && (
          text.includes("join") || text.includes("加入") || text.includes("continue") || text.includes("繼續")
        );
      }) || null;
    });

    const joinBtnElement = joinBtnHandle.asElement();
    if (joinBtnElement) {
      const btnText = await page.evaluate((el) => el.textContent?.trim(), joinBtnElement);
      await joinBtnElement.click();
      buttonClicked.clicked = true;
      buttonClicked.text = btnText;
    }

    // Step 1: Wait for JOIN ORDER to complete
    const urlBefore = page.url();
    try {
      await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 8000 });
    } catch { /* SPA */ }
    await new Promise((r) => setTimeout(r, 3000));
    const urlAfter = page.url();

    // Step 2: Click "VIEW GROUP ORDER" button
    const viewGroupOrderClicked: any = { clicked: false };
    try {
      await page.waitForFunction(
        () => Array.from(document.querySelectorAll("button, a")).some((el) => {
          const text = (el.textContent || "").toLowerCase();
          return text.includes("view group") || text.includes("查看") || text.includes("view order");
        }),
        { timeout: 5000 }
      );
    } catch { /* button might not appear */ }

    const viewBtnHandle = await page.evaluateHandle(() => {
      const els = Array.from(document.querySelectorAll("button, a"));
      return els.find((el) => {
        const text = (el.textContent || "").toLowerCase();
        return text.includes("view group") || text.includes("view order") || text.includes("查看訂單") || text.includes("查看團購");
      }) || null;
    });

    const viewBtnEl = viewBtnHandle.asElement();
    if (viewBtnEl) {
      const viewBtnText = await page.evaluate((el) => el.textContent?.trim(), viewBtnEl);
      await viewBtnEl.click();
      viewGroupOrderClicked.clicked = true;
      viewGroupOrderClicked.text = viewBtnText;
      // Wait for order page to load
      try {
        await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 8000 });
      } catch { /* SPA */ }
      await new Promise((r) => setTimeout(r, 8000));
    }

    // Click-expand each member's panel, then parse full page text as a state machine
    const clickExpandResult = await page.evaluate(async (): Promise<{
      shopName: string;
      items: { name: string; drink: string; price: number }[];
      memberCount: number;
      debugLines: string[];
    }> => {
      const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
      const shopName =
        document.querySelector("h1")?.textContent?.trim() ||
        document.title?.split("|")[0]?.trim() || "";

      const UI_SKIP = new Set([
        "移除參加者", "前往結帳", "新增商品", "Remove participant", "Checkout",
        "DrinkRun", "Creator", "Adding items", "創建者", "新增餐點",
        "Ready", "Ordering", "正在新增商品",
      ]);

      // Phase 1: Click to expand collapsed panels.
      // KEY INSIGHT: click the COUNT/STATUS element DIRECTLY (not outer card).
      //   countEl.click() → event bubbles UP through all ancestors →
      //   triggers expand handler on whichever ancestor owns it.
      // Also: if panel already expanded (innerText has NT$ price), skip clicking
      //   to avoid toggling it CLOSED.
      const allEls = Array.from(document.querySelectorAll("span, div, li, p, h3, h4")) as HTMLElement[];
      const countEls = allEls.filter((el) => {
        const tc = (el.textContent || "").trim();
        return tc.length < 120 && /\d+\s*(items?|份餐點)/i.test(tc);
      });

      const clickedPersonCards = new Set<Element>();
      for (const countEl of countEls) {
        // Find the person-card boundary (myN=1, parentN>1) for deduplication
        let el: HTMLElement | null = countEl;
        let personCard: HTMLElement | null = null;
        while (el && el !== document.body) {
          const myN = ((el.textContent || "").match(/\d+\s*(items?|份餐點)/gi) || []).length;
          const parentN = ((el.parentElement?.textContent || "").match(/\d+\s*(items?|份餐點)/gi) || []).length;
          if (myN === 1 && parentN > 1) { personCard = el; break; }
          el = el.parentElement as HTMLElement | null;
        }
        if (!personCard || clickedPersonCards.has(personCard)) continue;
        clickedPersonCards.add(personCard);

        // Skip if panel already expanded (NT$ price visible in card's innerText)
        if (/^NT\$/m.test(personCard.innerText || "")) continue;

        // Click the STATUS/COUNT element so click bubbles up to row's expand handler
        countEl.scrollIntoView({ behavior: "instant", block: "center" });
        countEl.click();
        await sleep(700);
      }
      await sleep(1500);

      // Phase 2: Parse full expanded page text.
      // Confirmed page structure (from screenshot):
      //   Joeee
      //   正在新增商品 · 1 份餐點        ← role+count COMBINED on one line
      //   春青 Spring Tea               ← drink name (FIRST non-trivial line after count)
      //   份量 Size: 大杯 Large (NT$5.00) ← option
      //   飲品溫度 Beverage Temperature:  ← option (may split across lines)
      //   去冰 Ice-Free                  ← option fragment (no colon — backward look fails here)
      //   甜度 Sweetness Level: 無糖 Sugar-Free
      //   NT$45.00                      ← standalone price (the one we want)
      //   移除參加者
      //   白白
      //   正在新增商品 · 1 份餐點
      //   ...
      // FORWARD SCAN: drink = first non-trivial line after count line,
      //   price = next standalone "^NT$X.XX$" line. Avoids option-fragment confusion.
      const lines = (document.body.innerText || "").split("\n").map((l) => l.trim()).filter(Boolean);

      function isPersonSectionStart(idx: number): boolean {
        const line = lines[idx] || "";
        if (!line || line.length > 60) return false;
        if (/^NT\$/.test(line) || /^\d/.test(line) || /^[•·$]/.test(line)) return false;
        if (UI_SKIP.has(line)) return false;
        // Discard bilingual option lines ("份量 Size: ...", "甜度 Sweetness Level: ...")
        if (line.includes(":") && /[a-zA-Z]/.test(line) && /[一-鿿]/.test(line)) return false;
        // Count must appear within next 3 lines (handles combined "role · N份餐點" at la=1
        // and older separate-line format "Creator → • → N items" at la=3)
        for (let la = 1; la <= 3 && idx + la < lines.length; la++) {
          if (/\d+\s*(items?|份餐點)/i.test(lines[idx + la])) return true;
        }
        return false;
      }

      const gathered: { name: string; drink: string; price: number }[] = [];
      const seen = new Set<string>();
      let i = 0;

      while (i < lines.length) {
        if (!isPersonSectionStart(i)) { i++; continue; }

        const personName = lines[i].replace(/\s*\(you\)\s*/i, "").replace(/\s*\(您\)/g, "").trim();
        if (seen.has(personName)) { i++; continue; }
        seen.add(personName);

        // Advance to line after count line (within 3 lines)
        let countIdx = -1;
        for (let la = 1; la <= 3 && i + la < lines.length; la++) {
          if (/\d+\s*(items?|份餐點)/i.test(lines[i + la])) { countIdx = i + la; break; }
        }
        if (countIdx < 0) { i++; continue; }
        i = countIdx + 1;

        // FORWARD SCAN per item:
        //   1. First non-trivial line = drink name
        //   2. Scan forward for next standalone NT$ price
        //   3. Repeat for next item (multi-drink orders)
        while (i < lines.length) {
          if (isPersonSectionStart(i)) break;

          const line = lines[i];
          // Skip: empty, UI buttons, prices, bare numbers
          if (line.length < 2 || UI_SKIP.has(line) || /^NT\$/.test(line) || /^\d+$/.test(line)) {
            i++; continue;
          }

          // This is the drink name
          const drinkLine = line;
          i++;

          // Find its price: next standalone "NT$X.XX" line
          let itemPrice = 0;
          while (i < lines.length && !isPersonSectionStart(i)) {
            const pm = lines[i].match(/^NT\$\s*([\d.]+)\s*$/);
            if (pm) { itemPrice = Math.round(parseFloat(pm[1])); i++; break; }
            i++;
          }

          if (itemPrice > 0 && itemPrice <= 5000) {
            // Strip English translation suffix: "春青 Spring Tea" → "春青"
            const drink = drinkLine.replace(/\s+[A-Z][a-zA-Z\s&,()-]+$/, "").trim() || drinkLine;
            gathered.push({ name: personName, drink, price: itemPrice });
          }
        }
      }

      return { shopName, items: gathered, memberCount: clickedPersonCards.size, debugLines: lines.slice(0, 80) };
    });

    if (clickExpandResult.items.length > 0) {
      return Response.json({
        success: true,
        shopName: clickExpandResult.shopName,
        items: clickExpandResult.items,
      });
    }

    // Extract live Redux state from window (after client-side navigation)
    const stateData = await page.evaluate(() => {
      // Try static script tag first
      const el = document.getElementById("__REDUX_STATE__");
      if (el?.textContent) {
        try { return JSON.parse(el.textContent); } catch { /* ignore */ }
      }

      // Try to find the live Redux store on window
      const win = window as any;
      const candidates = [
        win.__REDUX_STATE__,
        win.__INITIAL_STATE__,
        win.__store__?.getState?.(),
        win.store?.getState?.(),
      ];
      for (const c of candidates) {
        if (c && typeof c === "object" && (c.groupOrder || c.draftOrder)) return c;
      }

      // Try finding Redux store through React internals
      try {
        const root = document.querySelector("#root") as any;
        const fiberKey = Object.keys(root || {}).find((k) => k.startsWith("__reactFiber") || k.startsWith("__reactInternalInstance"));
        if (fiberKey) {
          let fiber = (root as any)[fiberKey];
          let depth = 0;
          while (fiber && depth < 30) {
            const store = fiber?.memoizedProps?.store || fiber?.memoizedState?.store;
            if (store?.getState) return store.getState();
            fiber = fiber.child || fiber.return;
            depth++;
          }
        }
      } catch { /* ignore */ }

      return null;
    });

    // Try groupOrder state
    const groupOrder =
      stateData?.groupOrder?.usingV2?.data ||
      stateData?.groupOrder?.usingV1?.data;

    // Try draftOrders state (populated after joining)
    const draftOrders = stateData?.draftOrders?.draftOrders?.data;
    const draftOrder = stateData?.draftOrder?.draftOrder?.data;

    const orderSource = groupOrder || draftOrders?.[0] || draftOrder;

    if (orderSource) {
      const shopName =
        orderSource.store?.title ||
        orderSource.storeName ||
        orderSource.restaurantName ||
        stateData?.stores?.activeStore?.title ||
        "";

      const items: { name: string; drink: string; price: number }[] = [];
      const participants: any[] = orderSource.participants || orderSource.members || orderSource.carts || [];

      for (const p of participants) {
        const pName = p.name || p.displayName || p.participantName || p.eaterName || "Unknown";
        const cartItems: any[] =
          p.cartItems || p.items || p.cart?.items || p.shoppingCart?.items || [];
        for (const item of cartItems) {
          const drink = item.title || item.name || item.itemName || item.displayName || "";
          const rawPrice = item.price || item.totalPrice || item.amount || item.unitPrice || 0;
          const price = typeof rawPrice === "number"
            ? Math.round(rawPrice > 1000 ? rawPrice / 100 : rawPrice)
            : 0;
          if (drink) items.push({ name: pName, drink, price });
        }
      }

      if (items.length > 0) {
        return Response.json({ success: true, shopName, items });
      }
    }

    // Direct API call from within the page (uses session cookies, avoids event-listener race)
    const uuidMatch = urlParam.match(/group-orders\/([a-f0-9-]+)/);
    const groupOrderUuid = uuidMatch?.[1] ?? "";

    // Use captured request details to replicate the exact API call
    const directApiResult = await page.evaluate(async (
      uuid: string,
      capturedReqs: { url: string; method: string; postData: string }[]
    ) => {
      // Try to replicate a captured request first (exact method + body)
      for (const req of capturedReqs) {
        try {
          const opts: RequestInit = {
            method: req.method,
            credentials: "include",
            headers: { "content-type": "application/json" },
          };
          if (req.method === "POST" && req.postData) opts.body = req.postData;
          const res = await fetch(req.url, opts);
          if (!res.ok) continue;
          const text = await res.text();
          if (text.length > 10) return { url: req.url, body: text.substring(0, 8000) };
        } catch { /* try next */ }
      }
      // Fallback: try common GET/POST patterns
      const attempts = [
        { url: `/_p/api/getDraftOrderByUuidV2`, method: "POST", body: JSON.stringify({ uuid }) },
        { url: `/_p/api/getDraftOrderByUuidV1`, method: "POST", body: JSON.stringify({ uuid }) },
        { url: `/_p/api/getDraftOrderByUuidV2?uuid=${uuid}`, method: "GET", body: "" },
      ];
      for (const a of attempts) {
        try {
          const opts: RequestInit = { method: a.method, credentials: "include", headers: { "content-type": "application/json" } };
          if (a.body) opts.body = a.body;
          const res = await fetch(a.url, opts);
          if (!res.ok) continue;
          const text = await res.text();
          if (text.length > 10) return { url: a.url, body: text.substring(0, 8000) };
        } catch { /* try next */ }
      }
      return null;
    }, groupOrderUuid, capturedRequests);

    if (directApiResult?.body) {
      try {
        const json = JSON.parse(directApiResult.body);
        // UberEats wraps data differently per endpoint — try common paths
        const candidates = [
          json?.data,
          json?.data?.draftOrder,
          json?.data?.groupOrder,
          json?.status === "success" ? json?.data : null,
        ].filter(Boolean);

        for (const data of candidates) {
          const participants: any[] = data?.carts || data?.participants || data?.members || data?.cartViews || [];
          if (!participants.length) continue;
          const apiItems: { name: string; drink: string; price: number }[] = [];
          const apiShop = data?.store?.title || data?.storeName || data?.restaurant?.title || "";
          for (const p of participants) {
            const pName = (p.name || p.displayName || p.eaterName || p.participantName || "Unknown")
              .replace(/\s*\(you\)/i, "").replace(/\s*\(您\)/, "").trim();
            const cartItems: any[] = p.cartItems || p.items || p.cart?.items || p.shoppingCart?.cartItems || [];
            for (const item of cartItems) {
              const drink = item.title || item.name || item.itemName || item.catalogItem?.title || "";
              const raw = item.price || item.unitPrice || item.totalPrice || item.amount || 0;
              const price = Math.round(typeof raw === "number" ? (raw > 1000 ? raw / 100 : raw) : 0);
              if (drink) apiItems.push({ name: pName, drink, price });
            }
          }
          if (apiItems.length > 0) {
            return Response.json({ success: true, shopName: apiShop, items: apiItems });
          }
        }
      } catch { /* fall through */ }
    }

    // Grab page text early — needed for name matching in Strategy B
    const pageText = await page.evaluate(() => document.body.innerText);

    // Parse all captured CDP responses — primary extraction path
    for (const { url, body } of capturedResponses) {
      try {
        const json = JSON.parse(body);
        if (json?.status !== "success") continue;
        const root = json.data;

        // Strategy A: participants array (older API shape)
        const participantArrayCandidates: any[][] = [
          root?.carts, root?.participants, root?.members,
          root?.cartViews, root?.eaterCarts,
          root?.draftOrder?.carts, root?.draftOrder?.participants,
          root?.draftOrder?.eaterCarts,
          root?.draftOrders,
        ].filter(Array.isArray);

        for (const participants of participantArrayCandidates) {
          const apiItems: { name: string; drink: string; price: number }[] = [];
          const apiShop =
            root?.store?.title || root?.draftOrder?.store?.title ||
            root?.storeName || root?.draftOrder?.storeName || "";

          for (const p of participants) {
            const pName = (
              p.name || p.displayName || p.eaterName || p.participantName || p.firstName || "Unknown"
            ).replace(/\s*\(you\)/i, "").replace(/\s*\(您\)/, "").trim();

            const cartItems: any[] =
              p.cartItems || p.items || p.cart?.items ||
              p.shoppingCart?.items || p.shoppingCart?.cartItems || [];

            for (const item of cartItems) {
              const drink = item.title || item.name || item.itemName || item.catalogItem?.title || "";
              const raw = item.price || item.unitPrice || item.totalPrice || item.amount || 0;
              const price = Math.round(typeof raw === "number" ? (raw > 1000 ? raw / 100 : raw) : 0);
              if (drink) for (let q = 0; q < (item.quantity || 1); q++) apiItems.push({ name: pName, drink, price });
            }
          }
          if (apiItems.length > 0) {
            return Response.json({ success: true, shopName: apiShop, items: apiItems });
          }
        }

        // Strategy B: flat shoppingCart.items with consumerUuid (confirmed structure from debug)
        const draftOrder = root?.draftOrder;
        const flatItems: any[] = draftOrder?.shoppingCart?.items || [];
        if (flatItems.length > 0) {
          // Build consumerUuid → name map — try API fields first
          const eaterMap: Record<string, string> = {};
          const eaterSources: any[] = [
            ...(draftOrder?.eaterCarts || []),
            ...(draftOrder?.participants || []),
            ...(draftOrder?.carts || []),
            ...(draftOrder?.groupParticipants || []),
          ];
          for (const e of eaterSources) {
            const uuid =
              e.consumerUuid || e.uuid || e.eaterUuid ||
              e.participantUuid || e.userUuid;
            const name = (
              e.name || e.displayName || e.eaterName ||
              e.participantName || e.firstName || ""
            ).replace(/\s*\(you\)/i, "").replace(/\s*\(您\)/, "").trim();
            if (uuid && name) eaterMap[uuid] = name;
          }

          // Recursive tree walk — finds UUID→name regardless of field path
          // Runs after eaterSources fails, before falling back to page text
          {
            const byConsumerPeek: Record<string, any[]> = {};
            for (const item of flatItems) {
              const cid = item.consumerUuid || "unknown";
              (byConsumerPeek[cid] = byConsumerPeek[cid] || []).push(item);
            }
            const missUuids = new Set(Object.keys(byConsumerPeek).filter(id => id !== "unknown" && !eaterMap[id]));
            if (missUuids.size > 0) {
              (function walk(node: any, d: number): void {
                if (!node || typeof node !== "object" || d > 12) return;
                if (Array.isArray(node)) { for (const c of node) walk(c, d + 1); return; }
                const id = String(
                  node.consumerUuid ?? node.eaterUuid ?? node.participantUuid ??
                  node.userUuid ?? node.uuid ?? ""
                );
                if (missUuids.has(id)) {
                  const nm = String(
                    node.name ?? node.displayName ?? node.eaterName ??
                    node.participantName ?? node.firstName ?? ""
                  ).replace(/\s*\(you\)/i, "").replace(/\s*\(您\)/, "").trim();
                  if (nm) { eaterMap[id] = nm; missUuids.delete(id); }
                }
                for (const v of Object.values(node)) walk(v, d + 1);
              })(json, 0);
            }
          }

          const apiShop = draftOrder?.store?.title || draftOrder?.storeName || "";

          // Group flat items by consumerUuid, counting total quantity per person
          const byConsumer: Record<string, any[]> = {};
          for (const item of flatItems) {
            const cid = item.consumerUuid || "unknown";
            (byConsumer[cid] = byConsumer[cid] || []).push(item);
          }

          // Resolve UUID → name from pageText when API doesn't provide it
          if (Object.keys(eaterMap).length === 0 && pageText) {
            const pageLines = pageText.split("\n").map((l: string) => l.trim()).filter(Boolean);

            // Build {name → {count, drinks[]}} by detecting "N份餐點 / N items" after participant name
            const rw = new Set(["Creator", "Adding items", "創建者", "新增餐點", "Ready", "Ordering"]);
            const nameDrinkMap = new Map<string, { count: number; drinks: string[] }>();

            function extractDrinksFrom(startIdx: number): string[] {
              const out: string[] = [];
              for (let k = startIdx; k < Math.min(startIdx + 30, pageLines.length); k++) {
                const kl: string = pageLines[k];
                // Stop at next person section (role word or count on next line)
                if (rw.has(kl)) break;
                if (/(\d+)\s*(items?|份餐點)/i.test(kl)) break;
                if (/^DrinkRun$/i.test(kl)) break;
                if (k + 1 < pageLines.length) {
                  const nl: string = pageLines[k + 1];
                  if (rw.has(nl) || /(\d+)\s*(items?|份餐點)/i.test(nl)) break;
                }
                if (/^(NT\$|\$)\d+/.test(kl)) continue;
                if (/^\d+$/.test(kl) || /^[•·]$/.test(kl)) continue;
                if (/顯示更多內容|show more/i.test(kl)) continue;
                if (kl.length > 2) out.push(kl);
              }
              return out;
            }

            // Unified pattern: name with count indicator within next 3 lines
            // Handles both "name → N份餐點" and "name → 正在新增商品 · N份餐點" combined formats
            for (let i = 0; i < pageLines.length - 1; i++) {
              const pLine = pageLines[i] || "";
              if (!pLine || pLine.length > 60) continue;
              if (/^NT\$/.test(pLine) || /^\d/.test(pLine) || /^[•·$]/.test(pLine)) continue;
              if (rw.has(pLine) || /^DrinkRun$/i.test(pLine)) continue;
              if (pLine.includes(":") && /[a-zA-Z]/.test(pLine) && /[一-鿿]/.test(pLine)) continue;
              let cIdx = -1, cCount = 0;
              for (let la = 1; la <= 3 && i + la < pageLines.length; la++) {
                const m = pageLines[i + la].match(/(\d+)\s*(份餐點|items?)/i);
                if (m) { cIdx = i + la; cCount = parseInt(m[1]); break; }
              }
              if (cIdx < 0) continue;
              const rawName = pLine.replace(/\s*\(you\)/i, "").replace(/\s*\(您本人\)/g, "").replace(/\s*\(您\)/g, "").trim();
              if (!rawName || nameDrinkMap.has(rawName)) continue;
              nameDrinkMap.set(rawName, { count: cCount, drinks: extractDrinksFrom(cIdx + 1) });
            }

            // Pass 1: match UUID → name by drink name content
            for (const [uuid, uItems] of Object.entries(byConsumer)) {
              if (eaterMap[uuid]) continue;
              const uuidDrinks = uItems.map((it: any) =>
                (it.title || it.name || "").split("(")[0].trim()
              ).filter(Boolean);
              for (const [name, info] of nameDrinkMap.entries()) {
                if (Object.values(eaterMap).includes(name)) continue;
                if (!info.drinks.length) continue;
                const matched = uuidDrinks.some(ud =>
                  info.drinks.some(hd => {
                    const hdBase = hd.split("(")[0].trim();
                    return ud === hdBase || ud.includes(hdBase) || hdBase.includes(ud);
                  })
                );
                if (matched) { eaterMap[uuid] = name; break; }
              }
            }

            // Pass 2: count-based matching — only when count is unique on BOTH sides
            // (exactly 1 unmatched name has that count AND exactly 1 unmatched uuid group has that count)
            // Prevents random mismatches when multiple people share the same item count
            const unmatchedNames = [...nameDrinkMap.entries()].filter(([n]) => !Object.values(eaterMap).includes(n));
            const unmatchedUuids = Object.entries(byConsumer).filter(([u]) => !eaterMap[u]);

            const nameCountMap = new Map<number, string[]>();
            for (const [name, info] of unmatchedNames) {
              (nameCountMap.get(info.count) ?? nameCountMap.set(info.count, []).get(info.count)!).push(name);
            }
            const uuidCountMap = new Map<number, string[]>();
            for (const [uuid, uItems] of unmatchedUuids) {
              const qty = uItems.reduce((s: number, it: any) => s + (it.quantity || 1), 0);
              (uuidCountMap.get(qty) ?? uuidCountMap.set(qty, []).get(qty)!).push(uuid);
            }
            for (const [count, names] of nameCountMap.entries()) {
              if (names.length !== 1) continue;           // ambiguous: multiple names with this count
              const uuids = uuidCountMap.get(count) ?? [];
              if (uuids.length !== 1) continue;           // ambiguous: multiple uuid groups with this count
              eaterMap[uuids[0]] = names[0];
            }
          }

          const apiItems: { name: string; drink: string; price: number }[] = [];
          for (const [consumerUuid, items] of Object.entries(byConsumer)) {
            const name = eaterMap[consumerUuid] || `?${consumerUuid.substring(0, 6)}`;
            for (const item of items) {
              // Strip English translation from title (e.g. "春青菊花 Spring Tea & ..." → "春青菊花")
              const rawTitle: string = item.title || item.name || "";
              const drink = rawTitle.replace(/\s+[A-Z][a-zA-Z &]+.*$/, "").trim() || rawTitle;
              // Price: use totalPrice if present, else base + customization upcharges
              const totalRaw: number = item.totalPrice || item.totalCost || 0;
              const baseRaw: number = item.price || 0;
              // customizations is a dict-of-arrays {uuid+N: [{price, quantity}]}, NOT a flat array
              let customRaw = 0;
              const customs = item.customizations;
              if (customs && typeof customs === "object" && !Array.isArray(customs)) {
                for (const group of Object.values(customs as Record<string, any[]>)) {
                  if (Array.isArray(group)) {
                    for (const c of group) customRaw += (c.price || 0) * (c.quantity || 1);
                  }
                }
              } else if (Array.isArray(customs)) {
                customRaw = customs.reduce((s: number, c: any) => s + (c.price || c.unitPrice || 0), 0);
              }
              const priceInCents = totalRaw > 0 ? totalRaw : (baseRaw + customRaw);
              const price = Math.round(priceInCents / 100);
              if (drink) for (let q = 0; q < (item.quantity || 1); q++) apiItems.push({ name, drink, price });
            }
          }

          if (apiItems.length > 0) {
            return Response.json({ success: true, shopName: apiShop, items: apiItems });
          }
        }
      } catch { /* not parseable JSON */ }
    }

    // Try DOM extraction using UberEats cart-summary structure
    const domItems = await page.evaluate(() => {
      const results: { name: string; drink: string; price: number }[] = [];

      // Collect all data-testid values for debugging
      const testIds = Array.from(new Set(
        Array.from(document.querySelectorAll("[data-testid]"))
          .map((el) => (el as HTMLElement).dataset.testid || "")
          .filter(Boolean)
      )).slice(0, 40);

      // Strategy 1: data-testid based (known UberEats patterns)
      const participantSelectors = [
        "[data-testid*='participant']",
        "[data-testid*='cart-member']",
        "[data-testid*='group-member']",
        "[data-testid*='eater']",
      ];
      for (const sel of participantSelectors) {
        const sections = document.querySelectorAll(sel);
        if (sections.length === 0) continue;
        for (const section of sections) {
          const nameEl = section.querySelector("[data-testid*='name'], [data-testid*='title'], h3, h4, strong");
          const name = nameEl?.textContent?.replace(/\s*\(you\)\s*/i, "").replace(/\s*\(您\)\s*/, "").trim() || "";
          if (!name) continue;
          const itemEls = section.querySelectorAll("[data-testid*='item'], li");
          for (const itemEl of itemEls) {
            const drinkEl = itemEl.querySelector("[data-testid*='title'], [data-testid*='name'], span:first-child");
            const priceEl = itemEl.querySelector("[data-testid*='price'], span:last-child");
            const drink = drinkEl?.textContent?.trim() || "";
            const priceText = priceEl?.textContent?.trim() || "";
            const priceMatch = priceText.match(/[\d.]+/);
            const price = priceMatch ? Math.round(parseFloat(priceMatch[0])) : 0;
            if (drink && price > 0) results.push({ name, drink, price });
          }
        }
        if (results.length > 0) return { items: results, testIds };
      }

      // Strategy 2: walk all price elements, look for nearby name context
      const priceEls = Array.from(document.querySelectorAll("span, div, p"))
        .filter((el) => /^\$[\d.]+$/.test((el as HTMLElement).innerText?.trim() || ""));

      for (const priceEl of priceEls) {
        const priceText = (priceEl as HTMLElement).innerText?.trim() || "";
        const price = Math.round(parseFloat(priceText.replace("$", "")));
        if (price <= 0) continue;

        // Walk up to find item container
        let container = priceEl.parentElement;
        for (let i = 0; i < 4 && container; i++) {
          const text = (container as HTMLElement).innerText || "";
          const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
          // Need at least name + drink + price
          if (lines.length >= 2) {
            const drink = lines.find((l) => !l.startsWith("$") && l.length > 2 && !/^\d+$/.test(l)) || "";
            if (drink) {
              // Find participant name by walking up further
              let nameContainer = container.parentElement;
              for (let j = 0; j < 5 && nameContainer; j++) {
                const nc = nameContainer as HTMLElement;
                // Look for a heading-like element sibling or child
                const heading = nc.querySelector("h2, h3, h4, strong");
                if (heading) {
                  const name = heading.textContent?.replace(/\s*\(you\)\s*/i, "").replace(/\s*\(您\)\s*/, "").trim() || "";
                  if (name && name !== drink) {
                    results.push({ name, drink, price });
                    break;
                  }
                }
                nameContainer = nameContainer.parentElement;
              }
              break;
            }
          }
          container = container.parentElement;
        }
      }

      return { items: results, testIds };
    });

    if (domItems.items.length > 0) {
      const shopName = await page.evaluate(() =>
        document.querySelector("h1")?.textContent?.trim() ||
        document.title?.split("|")[0]?.trim() || ""
      );
      return Response.json({ success: true, shopName, items: domItems.items });
    }

    // Parse cart-summary text for order items
    const items = parseCartSummaryText(pageText);
    const shopName = await page.evaluate(() =>
      document.querySelector("h1")?.textContent?.trim() ||
      document.title?.split("|")[0]?.trim() || ""
    );

    if (items.length > 0) {
      return Response.json({ success: true, shopName, items });
    }

    let screenshot: string | null = null;
    if (debug) {
      const screenshotBuf = await page.screenshot({ encoding: "base64", type: "jpeg", quality: 60 });
      screenshot = `data:image/jpeg;base64,${screenshotBuf}`;
    }

    return Response.json({
      success: false,
      fallback: true,
      v: "20260526-v14",
      pageText: pageText.substring(0, 3000),
      screenshot,
      debug: {
        inputFound,
        buttonClicked,
        urlBefore,
        urlAfter,
        urlFinal: page.url(),
        viewGroupOrderClicked,
        hasGroupOrderState: !!groupOrder,
        hasDraftOrderState: !!draftOrder,
        stateKeys: stateData ? Object.keys(stateData) : null,
        capturedApiUrls: capturedResponses.map((r) => r.url),
        capturedResponseCount: capturedResponses.length,
        capturedResponseSample: capturedResponses[0]?.body?.substring(0, 5000) ?? null,
        clickExpandMemberCount: clickExpandResult.memberCount,
        clickExpandItemCount: clickExpandResult.items.length,
        clickExpandDebugLines: clickExpandResult.debugLines,
        capturedRequests: capturedRequests.map((r) => ({ url: r.url, method: r.method, postData: r.postData.substring(0, 200) })),
        directApiUrl: directApiResult?.url ?? null,
        directApiSample: directApiResult?.body?.substring(0, 2000) ?? null,
        pageTextSample: pageText.substring(0, 500),
        domTestIds: domItems.testIds,
      },
    });
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500 });
  } finally {
    if (browser) await browser.close();
  }
};
