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

    // Intercept API responses to find order data
    const capturedResponses: { url: string; body: string }[] = [];
    page.on("response", async (response) => {
      const url = response.url();
      if (
        url.includes("/api/") &&
        (url.includes("getDraftOrder") || url.includes("cart") || url.includes("group"))
      ) {
        try {
          const body = await response.text();
          if (body.length < 50000) capturedResponses.push({ url, body });
        } catch { /* ignore */ }
      }
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

    const directApiResult = groupOrderUuid ? await page.evaluate(async (uuid) => {
      const endpoints = [
        `/_p/api/getDraftOrderByUuidV2?uuid=${uuid}`,
        `/_p/api/getDraftOrderByUuidV1?uuid=${uuid}`,
        `/_p/api/getGroupOrderV1?uuid=${uuid}`,
      ];
      for (const ep of endpoints) {
        try {
          const res = await fetch(ep, { credentials: "include" });
          if (!res.ok) continue;
          const text = await res.text();
          return { url: ep, body: text.substring(0, 8000) };
        } catch { /* try next */ }
      }
      return null;
    }, groupOrderUuid) : null;

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

    // Try parsing captured network responses as fallback
    for (const { body } of capturedResponses) {
      try {
        const json = JSON.parse(body);
        const data = json?.data || (json?.status === "success" ? json?.data : null);
        const participants = data?.carts || data?.participants || data?.members || data?.cartViews;
        if (participants?.length) {
          const apiItems: { name: string; drink: string; price: number }[] = [];
          const apiShop = data?.store?.title || data?.storeName || "";
          for (const p of participants) {
            const pName = (p.name || p.displayName || p.eaterName || p.participantName || "Unknown")
              .replace(/\s*\(you\)/i, "").trim();
            const cartItems = p.cartItems || p.items || p.cart?.items || p.shoppingCart?.cartItems || [];
            for (const item of cartItems) {
              const drink = item.title || item.name || item.itemName || item.catalogItem?.title || "";
              const raw = item.price || item.unitPrice || item.totalPrice || item.amount || 0;
              const price = Math.round(raw > 1000 ? raw / 100 : raw);
              if (drink) apiItems.push({ name: pName, drink, price });
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

    // Extract page text from cart-summary
    const pageText = await page.evaluate(() => document.body.innerText);

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
