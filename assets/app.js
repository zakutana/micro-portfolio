/* Micro portfolio – page logic (no build step, no dependencies). */
(() => {
  "use strict";

  const icons = window.MICRO_ICONS || {}; // decorative only: the page must still work if icons.js failed to load
  const root = document.documentElement;
  const PAGE_ID = root.dataset.id; // fixed per page, set in its index.html
  const DEFAULT_THEME = root.dataset.theme;
  let cfg = null; // { passHash, holdings, ... } – loaded fresh from config.json on every visit
  let holdings = []; // the holdings that are actually owned (quantity > 0)

  const THEMES = [
    { id: "minecraft", label: "Minecraft", color: "#4a3322" },
    { id: "kirby", label: "Kirby", color: "#ffbfdf" },
    { id: "waddle", label: "Waddle Dee", color: "#3a56d8" },
    { id: "pokemon", label: "Pokémon", color: "#f43f3f" },
    { id: "makeup", label: "Make-up", color: "#ffc9e0" },
    { id: "football", label: "Fotbal", color: "#2f9440" },
    { id: "trader", label: "Trader", color: "#0d1118" },
  ];

  const COINGECKO = "https://api.coingecko.com/api/v3";
  const DEXSCREENER = "https://api.dexscreener.com/tokens/v1";
  const FX_URLS = [
    "https://open.er-api.com/v6/latest/USD",
    "https://api.frankfurter.dev/v1/latest?base=USD&symbols=CZK",
  ];
  const REFRESH_MS = 60_000;

  const NS = `micro-portfolio:${PAGE_ID}`;
  const store = {
    get(key) {
      try {
        return localStorage.getItem(`${NS}:${key}`);
      } catch {
        return null;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(`${NS}:${key}`, value);
      } catch {
        /* private mode etc. – the page still works, it just won't remember */
      }
    },
  };

  /* ---------- Theme (applied immediately, before first paint) ---------- */

  const themeById = (id) => THEMES.find((t) => t.id === id);

  function currentTheme() {
    const saved = store.get("theme");
    if (themeById(saved)) return saved;
    return themeById(DEFAULT_THEME) ? DEFAULT_THEME : THEMES[0].id;
  }

  function applyTheme(id) {
    root.dataset.theme = id;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = themeById(id).color;
    const fill = (elId, set, key = id) => {
      const node = document.getElementById(elId);
      if (node) node.innerHTML = (set || {})[key] || "";
    };
    fill("mascot", window.MICRO_PEEK);
    fill("total-icon", window.MICRO_TOTAL);
    fill("theme-toggle", icons);
    const marks = window.MICRO_MARKS || {};
    fill("brand-mark", marks, id in marks ? id : "_chart");
    document.querySelectorAll(".theme-btn").forEach((btn) => {
      btn.setAttribute("aria-pressed", String(btn.dataset.theme === id));
    });
  }

  applyTheme(currentTheme());

  /* ---------- Config (never served from the browser cache) ---------- */

  async function loadConfig() {
    try {
      const res = await fetch("config.json", { cache: "no-cache" }); // always revalidates with the server
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      store.set("config", JSON.stringify(data));
      return data;
    } catch {
      try {
        return JSON.parse(store.get("config")); // offline: last config we saw
      } catch {
        return null;
      }
    }
  }

  /* ---------- Password (typed once, then remembered on the phone) ---------- */

  const PBKDF2_ITERATIONS = 200_000; // slow on purpose, so guessing a short password costs real time

  async function deriveHash(password) {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", hash: "SHA-256", salt: enc.encode(`micro-portfolio:${PAGE_ID}`), iterations: PBKDF2_ITERATIONS },
      key,
      256,
    );
    return Array.from(new Uint8Array(bits), (b) => b.toString(16).padStart(2, "0")).join("");
  }

  /* What the phone remembers is the page's password hash itself: a changed password locks the page again. */
  const isUnlocked = () => typeof cfg.passHash === "string" && store.get("auth") === cfg.passHash;

  /* The page data could not be loaded at all (no signal): say so and offer to try again. */
  function showLoadError() {
    const lock = $("lock");
    lock.replaceChildren();
    const icon = el("div", "lock-icon", "\u{1F4F6}");
    icon.setAttribute("aria-hidden", "true");
    const retry = el("button", "pw-btn", "Zkusit znovu");
    retry.type = "button";
    retry.addEventListener("click", () => location.reload());
    const form = el("div", "pw-form");
    form.append(retry);
    lock.append(
      icon,
      el("h2", "", "Stránka se nenačetla"),
      el("p", "", "Zkontroluj, jestli máš internet, a zkus to znovu."),
      form,
    );
    lock.hidden = false;
    setHero(true);
  }

  function showLock(onUnlock) {
    const lock = $("lock");
    lock.replaceChildren();
    const name = (new URLSearchParams(location.search).get("n") || "").trim().slice(0, 30);

    const icon = el("div", "lock-icon", "\u{1F512}");
    icon.setAttribute("aria-hidden", "true");
    const title = el("h2", "", name ? `Ahoj ${name}!` : "Tahle stránka je jen pro tebe");
    const hint = el("p", "", "Napiš heslo z kartičky. Stačí jednou, příště se stránka otevře sama.");

    const form = el("form", "pw-form");
    const input = el("input", "pw-input");
    input.id = "pw";
    input.type = "text";
    input.maxLength = 12;
    input.autocomplete = "off";
    input.autocapitalize = "none";
    input.spellcheck = false;
    input.setAttribute("autocorrect", "off");
    input.setAttribute("aria-label", "Heslo");
    input.placeholder = "•••••";
    const button = el("button", "pw-btn", "Odemknout");
    button.type = "submit";
    const message = el("p", "pw-message");
    message.setAttribute("aria-live", "polite");
    form.append(input, button, message);
    lock.append(icon, title, hint, form);

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const password = input.value.trim().toLowerCase();
      if (!password) return;
      button.disabled = true;
      message.className = "pw-message";
      message.textContent = "Kontroluju…";
      try {
        if (!(window.crypto && crypto.subtle)) throw new Error("no WebCrypto");
        if ((await deriveHash(password)) === cfg.passHash) {
          store.set("auth", cfg.passHash);
          lock.hidden = true;
          setHero(false);
          await onUnlock();
          return;
        }
        message.classList.add("is-error");
        message.textContent = "Tohle heslo nesedí. Zkus to znovu.";
        input.select();
      } catch {
        message.classList.add("is-error");
        message.textContent = "Něco se pokazilo. Obnov stránku a zkus to znovu.";
      } finally {
        button.disabled = false;
      }
    });

    lock.hidden = false;
    setHero(true);
    input.focus();
  }

  /* The owner's name travels in the QR link (?n=...), so it never has to live in the repo. */
  let ownerName = "";
  function showOwner() {
    const fromUrl = new URLSearchParams(location.search).get("n");
    if (fromUrl) store.set("name", fromUrl.trim().slice(0, 30));
    ownerName = store.get("name") || "";
    if (ownerName) document.title = `Micro portfolio · ${ownerName}`;
  }

  /* The figure looking over the top of the first card only makes sense while that card is there. */
  function setHero(on) {
    $("stage").classList.toggle("has-hero", on);
  }

  /* ---------- Prices (all converted to CZK) ---------- */

  async function getJsonOnce(url, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal, cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  /* The free price APIs occasionally hiccup (rate limits, flaky network): try once more before giving up. */
  async function getJson(url, timeoutMs = 10_000) {
    try {
      return await getJsonOnce(url, timeoutMs);
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      return getJsonOnce(url, timeoutMs);
    }
  }

  const isPrice = (n) => typeof n === "number" && Number.isFinite(n) && n > 0;

  async function fetchUsdCzk() {
    for (const url of FX_URLS) {
      try {
        const data = await getJson(url);
        if (isPrice(data?.rates?.CZK)) return data.rates.CZK;
      } catch {
        /* try the next provider */
      }
    }
    return null;
  }

  async function fetchCoinGecko(ids) {
    if (!ids.length) return new Map();
    const url = `${COINGECKO}/coins/markets?vs_currency=czk&per_page=250&ids=${encodeURIComponent(ids.join(","))}`;
    try {
      const rows = await getJson(url);
      return new Map(
        rows
          .filter((r) => isPrice(r.current_price))
          .map((r) => [r.id, { price: r.current_price, change24: r.price_change_percentage_24h, marketCap: r.market_cap }]),
      );
    } catch {
      return new Map();
    }
  }

  /* Tokenised stocks (e.g. RoboStrategy BOT) and other on-chain tokens, priced in USD. */
  async function fetchDex({ chain, address }) {
    try {
      const pairs = await getJson(`${DEXSCREENER}/${chain}/${address}`);
      const best = pairs
        .filter((p) => p.baseToken?.address?.toLowerCase() === address.toLowerCase())
        .filter((p) => isPrice(Number(p.priceUsd)))
        .sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
      return best ? { usd: Number(best.priceUsd), change24: best.priceChange?.h24 } : null;
    } catch {
      return null;
    }
  }

  const sourceKey = (h) =>
    h.source.type === "coingecko"
      ? `cg:${h.source.id}`
      : h.source.type === "fixed"
        ? `fixed:${h.symbol}`
        : `dex:${h.source.chain}:${h.source.address}`;
  // not traded yet: a price written into config.json by hand, "priceCzk" or "priceUsd" (converted at the live rate)
  const isFixed = (h) => h.source.type === "fixed";

  function readCache() {
    try {
      return JSON.parse(store.get("prices")) ?? {};
    } catch {
      return {};
    }
  }

  async function loadPrices() {
    const cache = readCache();
    const cachedPrices = cache.prices ?? {};
    const dexHoldings = holdings.filter((h) => h.source.type === "dexscreener");
    const needsFx = dexHoldings.length > 0 || holdings.some((h) => isFixed(h) && isPrice(h.source.priceUsd));
    const cgIds = [...new Set(holdings.filter((h) => h.source.type === "coingecko").map((h) => h.source.id))];

    const [cg, fxLive, ...dex] = await Promise.all([
      fetchCoinGecko(cgIds),
      needsFx ? fetchUsdCzk() : null,
      ...dexHoldings.map((h) => fetchDex(h.source)),
    ]);
    const fx = fxLive ?? cache.fx ?? null;
    const dexByKey = new Map(dexHoldings.map((h, i) => [sourceKey(h), dex[i]]));

    const fresh = {};
    const items = holdings.map((h) => {
      const key = sourceKey(h);
      let price = null;
      let change24 = null;
      let marketCap = null;
      if (h.source.type === "coingecko") {
        const hit = cg.get(h.source.id);
        price = hit?.price ?? null;
        change24 = hit?.change24 ?? null;
        marketCap = hit?.marketCap ?? null;
      } else if (isFixed(h)) {
        if (isPrice(h.source.priceCzk)) price = h.source.priceCzk;
        else if (isPrice(h.source.priceUsd) && isPrice(fx)) price = h.source.priceUsd * fx;
      } else {
        const hit = dexByKey.get(key);
        if (hit && isPrice(hit.usd) && isPrice(fx)) {
          price = hit.usd * fx;
          change24 = hit.change24 ?? null;
          // a tokenised stock: market cap of the company = live price x shares outstanding (set in config.json)
          if (isPrice(h.sharesOutstanding)) marketCap = price * h.sharesOutstanding;
        }
      }
      const cap = isPrice(marketCap) ? marketCap : null;
      if (isPrice(price)) {
        if (!isFixed(h)) fresh[key] = price; // a hand-written price is not "fetched": it must not move the last-success time
        return { holding: h, price, change24: Number.isFinite(change24) ? change24 : null, marketCap: cap, live: true };
      }
      const stale = cachedPrices[key];
      return { holding: h, price: isPrice(stale) ? stale : null, change24: null, marketCap: null, live: false };
    });

    const gotSomething = Object.keys(fresh).length > 0;
    const ts = gotSomething ? Date.now() : cache.ts ?? null; // time of the last SUCCESSFUL fetch, not the last attempt
    store.set("prices", JSON.stringify({ prices: { ...cachedPrices, ...fresh }, fx: fx ?? null, ts }));
    return { items, allLive: items.every((i) => i.live), cachedAt: gotSomething ? null : ts };
  }

  /* ---------- Formatting ---------- */

  const nf = (opts) => new Intl.NumberFormat("cs-CZ", opts);
  const czk0 = nf({ style: "currency", currency: "CZK", minimumFractionDigits: 0, maximumFractionDigits: 0 });
  const czk2 = nf({ style: "currency", currency: "CZK", maximumFractionDigits: 2 });
  const formatCzk = (v) => (Math.round(v * 100) / 100 < 100 ? czk2 : czk0).format(v); // 99,998 -> "100 Kč"
  const MINUS = "−";

  /* Price of one unit: more decimals for cheap things. */
  function formatUnitPrice(v) {
    const digits = v >= 1000 ? 0 : v >= 1 ? 2 : 4;
    return `${nf({ minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v)} Kč`;
  }
  /* Always millions or billions (mil. / mld.), never "bil.": it is easy to misread as "billion". */
  function formatBig(v) {
    for (const [n, label] of [[1e9, "mld."], [1e6, "mil."]]) {
      if (v >= n) {
        const x = v / n;
        return `${nf({ maximumFractionDigits: x >= 100 ? 0 : 1 }).format(x)} ${label} Kč`;
      }
    }
    return formatCzk(v);
  }
  const formatQty = (q) => nf({ maximumFractionDigits: 4 }).format(q);

  function formatPct(ratio, { signed = true } = {}) {
    const abs = Math.abs(ratio * 100);
    const digits = abs < 1 ? 2 : 1;
    const text = nf({ minimumFractionDigits: digits, maximumFractionDigits: digits }).format(abs);
    const sign = !signed ? "" : ratio * 100 >= 0.005 ? "+" : ratio * 100 <= -0.005 ? MINUS : "";
    return `${sign}${text} %`;
  }
  function formatSignedCzk(v) {
    const sign = v >= 0.005 ? "+" : v <= -0.005 ? MINUS : "";
    return `${sign}${formatCzk(Math.abs(v))}`;
  }
  const trend = (ratio) => (ratio * 100 >= 0.005 ? "up" : ratio * 100 <= -0.005 ? "down" : "flat");
  const ARROW = { up: "▲", down: "▼", flat: "▬" };

  /* "2026-10-10" or a full ISO timestamp -> "10. 10. 2026" */
  const formatDate = (iso) =>
    new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString("cs-CZ", {
      day: "numeric",
      month: "numeric",
      year: "numeric",
    });
  function todayIso() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  const $ = (id) => document.getElementById(id);

  /* "1 234 Kč" -> the number plus a separate "Kč": a theme can set the currency in a plainer font
     (some of the playful display fonts lack Czech letters like č). */
  function moneyNode(text) {
    const box = document.createElement("span");
    const m = /^(.*?)[\s\u00a0]*Kč$/.exec(text);
    if (!m) {
      box.textContent = text;
      return box;
    }
    box.append(document.createTextNode(`${m[1]}\u00a0`), el("span", "cur", "Kč"));
    return box;
  }
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  /* ---------- Purchases: quantity, cost and start date of each holding ---------- */

  function position(h) {
    if (Array.isArray(h.lots)) {
      const lots = h.lots.filter((l) => l.qty > 0 && l.price > 0);
      const qty = lots.reduce((a, l) => a + l.qty, 0);
      const cost = lots.reduce((a, l) => a + l.qty * l.price, 0);
      const since = lots.map((l) => l.date).filter(Boolean).sort()[0] ?? null;
      return { qty, cost: qty ? cost : null, since };
    }
    return { qty: h.qty ?? 0, cost: null, since: null };
  }

  /* ---------- Rendering ---------- */

  function logoNode(h) {
    const box = el("span", "logo");
    const initial = () => {
      box.textContent = h.name.trim().charAt(0).toUpperCase();
    };
    if (!h.logo) {
      initial();
      return box;
    }
    const img = document.createElement("img");
    img.src = h.logo;
    img.alt = "";
    img.loading = "lazy";
    img.decoding = "async";
    img.addEventListener("error", () => {
      img.remove();
      initial();
    });
    box.append(img);
    return box;
  }

  const ALLOC_COLORS = 8; // --a1 ... --a8 in style.css: every theme has its own palette
  const allocColor = (i) => `var(--a${(i % ALLOC_COLORS) + 1})`;
  const DETAIL_CELLS = [
    ["price", "Cena za kus"],
    ["qty", "Kusů"],
    ["avg", "Nákupní cena"],
    ["pl", "Zisk / ztráta"],
    ["today", "Za 24 hodin"],
    ["share", "Podíl"],
    ["cap", "Tržní kapitalizace"],
  ];
  const GLOSSARY = [
    ["Cena za kus", "Kolik stojí jedna jednotka právě teď. Mění se každou chvíli."],
    ["Nákupní cena", "Průměrná cena, za kterou byly ty kusy koupené. Když nakoupíš ve dvou dnech za různé ceny, spočítá se průměr."],
    ["Zisk / ztráta", "Rozdíl mezi dnešní hodnotou a tím, co sis do toho vložila. Plus znamená, že to roste, minus, že je to teď míň. Dokud nic neprodáš, je to jen na papíře."],
    ["Za 24 hodin", "O kolik se cena změnila za poslední den. Jeden špatný den ještě nic neznamená."],
    ["Tržní kapitalizace", "Kolik by stála všechna ta mince nebo všechny akcie firmy dohromady. Větší je obvykle stabilnější a menší může kolísat víc."],
    ["Podíl", "Kolik procent celého portfolia tvoří tahle položka. Když je peníze rozložené do víc věcí, jedna špatná zpráva nepokazí všechno."],
  ];

  let rowRefs = [];
  let perfRefs = null;

  function buildList() {
    const list = $("list");
    list.replaceChildren();
    rowRefs = [];
    for (const h of holdings) {
      const li = el("li");
      const a = el("a", "row");
      a.href = h.url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.setAttribute("aria-label", `${h.name} – otevřít web`);

      const name = el("span", "name");
      name.append(el("strong", "", h.name), el("small", "", h.note ? `${h.symbol} · ${h.note}` : h.symbol));

      const value = el("span", "value is-loading", "…");
      a.append(logoNode(h), name, value);

      const detail = el("div", "detail");
      const cells = {};
      for (const [key, label] of DETAIL_CELLS) {
        const cell = el("div", key === "cap" ? "cell wide" : "cell");
        const v = el("span", "v", "—");
        cell.append(el("span", "k", label), v);
        detail.append(cell);
        cells[key] = v;
      }
      cells.plMoney = el("span", "money");
      cells.plChip = el("span", "chip");
      cells.pl.replaceChildren(cells.plMoney, cells.plChip);

      li.append(a, detail);
      list.append(li);
      rowRefs.push({ li, value, cells });
    }
  }

  function buildPerf() {
    const box = el("section", "panel perf");
    box.hidden = true;
    const cap = el("div", "perf-cap");
    const gain = el("div", "perf-gain");
    const num = el("b", "perf-num");
    const unit = el("span", "perf-unit");
    gain.append(num, unit);
    const pills = el("div", "perf-pills");
    const bar = el("div", "alloc-bar");
    bar.setAttribute("aria-hidden", "true");

    const pro = el("div", "pro-only perf-pro");
    const allocTitle = el("div", "alloc-title", "Z čeho se portfolio skládá");
    const legend = el("div", "alloc-legend");
    pro.append(allocTitle, legend);

    box.append(cap, gain, pills, bar, pro);
    $("content").prepend(box);
    perfRefs = { box, cap, num, unit, pills, bar, legend };
  }

  /* Purchase history: every purchase is a "block"; the first one is the genesis block.
     The holdings, the cost and the growth are all calculated from these same records. */
  function buildHistory() {
    const lots = [];
    for (const h of Array.isArray(cfg.holdings) ? cfg.holdings : []) {
      if (!h || !Array.isArray(h.lots)) continue;
      for (const l of h.lots) if (l.qty > 0 && l.price > 0 && typeof l.date === "string") lots.push({ h, ...l });
    }
    if (!lots.length) return;

    // purchases recorded within the same minute belong to one block
    const byDate = new Map();
    for (const l of lots) {
      const key = l.date.slice(0, 16);
      if (!byDate.has(key)) byDate.set(key, []);
      byDate.get(key).push(l);
    }
    const blocks = [...byDate.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)); // oldest first: #0 = genesis

    const box = el("details", "panel history");
    box.open = true;
    box.append(el("summary", "", "Historie nákupů"));
    const list = el("ol", "blocks");
    blocks
      .map(([, items], i) => ({ date: items[0].date, items, no: i }))
      .reverse() // newest on top, genesis at the bottom
      .forEach(({ date, items, no }) => {
        const li = el("li", `block${no === 0 ? " is-genesis" : ""}`);
        const head = el("div", "block-head");
        head.append(
          el("span", "block-no", `Blok #${no}`),
          el("span", "block-tag", no === 0 ? "Genesis" : "Dokoupeno"),
          el("span", "block-date", formatDate(date)),
        );
        const lines = el("ul", "block-lines");
        let sum = 0;
        for (const l of items) {
          const amount = l.qty * l.price;
          const excluded = l.h.notTraded === true;
          if (!excluded) sum += amount;
          const line = el("li", excluded ? "is-excluded" : "");
          line.append(
            el("span", "sym", l.h.symbol),
            el("span", "q", `${formatQty(l.qty)} ks × ${formatUnitPrice(l.price)}`),
            el("span", "amt", excluded ? `${formatCzk(amount)} · mimo součet` : formatCzk(amount)),
          );
          lines.append(line);
        }
        const total = el("div", "block-total");
        total.append(el("span", "", no === 0 ? "Startovní hodnota" : "Dokoupeno za"), el("strong", "", formatCzk(sum)));
        li.append(head, lines, total);
        list.append(li);
      });
    box.append(list);
    $("content").append(box);
  }

  function buildGlossary() {
    const box = el("details", "panel glossary pro-only");
    box.append(el("summary", "", "Slovníček investora"));
    const dl = el("dl");
    for (const [term, def] of GLOSSARY) dl.append(el("dt", "", term), el("dd", "", def));
    dl.append(el("dt", "", "Pozor"), el("dd", "", "Ceny kolísají nahoru i dolů. Že to dnes roste, neznamená, že poroste i zítra."));
    box.append(dl);
    $("content").append(box);
  }

  function showPrices({ items, allLive, cachedAt }) {
    // Growth only counts from the start date in config.json (before that: just the plain values).
    const startDate = /^\d{4}-\d{2}-\d{2}/.test(cfg.startDate ?? "") ? cfg.startDate.slice(0, 10) : null;
    const tracking = !startDate || todayIso() >= startDate;
    const rows = items.map((item, i) => {
      const pos = position(item.holding);
      if (!tracking) pos.cost = null;
      // "notTraded": shown (dimmed) but not part of the total, the growth, the shares or the allocation
      return { i, item, pos, value: item.price === null ? null : item.price * pos.qty, excluded: item.holding.notTraded === true };
    });

    let total = 0;
    let known = 0;
    let costSum = 0;
    let valueSum = 0;
    let since = null;
    for (const { pos, value, excluded } of rows) {
      if (pos.since && (!since || pos.since < since)) since = pos.since;
      if (value === null || excluded) continue;
      total += value;
      known += 1;
      if (pos.cost !== null) {
        costSum += pos.cost;
        valueSum += value;
      }
    }

    rows.forEach(({ item, pos, value, excluded }, i) => {
      const { li, value: valueEl, cells } = rowRefs[i];
      li.classList.toggle("is-excluded", excluded);
      valueEl.classList.remove("is-loading");
      valueEl.classList.toggle("is-stale", !item.live);
      valueEl.replaceChildren(value === null ? document.createTextNode("—") : moneyNode(formatCzk(value)));
      if (excluded) valueEl.append(el("small", "excl", "mimo součet"));
      // growth of this single investment, once tracking has started (next to its value, also without Pro mode)
      if (!excluded && value !== null && pos.cost !== null) {
        const r = value / pos.cost - 1;
        const micro = el("small", `micro is-${trend(r)}`);
        micro.append(el("i", "arr", ARROW[trend(r)]), document.createTextNode(formatPct(r)));
        valueEl.append(micro);
      }

      cells.price.textContent = item.price === null ? "—" : formatUnitPrice(item.price);
      cells.qty.textContent = formatQty(pos.qty);
      cells.avg.textContent = pos.cost === null ? "—" : formatUnitPrice(pos.cost / pos.qty);
      cells.share.textContent = excluded || value === null || total <= 0 ? "—" : formatPct(value / total, { signed: false });
      cells.cap.textContent = item.marketCap === null ? "—" : formatBig(item.marketCap);

      const today = cells.today;
      today.className = "v";
      if (item.change24 === null) {
        today.textContent = "—";
      } else {
        const r = item.change24 / 100;
        today.textContent = `${ARROW[trend(r)]} ${formatPct(r)}`;
        today.classList.add(`is-${trend(r)}`);
      }

      cells.plMoney.textContent = "";
      cells.plChip.textContent = "";
      cells.plChip.className = "chip";
      if (!excluded && value !== null && pos.cost !== null) {
        const pl = value - pos.cost;
        const r = pl / pos.cost;
        cells.plMoney.textContent = formatSignedCzk(pl);
        cells.plChip.textContent = formatPct(r);
        cells.plChip.classList.add(`is-${trend(r)}`);
      } else {
        cells.plMoney.textContent = "—";
      }
    });

    // an incomplete sum would look like a loss: show it only when every counted holding has a price
    const complete = rows.every((r) => r.excluded || r.value !== null);
    $("total").replaceChildren(known && complete ? moneyNode(formatCzk(total)) : document.createTextNode("—"));
    if (complete) {
      showPerformance({ costSum, valueSum, since: startDate ?? since, rows, total, waiting: !tracking });
    } else {
      perfRefs.box.hidden = true;
      setHero(false);
    }

    const status = $("status");
    status.classList.toggle("is-warn", !allLive);
    const time = (ts) => {
      const d = new Date(ts);
      const clock = d.toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" });
      return d.toDateString() === new Date().toDateString()
        ? clock
        : `${d.toLocaleDateString("cs-CZ", { day: "numeric", month: "numeric" })} ${clock}`;
    };
    const dot = '<span class="dot"></span>';
    if (allLive) {
      status.textContent = "";
    } else if (known) {
      const when = cachedAt ? ` (naposledy ${time(cachedAt)})` : "";
      status.innerHTML = `${dot}Ceny se nepodařilo načíst, ukazuju poslední známé${when}`;
    } else {
      status.innerHTML = `${dot}Ceny se teď nepodařilo načíst. Zkus to za chvíli.`;
    }
  }

  function showPerformance({ costSum, valueSum, since, rows, total, waiting }) {
    const p = perfRefs;
    p.box.classList.remove("is-up", "is-down", "is-flat", "is-waiting");
    p.pills.replaceChildren();
    const pill = (text, kind = "n", arrow = "") => {
      const node = el("span", `pill ${kind}`);
      if (arrow) node.append(el("i", "arr", arrow));
      node.append(document.createTextNode(text));
      p.pills.append(node);
    };
    const lead = ownerName ? `${ownerName} · ` : "";

    if (waiting && since) {
      // before the start date: nothing is counted yet
      p.box.hidden = false;
      p.box.classList.add("is-flat", "is-waiting");
      p.cap.textContent = ownerName || "Portfolio";
      p.num.textContent = `Start ${formatDate(since).replace(/ 20\d\d$/, "")}`;
      p.unit.textContent = "";
      pill("sledování růstu začne");
    } else if (!(costSum > 0)) {
      p.box.hidden = true; // no starting point recorded yet
      setHero(false);
      return;
    } else {
      p.box.hidden = false;
      const ratio = valueSum / costSum - 1;
      const diff = valueSum - costSum;
      const t = trend(ratio);
      p.box.classList.add(`is-${t}`);
      p.cap.textContent = since ? `${lead}${lead ? "od" : "Od"} ${formatDate(since)}` : ownerName || "Portfolio";
      const text = formatPct(ratio); // "+4,4 %": the number is big, the % small
      const cut = text.lastIndexOf(" ");
      p.num.textContent = text.slice(0, cut);
      p.unit.textContent = text.slice(cut + 1);
      pill(formatSignedCzk(diff), t === "up" ? "up" : t === "down" ? "dn" : "n", ARROW[t]);
      pill(`Vloženo ${formatCzk(costSum)}`);
    }
    setHero(true);

    p.bar.replaceChildren();
    p.legend.replaceChildren();
    rowRefs.forEach((r) => r.li.style.removeProperty("--c"));
    rows
      .filter((r) => r.value !== null && !r.excluded)
      .sort((a, b) => b.value - a.value)
      .forEach((r, i) => {
        const color = allocColor(i);
        const share = r.value / total;
        const seg = el("span", "alloc-seg");
        seg.style.flexGrow = String(Math.max(share, 0.0001));
        seg.style.setProperty("--c", color);
        p.bar.append(seg);
        const li = el("span", "alloc-item");
        const dot = el("i");
        dot.style.setProperty("--c", color);
        li.append(dot, document.createTextNode(`${r.item.holding.symbol} ${formatPct(share, { signed: false })}`));
        p.legend.append(li);
        rowRefs[r.i].li.style.setProperty("--c", color); // the ring around the logo matches its colour in the bar
      });
  }

  /* ---------- Pro mode ---------- */

  function applyPro(on) {
    root.dataset.pro = on ? "1" : "0";
    const sw = document.getElementById("pro-switch");
    if (sw) sw.setAttribute("aria-checked", String(on));
  }

  function buildProBar() {
    const bar = el("div", "pro-bar");
    const label = el("label", "pro-label", "Pro");
    label.htmlFor = "pro-switch";
    const sw = el("button", "switch");
    sw.type = "button";
    sw.id = "pro-switch";
    sw.setAttribute("role", "switch");
    sw.title = "Pro režim: ukáže cenu a růst každé položky";
    sw.setAttribute("aria-label", "Pro režim");
    sw.append(el("span", "knob"));
    bar.append(label, sw);
    $("tools").prepend(bar);

    sw.addEventListener("click", () => {
      const on = root.dataset.pro !== "1";
      store.set("pro", on ? "1" : "0");
      applyPro(on);
    });
    applyPro(store.get("pro") === "1");
  }

  /* ---------- Boot ---------- */

  function buildThemePicker() {
    const bar = $("themes");
    const toggle = $("theme-toggle");
    bar.replaceChildren();
    const setOpen = (open) => {
      bar.hidden = !open;
      toggle.setAttribute("aria-expanded", String(open));
    };
    for (const t of THEMES) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "theme-btn";
      btn.dataset.theme = t.id;
      btn.setAttribute("aria-label", `Motiv ${t.label}`);
      const pic = el("span", "theme-pic");
      pic.innerHTML = icons[t.id] || "";
      btn.append(pic, el("span", "theme-name", t.label));
      btn.addEventListener("click", () => {
        store.set("theme", t.id);
        applyTheme(t.id);
        setOpen(false);
      });
      bar.append(btn);
    }
    toggle.addEventListener("click", () => setOpen(bar.hidden));
    document.addEventListener("click", (event) => {
      if (!bar.hidden && !bar.contains(event.target) && !toggle.contains(event.target)) setOpen(false);
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !bar.hidden) {
        setOpen(false);
        toggle.focus();
      }
    });
    applyTheme(currentTheme());
  }

  async function start() {
    try {
      await boot();
    } catch (err) {
      console.error(err);
      const status = $("status");
      if (status) status.textContent = "Něco se pokazilo. Zkus stránku obnovit.";
    }
  }

  async function boot() {
    buildThemePicker();

    cfg = await loadConfig();
    if (!cfg) {
      showLoadError();
      return;
    }
    if (typeof cfg.passHash !== "string" || isUnlocked()) return openContent(); // no passHash in config.json = no password
    showLock(openContent);
  }

  async function openContent() {
    showOwner();
    holdings = (Array.isArray(cfg.holdings) ? cfg.holdings : []).filter((h) => h && h.source && position(h).qty > 0);
    buildProBar();

    $("content").hidden = false;
    $("total-bar").hidden = false;
    buildPerf();
    perfRefs.box.hidden = false;
    perfRefs.num.textContent = "…";
    setHero(true);
    buildList();
    buildHistory();
    buildGlossary();

    let lastRun = 0;
    const refresh = async () => {
      lastRun = Date.now();
      showPrices(await loadPrices());
    };
    await refresh();

    setInterval(() => {
      if (!document.hidden) refresh();
    }, REFRESH_MS);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && Date.now() - lastRun > 30_000) refresh();
    });
  }

  document.addEventListener("DOMContentLoaded", start);
})();
