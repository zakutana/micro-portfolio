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
    { id: "piano", label: "Klavír", color: "#14161c" },
    { id: "guitar", label: "Kytara", color: "#a8683a" },
    { id: "wednesday", label: "Wednesday", color: "#0d0b10" },
    { id: "harry", label: "Potter", color: "#0d1233" },
    { id: "sixseven", label: "6 7", color: "#1c0f3a" },
    { id: "space", label: "Vesmír", color: "#070a1f" },
    { id: "robots", label: "Roboti", color: "#03060d" },
    { id: "anime", label: "Anime", color: "#ffd6ec" },
    { id: "kpop", label: "KPop", color: "#120a24" },
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

  /* Festive lock screen: a gift, confetti that keeps falling, and a burst when the right password is entered. */
  const GIFT_SVG =
    '<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">' +
    '<rect x="10" y="29" width="44" height="29" rx="3" fill="#ff5fa2" stroke="#8a2a58" stroke-width="2.2"/>' +
    '<rect x="28" y="29" width="8" height="29" fill="#ffd24a" stroke="#a37a12" stroke-width="1.6"/>' +
    '<g class="gift-lid"><rect x="6" y="20" width="52" height="11" rx="3" fill="#ff86bd" stroke="#8a2a58" stroke-width="2.2"/>' +
    '<rect x="28" y="20" width="8" height="11" fill="#ffd24a" stroke="#a37a12" stroke-width="1.6"/>' +
    '<path d="M32 20 C24 6 12 10 18 17 C21 20 28 20 32 20 Z M32 20 C40 6 52 10 46 17 C43 20 36 20 32 20 Z" fill="#ffd24a" stroke="#a37a12" stroke-width="1.8" stroke-linejoin="round"/></g>' +
    '<path class="tw" d="M8 8 l1.4 3.2 3.2 1.4 -3.2 1.4 -1.4 3.2 -1.4-3.2 -3.2-1.4 3.2-1.4z" fill="#ffd24a"/>' +
    '<path class="tw tw2" d="M54 6 l1.1 2.5 2.5 1.1 -2.5 1.1 -1.1 2.5 -1.1-2.5 -2.5-1.1 2.5-1.1z" fill="#7ee7ff"/>' +
    "</svg>";
  const FESTIVE_THEMES = ["kirby", "waddle"];
  const CONFETTI = ["#ff5fa2", "#ffd24a", "#7ee7ff", "#a78bfa", "#5dffb0", "#ff8a5c"];

  function confettiLayer(count, burst) {
    const layer = el("div", burst ? "confetti is-burst fest-only" : "confetti fest-only");
    layer.setAttribute("aria-hidden", "true");
    const rnd = (a, b) => a + Math.random() * (b - a);
    for (let i = 0; i < count; i += 1) {
      const piece = document.createElement("i");
      const set = (k, v) => piece.style.setProperty(k, v);
      set("--c", CONFETTI[i % CONFETTI.length]);
      set("--w", `${rnd(6, 11).toFixed(1)}px`);
      set("--r", `${Math.round(rnd(240, 900))}deg`);
      if (burst) {
        const angle = rnd(-Math.PI, 0);
        const dist = rnd(90, 230);
        set("--dx", `${Math.round(Math.cos(angle) * dist)}px`);
        set("--dy", `${Math.round(Math.sin(angle) * dist)}px`);
        set("--d", `${rnd(0, 0.15).toFixed(2)}s`);
      } else {
        set("--x", `${rnd(2, 98).toFixed(1)}%`);
        set("--sway", `${Math.round(rnd(-40, 40))}px`);
        set("--t", `${rnd(6, 11).toFixed(1)}s`);
        set("--d", `-${rnd(0, 10).toFixed(1)}s`);
      }
      layer.append(piece);
    }
    return layer;
  }

  function showLock(onUnlock) {
    const lock = $("lock");
    lock.replaceChildren();
    const name = (new URLSearchParams(location.search).get("n") || "").trim().slice(0, 30);

    lock.classList.add("is-festive");
    lock.classList.remove("is-open");
    const icon = el("div", "lock-gift fest-only");
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML = GIFT_SVG;
    // the party look is only for the two themes the pages are handed over in (see FESTIVE_THEMES)
    const title = el("h2");
    title.append(
      el("span", "fest-only", name ? `Všechno nejlepší, ${name}!` : "Všechno nejlepší!"),
      el("span", "plain-only", name ? `Ahoj ${name}!` : "Tahle stránka je jen pro tebe"),
    );
    const hint = el("p", "", "Zadej heslo.");
    const note = el("p", "lock-note", "Stačí jednou, příště se stránka otevře sama.");

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
    const button = el("button", "pw-btn");
    button.append(el("span", "fest-only", "Rozbalit dárek"), el("span", "plain-only", "Odemknout"));
    button.type = "submit";
    const message = el("p", "pw-message");
    message.setAttribute("aria-live", "polite");
    form.append(input, button, message);
    lock.append(confettiLayer(26, false), icon, title, hint, form, note);

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
          const party = FESTIVE_THEMES.includes(root.dataset.theme);
          lock.classList.add("is-open");
          lock.append(confettiLayer(34, true));
          if (party && !matchMedia("(prefers-reduced-motion: reduce)").matches) await new Promise((r) => setTimeout(r, 1100));
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
  let heroWanted = false;
  function setHero(on) {
    heroWanted = on;
    applyHero();
  }
  /* the figure belongs to the Portfolio tab only: late price updates must not bring it back on the other tabs */
  function applyHero() {
    $("stage").classList.toggle("has-hero", heroWanted && activeTab === "portfolio");
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
    const digits = abs < 1 ? 2 : abs < 1000 ? 1 : 0;
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

  const GROUPS = [
    { id: "cash", label: "Měny" },
    { id: "commodities", label: "Komodity" },
    { id: "crypto", label: "Crypto" },
    { id: "stocks", label: "Akcie" },
    { id: "indexes", label: "Indexy" },
    { id: "collectibles", label: "Collectibles" },
    { id: "upcoming", label: "Upcoming" },
  ];
  const groupRank = (h) => {
    const i = GROUPS.findIndex((g) => g.id === h.group);
    return i < 0 ? GROUPS.length : i;
  };
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

  let rowRefs = [];
  let perfRefs = null;

  function buildList() {
    const list = $("list");
    list.replaceChildren();
    rowRefs = [];
    let lastGroup = null;
    for (const h of holdings) {
      const group = GROUPS.find((g) => g.id === h.group);
      if (group && group.id !== lastGroup) {
        const head = el("li", "group-title", group.label);
        head.setAttribute("role", "presentation");
        list.append(head);
        lastGroup = group.id;
      }
      const li = el("li");
      const a = el("a", "row");
      a.href = h.url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.setAttribute("aria-label", `${h.name} – otevřít web`);

      const name = el("span", "name");
      const sub = el("small", "", h.symbol);
      if (h.note) sub.append(el("span", "disc-note", ` · ${h.note}`)); // Minecraft's wide font has no room for it
      name.append(el("strong", "", h.name), sub);

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
    const facts = el("div", "perf-facts");
    const body = el("div", "perf-body");
    body.append(gain, facts);
    const bar = el("div", "alloc-bar");
    bar.setAttribute("aria-hidden", "true");

    const pro = el("div", "pro-only perf-pro");
    const allocTitle = el("div", "alloc-title", "Z čeho se portfolio skládá");
    const legend = el("div", "alloc-legend");
    pro.append(allocTitle, bar, legend);

    box.append(cap, body, pro);
    $("content").prepend(box);
    perfRefs = { box, cap, num, unit, facts, bar, legend };
  }

  /* Purchase history: every purchase is a "block"; the first one is the genesis block.
     The holdings, the cost and the growth are all calculated from these same records. */
  function buildHistory() {
    const lots = [];
    for (const h of Array.isArray(cfg.holdings) ? cfg.holdings : []) {
      if (!h || !Array.isArray(h.lots)) continue;
      for (const l of h.lots) if (l.qty > 0 && l.price > 0 && typeof l.date === "string") lots.push({ h, ...l });
    }
    const pane = $("pane-history");
    pane.querySelector(".history")?.remove();
    if (!lots.length) {
      pane.append(el("p", "pane-intro", "Zatím tu nejsou žádné nákupy."));
      return;
    }

    // purchases recorded within the same minute belong to one block
    const byDate = new Map();
    for (const l of lots) {
      const key = l.date.slice(0, 16);
      if (!byDate.has(key)) byDate.set(key, []);
      byDate.get(key).push(l);
    }
    const blocks = [...byDate.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)); // oldest first: #0 = genesis

    const box = el("section", "panel history");
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
    pane.append(box);
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
    } else {
      const when = known && cachedAt ? ` (${time(cachedAt)})` : "";
      status.innerHTML = known
        ? `${dot}Ukazuju poslední známé ceny${when}. Refreshni stránku.`
        : `${dot}Ceny se nepodařilo načíst. Refreshni stránku.`;
    }
  }

  function showPerformance({ costSum, valueSum, since, rows, total, waiting }) {
    const p = perfRefs;
    p.box.classList.remove("is-up", "is-down", "is-flat", "is-waiting");
    p.facts.replaceChildren();
    // a small label over a bigger number: "Vloženo 800 Kč", "Zisk +6,74 Kč"
    const fact = (label, value, kind = "") => {
      const node = el("div", "fact");
      const num = el("b", kind);
      num.append(/Kč$/.test(value) ? moneyNode(value) : document.createTextNode(value));
      node.append(el("small", "", label), num);
      p.facts.append(node);
    };
    const lead = ownerName ? `${ownerName} · ` : "";

    if (waiting && since) {
      // before the start date: nothing is counted yet
      p.box.hidden = false;
      p.box.classList.add("is-flat", "is-waiting");
      p.cap.textContent = ownerName || "Portfolio";
      p.num.textContent = `Start ${formatDate(since).replace(/ 20\d\d$/, "")}`;
      p.unit.textContent = "";
      fact("Sledování růstu", "začne");
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
      fact("Vloženo", formatCzk(costSum));
      fact("Zisk", formatSignedCzk(diff), t === "up" ? "up" : t === "down" ? "dn" : "");
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

  /* ---------- Tabs: Portfolio, Historie, Objevuj (swipe left / right works too) ---------- */

  const TABS = [
    ["portfolio", "Portfolio", "content"],
    ["history", "Historie", "pane-history"],
    ["discover", "Objevuj", "pane-discover"],
    ["guide", "Příručka", "pane-guide"],
  ];
  const TAB_ICONS = {
    portfolio: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5V12h8.5"/>',
    history: '<path d="M5 6.5h14M5 12h14M5 17.5h8.5"/>',
    discover: '<circle cx="12" cy="12" r="8.5"/><path d="M15.8 8.2l-2.1 5.5-5.5 2.1 2.1-5.5z"/>',
    guide: '<path d="M5 5.5A2.5 2.5 0 0 1 7.5 3H19v15H7.5A2.5 2.5 0 0 0 5 20.5z"/><path d="M5 20.5A2.5 2.5 0 0 1 7.5 18H19"/>',
  };
  let activeTab = "portfolio";

  function showTab(id, { instant = false } = {}) {
    const from = TABS.findIndex((t) => t[0] === activeTab);
    const to = TABS.findIndex((t) => t[0] === id);
    if (to < 0) return;
    activeTab = id;
    TABS.forEach(([tabId, , paneId], i) => {
      const pane = $(paneId);
      const on = tabId === id;
      pane.hidden = !on;
      pane.classList.remove("slide-from-right", "slide-from-left");
      if (on && !instant && from !== to) pane.classList.add(to > from ? "slide-from-right" : "slide-from-left");
      const tab = $(`tab-${tabId}`);
      tab.setAttribute("aria-selected", String(on));
      tab.tabIndex = on ? 0 : -1;
    });
    $("total-bar").hidden = id !== "portfolio";
    $("app").dataset.tab = id;
    applyHero();
    if (!instant) window.scrollTo({ top: 0 });
  }

  function buildTabs() {
    const nav = $("tabs");
    nav.replaceChildren();
    for (const [id, label, paneId] of TABS) {
      const btn = el("button", "tab");
      const ico = el("span", "tab-ico");
      ico.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${TAB_ICONS[id]}</svg>`;
      btn.append(ico, el("span", "tab-label", label));
      btn.type = "button";
      btn.id = `tab-${id}`;
      btn.setAttribute("role", "tab");
      btn.setAttribute("aria-controls", paneId);
      btn.addEventListener("click", () => showTab(id));
      nav.append(btn);
    }
    nav.addEventListener("keydown", (event) => {
      const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
      if (!step) return;
      const i = TABS.findIndex((t) => t[0] === activeTab);
      const next = TABS[(i + step + TABS.length) % TABS.length][0];
      showTab(next);
      $(`tab-${next}`).focus();
    });
    nav.hidden = false;
    $("app").classList.add("has-tabs");

    // swipe: a clearly horizontal, quick move of the finger changes the tab
    let start = null;
    document.addEventListener(
      "touchstart",
      (event) => {
        const t = event.touches[0];
        start = event.touches.length === 1 && !event.target.closest?.("input, .themes") ? { x: t.clientX, y: t.clientY, at: Date.now() } : null;
      },
      { passive: true },
    );
    document.addEventListener(
      "touchend",
      (event) => {
        if (!start || nav.hidden) return;
        const t = event.changedTouches[0];
        const dx = t.clientX - start.x;
        const dy = t.clientY - start.y;
        const quick = Date.now() - start.at < 700;
        start = null;
        if (!quick || Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.6) return;
        const i = TABS.findIndex((tab) => tab[0] === activeTab);
        const next = TABS[i + (dx < 0 ? 1 : -1)];
        if (next) showTab(next[0]);
      },
      { passive: true },
    );
    showTab("portfolio", { instant: true });
  }

  /* ---------- Discover: things worth a look (a short description of each, no prices, nothing to buy here) ---------- */

  let discoverItems = null;
  let discoverRows = [];

  async function buildDiscover() {
    const list = $("discover-list");
    try {
      const res = await fetch("../assets/discover.json", { cache: "no-cache" });
      discoverItems = (await res.json()).items ?? [];
    } catch {
      discoverItems = [];
    }
    list.replaceChildren();
    discoverRows = [];
    discoverItems = discoverItems.map((d, i) => [d, i]).sort((a, b) => groupRank(a[0]) - groupRank(b[0]) || a[1] - b[1]).map(([d]) => d);
    let lastGroup = null;
    for (const d of discoverItems) {
      const group = GROUPS.find((g) => g.id === d.group);
      if (group && group.id !== lastGroup) {
        const head = el("li", "group-title", group.label);
        head.setAttribute("role", "presentation");
        list.append(head);
        lastGroup = group.id;
      }
      const li = el("li");
      const a = el("a", "row");
      if (d.image) {
        // a collectible card: a tap shows the card big instead of opening a web page
        a.href = d.image;
        a.setAttribute("aria-label", `${d.name} – zobrazit kartu`);
        a.addEventListener("click", (event) => {
          event.preventDefault();
          showCard(d);
        });
      } else if (d.cash) {
        a.removeAttribute("href"); // nothing to open for the crown
        a.setAttribute("role", "group");
      } else {
        a.href = `https://www.coingecko.com/cs/coins/${d.id}`;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.setAttribute("aria-label", `${d.name} – otevřít web`);
      }
      const name = el("span", "name");
      const sub = el("small", "", d.symbol);
      const noteEl = el("span", "disc-note", ` · ${d.note}`);
      sub.append(noteEl);
      name.append(el("strong", "", d.name), sub);
      const change = el("span", d.group === "upcoming" ? "disc-change is-soon" : "disc-change", d.group === "upcoming" ? "brzy" : "…");
      let price = null;
      if (d.pricecharting) {
        // a collectible has no live price: show what the card costs now (PSA 10, from the file) and below it the change
        price = el("strong", "disc-price", "…");
        const box = el("span", "disc-val");
        box.append(price, change);
        a.append(logoNode(d), name, box);
      } else {
        a.append(logoNode(d), name, change);
      }
      li.append(a);
      list.append(li);
      discoverRows.push({ d, change, noteEl, price });
    }
    const select = $("range-select");
    select.value = "3y"; // it always opens on the last 3 years
    select.addEventListener("change", paintChanges);
    loadChanges();
  }

  /* A big view of a collectible card: tap anywhere, the cross or Escape to close. */
  let cardView = null;
  function showCard(d) {
    if (!cardView) {
      const box = el("div", "lightbox");
      box.hidden = true;
      box.setAttribute("role", "dialog");
      box.setAttribute("aria-modal", "true");
      const close = el("button", "lightbox-close", "\u00d7");
      close.type = "button";
      close.setAttribute("aria-label", "Zavřít");
      const fig = el("figure", "lightbox-fig");
      const img = document.createElement("img");
      img.alt = "";
      const cap = el("figcaption");
      fig.append(img, cap);
      box.append(close, fig);
      const hide = () => {
        box.hidden = true;
        document.body.classList.remove("has-lightbox");
        img.removeAttribute("src");
      };
      box.addEventListener("click", hide);
      document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && !box.hidden) hide();
      });
      document.body.append(box);
      cardView = { box, img, cap, close };
    }
    const { box, img, cap, close } = cardView;
    img.src = d.image;
    img.alt = d.name;
    cap.replaceChildren(el("strong", "", d.name));
    const text = cardPriceText(d);
    if (text) cap.append(el("b", "lightbox-price", `Aktuální cena: ${text}`));
    cap.append(el("span", "", d.note));
    box.hidden = false;
    document.body.classList.add("has-lightbox");
    close.focus();
  }

  /* The change of every asset since the chosen moment: the live price against the old price from assets/discover-history.json. */
  let discoverHistory = null;
  let livePrices = null;
  async function loadChanges() {
    try {
      const res = await fetch("../assets/discover-history.json", { cache: "no-cache" });
      discoverHistory = await res.json();
    } catch {
      discoverHistory = null;
    }
    const ids = discoverRows.filter((r) => r.d.group !== "upcoming" && !r.d.pricecharting).map((r) => r.d.id); // cards have no live price, only the monthly one from the file
    try {
      const data = await getJson(`${COINGECKO}/simple/price?vs_currencies=usd&ids=${ids.join(",")}`);
      livePrices = Object.fromEntries(ids.map((id) => [id, data[id]?.usd]).filter(([, v]) => isPrice(v)));
    } catch {
      livePrices = null;
    }
    usdCzk = (await fetchUsdCzk()) ?? Number(readCache().fx) ?? null;
    paintChanges();
  }

  let usdCzk = null;
  function cardPriceText(d) {
    const usd = discoverHistory?.items?.[d.id]?.last;
    return isPrice(usd) && isPrice(usdCzk) ? formatCzk(usd * usdCzk) : null;
  }

  function paintChanges() {
    const range = $("range-select").value;
    for (const { d, change, noteEl, price } of discoverRows) {
      if (d.group === "upcoming") continue;
      if (price) {
        const text = cardPriceText(d);
        price.replaceChildren(text ? moneyNode(text) : document.createTextNode("—"));
        d.priceText = text;
      }
      if (d.cash) {
        // roughly how much per year the crown loses, from the 10 year figure (the yearly loss that compounds to it)
        const ten = discoverHistory?.cash?.["10y"]?.combined;
        const perYear = typeof ten === "number" ? 1 - (1 + ten) ** (1 / 10) : null;
        noteEl.textContent = ` · ${d.note}${perYear ? `. Koruna tak ztrácí zhruba ${nf({ maximumFractionDigits: 0 }).format(perYear * 100)} % ročně` : ""}`;
      }
      change.className = "disc-change";
      change.title = "";
      if (d.cash) {
        // money: how much value it lost (inflation and debasement in one number, see tools/discover-history.mjs)
        const r = discoverHistory?.cash?.[range]?.combined;
        if (typeof r !== "number") {
          change.textContent = "—";
        } else {
          change.classList.add(`is-${trend(r)}`);
          change.replaceChildren(el("i", "arr", ARROW[trend(r)]), document.createTextNode(formatPct(r)));
        }
        continue;
      }
      const row = discoverHistory?.items?.[d.id];
      const then = row?.[range];
      const now = livePrices?.[d.id] ?? row?.last;
      if (!isPrice(then) || !isPrice(now)) {
        change.textContent = "—";
        change.title = discoverHistory ? "Za tu dobu o tom nejsou údaje" : "Údaje se nepodařilo načíst";
        continue;
      }
      const r = now / then - 1;
      change.classList.add(`is-${trend(r)}`);
      change.replaceChildren(el("i", "arr", ARROW[trend(r)]), document.createTextNode(formatPct(r)));
    }
  }

  /* ---------- Příručka: pictures and animations that explain money, growth and market cap, plus the glossary ---------- */

  const MONEY_STEPS = [
    {
      amount: 1_000,
      word: "tisíc",
      zeros: 3,
      items: [
        ["🍕", "4 pizzy"],
        ["🎬", "4 lístky do kina"],
        ["🃏", "5 balíčků Pokémon karet"],
        ["🧱", "malá sada LEGO"],
      ],
    },
    {
      amount: 100_000,
      word: "sto tisíc",
      zeros: 5,
      items: [
        ["📱", "3 nové telefony"],
        ["🚲", "dobré elektrokolo"],
        ["🏖️", "dovolená u moře pro celou rodinu"],
        ["🖥️", "herní počítač s monitorem"],
      ],
    },
    {
      amount: 1_000_000,
      word: "milion",
      zeros: 6,
      items: [
        ["🚗", "nové malé auto"],
        ["🏕️", "malá chata na vesnici"],
        ["🎓", "rok studia v zahraničí"],
        ["🏍️", "velká motorka"],
      ],
    },
    {
      amount: 100_000_000,
      word: "sto milionů",
      zeros: 8,
      items: [
        ["🏡", "vila se sluhy"],
        ["🏎️", "sportovní auto"],
        ["🛥️", "motorová jachta"],
      ],
    },
    {
      amount: 1_000_000_000,
      word: "miliarda",
      zeros: 9,
      items: [
        ["🏰", "zámek s parkem"],
        ["🏟️", "menší fotbalový stadion"],
        ["✈️", "soukromý tryskáč"],
      ],
    },
    {
      amount: 1_000_000_000_000,
      word: "bilion",
      zeros: 12,
      items: [
        ["💸", "zhruba 90 000 Kč pro každého obyvatele Česka"],
        ["🏢", "asi 250 000 bytů"],
      ],
      note: "Bilion je tisíc miliard (anglicky „trillion“).",
    },
    {
      amount: 100_000_000_000_000,
      word: "sto bilionů",
      zeros: 14,
      items: [
        ["../assets/logos/discover/nvidia.png", "NVIDIA, asi 125 bilionů Kč"],
        ["../assets/logos/discover/apple.png", "Apple, asi 110 bilionů Kč"],
        ["../assets/logos/discover/google.png", "Google, asi 90 bilionů Kč"],
        ["../assets/logos/discover/microsoft.png", "Microsoft, asi 85 bilionů Kč"],
        ["../assets/logos/discover/amazon.png", "Amazon, asi 60 bilionů Kč"],
        ["../assets/logos/discover/meta.png", "Meta, asi 40 bilionů Kč"],
      ],
      note: "Tolik stojí největší firmy světa (říjen 2026). NVIDIA má třeba hodnotu asi 5,8 bilionu dolarů, což je při kurzu 22 Kč za dolar asi 125 bilionů korun.",
    },
  ];

  const GROWTH_ROWS = [
    [-50, "klesla na polovinu"],
    [0, "stejná"],
    [50, "o polovinu víc"],
    [100, "dvakrát tolik"],
    [200, "třikrát tolik"],
    [300, "čtyřikrát tolik"],
  ];

  const timesText = (mult) => `×${nf({ maximumFractionDigits: 2 }).format(mult)}`;
  const guideState = { section: "money", sliderValue: 100, capPrice: 100 };
  let guideRefs = null;

  function sectionIntro(text) {
    return el("p", "guide-intro", text);
  }

  function buildGuide() {
    const pane = el("main");
    pane.id = "pane-guide";
    pane.hidden = true;
    pane.setAttribute("role", "tabpanel");
    pane.setAttribute("aria-labelledby", "tab-guide");

    const nav = el("nav", "guide-tabs");
    nav.setAttribute("aria-label", "Části příručky");
    const sections = [
      ["money", "💰", "Peníze", "Hodnota peněz", buildMoneyGuide],
      ["growth", "📈", "Růst", "Růst o 100 %", buildGrowthGuide],
      ["passive", "🏖️", "Příjem", "Pasivní příjem", buildPassiveGuide],
      ["cap", "🏢", "Cap", "Market cap", buildCapGuide],
      ["invest", "🧭", "Tipy", "Do čeho investovat", buildInvestGuide],
      ["cheat", "📝", "Tahák", "Tahák: rychlý přehled", buildCheatGuide],
    ];
    const bodies = {};
    for (const [id, emoji, label, title, builder] of sections) {
      const btn = el("button", "guide-tab");
      btn.append(el("span", "guide-tab-ico", emoji), el("span", "guide-tab-label", label));
      btn.type = "button";
      btn.title = title;
      btn.setAttribute("aria-label", title);
      btn.dataset.section = id;
      btn.addEventListener("click", () => showGuideSection(id));
      nav.append(btn);
      const body = el("section", `guide-body guide-${id}`);
      body.hidden = true;
      builder(body);
      bodies[id] = body;
    }
    pane.append(nav, ...Object.values(bodies));
    $("stage").append(pane);
    guideRefs = { nav, bodies };
    showGuideSection(guideState.section, { silent: true });
  }

  function showGuideSection(id, { silent = false } = {}) {
    guideState.section = id;
    for (const btn of guideRefs.nav.children) btn.setAttribute("aria-pressed", String(btn.dataset.section === id));
    for (const [key, body] of Object.entries(guideRefs.bodies)) body.hidden = key !== id;
    if (!silent) window.scrollTo({ top: 0 });
    playGuide(id);
  }

  /* each section plays its little animation again whenever it is opened */
  function playGuide(id) {
    if (id === "money") {
      for (const row of guideRefs.bodies.money.querySelectorAll(".money-row")) {
        row.classList.remove("is-in");
        void row.offsetWidth; // restart the animation
        row.classList.add("is-in");
      }
    }
  }

  /* ---- 1. the value of money ---- */

  function buildMoneyGuide(box) {
    box.append(sectionIntro("Kolik je které množství peněz a co by se za něj dalo koupit. Ceny jsou jen přibližné, v korunách."));
    let previous = null;
    MONEY_STEPS.forEach((step, i) => {
      if (previous) {
        const times = step.amount / previous.amount;
        box.append(el("div", "money-times", `${timesText(times).replace("×", "× ")} víc`));
      }
      previous = step;
      const row = el("section", "panel money-row");
      row.style.setProperty("--i", String(i));
      const head = el("div", "money-head");
      const big = el("strong", `money-amount${step.zeros >= 12 ? " is-long" : ""}`);
      big.append(document.createTextNode(nf({ maximumFractionDigits: 0 }).format(step.amount).replace(/ /g, " ")), el("span", "cur", " Kč"));
      head.append(big, el("span", "money-word", step.word));
      const zeros = el("div", "money-zeros");
      zeros.append(el("span", "", `${step.zeros} ${step.zeros === 3 ? "nuly" : step.zeros < 5 ? "nuly" : "nul"}`));
      for (let z = 0; z < step.zeros; z++) zeros.append(el("i", "money-zero"));
      const items = el("div", "money-items");
      for (const [emoji, label] of step.items) {
        const chip = el("div", "money-item");
        let pic;
        if (emoji.startsWith("../")) {
          pic = document.createElement("img"); // a company logo instead of an emoji
          pic.className = "money-logo";
          pic.src = emoji;
          pic.alt = "";
          pic.loading = "lazy";
        } else {
          pic = el("span", "money-emoji", emoji);
        }
        chip.append(pic, el("span", "money-label", label));
        items.append(chip);
      }
      row.append(head, zeros, items);
      if (step.note) row.append(el("p", "money-secs", step.note));
      box.append(row);
    });
  }

  /* ---- 2. growth of 100 % means twice the price ---- */

  function buildGrowthGuide(box) {
    box.append(sectionIntro("Růst o 100 % neznamená, že je to o sto korun víc. Znamená to, že je to dvakrát tolik."));

    const rule = el("section", "panel growth-rule");
    const chips = el("div", "gr-chips");
    for (const [pct, word] of [[100, "dvojnásobek"], [200, "trojnásobek"], [300, "čtyřnásobek"], [900, "desetinásobek"]]) {
      const c = el("div", "gr-chip");
      c.append(el("b", "", `+${pct} %`), el("span", "", `= ${word}`), el("small", "", `×${pct / 100 + 1}`));
      chips.append(c);
    }
    rule.append(chips);
    box.append(rule);

    const table = el("section", "panel growth-table");
    table.append(el("h3", "guide-h", "Kolik vyjde z 1 000 Kč"));
    for (const [pct, text] of GROWTH_ROWS) {
      const mult = 1 + pct / 100;
      const row = el("div", `gt-row${pct < 0 ? " is-down" : pct > 0 ? " is-up" : ""}`);
      const label = el("span", "gt-pct", `${pct > 0 ? "+" : pct < 0 ? MINUS : ""}${Math.abs(pct)} %`);
      const track = el("span", "gt-track");
      const fill = el("span", "gt-fill");
      fill.style.setProperty("--w", `${(mult / 4) * 100}%`);
      track.append(fill);
      const value = el("span", "gt-val");
      value.append(el("b", "", formatCzk(1000 * mult)), el("small", "", ` ${text} (${timesText(mult)})`));
      row.append(label, track, value);
      table.append(row);
    }
    box.append(table);

    const slider = el("section", "panel growth-slider");
    slider.append(el("h3", "guide-h", "Vyzkoušej si to"));
    const bars = el("div", "gd-bars");
    const mkCol = (cls, label) => {
      const col = el("div", "gd-col");
      const bar = el("div", `gd-bar ${cls}`);
      const val = el("span", "gd-val");
      bar.append(val);
      col.append(bar, el("small", "", label));
      return { col, bar, val };
    };
    const before = mkCol("gd-before", "před");
    const after = mkCol("gd-after", "po růstu");
    const arrow = el("div", "gd-arrow");
    arrow.setAttribute("aria-hidden", "true");
    const arrowPct = el("b");
    arrow.append(arrowPct, el("i", "", "→"));
    bars.append(before.col, arrow, after.col);
    const range = el("input");
    range.type = "range";
    range.min = "-90";
    range.max = "900";
    range.step = "10";
    range.value = String(guideState.sliderValue);
    range.setAttribute("aria-label", "O kolik procent cena vzrostla");
    const out = el("div", "gs-out");
    const paint = () => {
      const pct = Number(range.value);
      const mult = 1 + pct / 100;
      const sign = pct > 0 ? "+" : pct < 0 ? MINUS : "";
      // the yellow bar always stays the same (1 000 Kč = a tenth of the chart), the green one grows with the price
      before.bar.style.height = "10%";
      after.bar.style.height = `${Math.max(3, Math.min(100, mult * 10))}%`;
      after.bar.classList.toggle("is-loss", pct < 0);
      before.val.textContent = formatCzk(1000);
      after.val.textContent = formatCzk(1000 * mult);
      arrowPct.textContent = `${sign}${Math.abs(pct)} %`;
      arrowPct.className = pct < 0 ? "is-loss" : "";
      out.replaceChildren(
        el("span", `gs-pct ${pct > 0 ? "is-up" : pct < 0 ? "is-down" : ""}`, `${sign}${Math.abs(pct)} %`),
        el("span", "gs-eq", `1 000 Kč → `),
        el("b", "gs-res", formatCzk(1000 * mult)),
        el("small", "", ` (${timesText(mult)})`),
      );
    };
    range.addEventListener("input", () => {
      guideState.sliderValue = Number(range.value);
      paint();
    });
    paint();
    slider.append(bars, out, range);
    box.append(slider);

    const trap = el("section", "panel growth-trap");
    trap.append(el("h3", "guide-h", "Pozor na pád"));
    trap.append(
      el("p", "", "Když cena klesne o 50 %, nestačí, aby pak vzrostla o 50 %. Z 1 000 Kč je po pádu 500 Kč. Aby bylo zase 1 000 Kč, musí vzrůst o 100 %."),
    );
    const steps = el("div", "trap-steps");
    for (const [text, kc] of [["začátek", "1 000 Kč"], ["−50 %", "500 Kč"], ["+100 %", "1 000 Kč"]]) {
      const s = el("div", "trap-step");
      s.append(el("small", "", text), el("b", "", kc));
      steps.append(s);
    }
    trap.append(steps);
    box.append(trap);

    const live = el("section", "panel growth-live");
    live.hidden = true;
    box.append(live);
    loadGrowthExamples(live);
  }

  /* "1 000 Kč → 3 830 Kč +283 %": the result big and bold, so the numbers are easy to see */
  function liveLine(from, ratio) {
    const line = el("div", "live-line");
    line.append(el("span", "live-from", `${formatCzk(from)} →`), el("strong", "live-to", formatCzk(from * (1 + ratio))), pill(ratio));
    return line;
  }

  /* a few real examples from the Objevuj file: how much 1 000 Kč would have become */
  async function loadGrowthExamples(box) {
    const data = await guideData();
    if (!data) return;
    const wanted = [
      ["pc-charizard-1st", "5y", "Karta Charizard", "5 let", "../assets/logos/discover/charizard-1st.png"],
      ["nasdaq-xstock", "5y", "Nasdaq 100", "5 let", "../assets/logos/discover/nasdaq.png"],
      ["bitcoin", "1y", "Bitcoin", "1 rok", "../assets/logos/discover/bitcoin.png"],
    ];
    let any = false;
    for (const [id, key, name, when, logo] of wanted) {
      const ratio = histChange(data, id, key);
      if (ratio === null) continue;
      if (!any) box.append(el("h3", "guide-h", "Skutečné příklady"));
      any = true;
      const line = el("div", "live-row");
      const img = document.createElement("img");
      img.src = logo;
      img.alt = "";
      img.loading = "lazy";
      const text = el("div", "live-text");
      text.append(el("b", "", `${name}, ${when}`), liveLine(1000, ratio));
      line.append(img, text);
      box.append(line);
    }
    box.hidden = !any;
  }

  /* ---- 2b. passive income: what a month costs, what money can earn, and the snowball that grows until nobody has to go to work ---- */

  const LIVING = [
    ["🍽️", "Jídlo", 5000],
    ["🏠", "Nájem", 15000],
    ["⛽", "Benzín, restaurace, kosmetika a další", 5000],
  ];
  const START_AMOUNT = 1300; // what they start with
  const KID_AGE = 10;
  const PASSIVE_GOAL = 3_000_000; // the money that gives 25 000 Kč a month at 10 % a year
  const PASSIVE_YIELD = 0.1; // the cautious yearly return the page counts with
  /* the 20 year figures for the S&P 500 and the Nasdaq 100 (tools/discover-history.mjs refreshes them in the data file) */
  const BENCH_FALLBACK = {
    years: 20,
    sp500: { cagr: 0.1105, multiple: 8.15, worst: { year: 2008, ret: -0.368 } },
    nasdaq: { cagr: 0.1639, multiple: 20.87, worst: { year: 2008, ret: -0.417 } },
  };

  /* the Objevuj data file, loaded once and shared by the parts of the guide that use real numbers */
  let guideDataPromise = null;
  const guideData = () =>
    (guideDataPromise ??= fetch("../assets/discover-history.json", { cache: "no-cache" })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null));
  const histChange = (data, id, key) => {
    const row = data?.items?.[id];
    return row && isPrice(row[key]) && isPrice(row.last) ? row.last / row[key] - 1 : null;
  };
  const wholePct = (ratio) => `${nf({ maximumFractionDigits: 0 }).format(Math.abs(ratio) * 100)} %`;

  /* the two safe examples, S&P 500 and Nasdaq 100, with their yearly return over the last 20 years */
  function benchChips() {
    const chips = el("div", "pe-chips");
    const refs = {};
    for (const [name, key, logo] of [["S&P 500", "sp500", "../assets/logos/discover/sp500.png"], ["Nasdaq 100", "nasdaq", "../assets/logos/discover/nasdaq.png"]]) {
      const chip = el("div", "pe-chip");
      const rate = el("span", "");
      chip.append(logoImg(logo), el("b", "", name), rate);
      chips.append(chip);
      refs[key] = rate;
    }
    const show = (b) => {
      for (const key of Object.keys(refs)) refs[key].textContent = `asi ${wholePct(b[key].cagr)} ročně`;
    };
    show(BENCH_FALLBACK);
    guideData().then((d) => {
      if (d?.benchmarks?.sp500 && d.benchmarks.nasdaq) show(d.benchmarks);
    });
    return chips;
  }

  function buildPassiveGuide(box) {
    box.append(sectionIntro("Peníze umějí generovat další peníze samy, když jsou zainvestované."));

    const monthly = LIVING.reduce((a, r) => a + r[2], 0);
    const yearly = monthly * 12;
    const goal = yearly / PASSIVE_YIELD;

    /* what a month of life costs */
    const costs = el("section", "panel passive-costs");
    costs.append(el("h3", "guide-h", "Kolik stojí jeden měsíc života"));
    for (const [emoji, label, kc] of LIVING) {
      const row = el("div", "pc-row");
      row.append(el("span", "pc-emoji", emoji), el("span", "pc-label", label));
      const track = el("span", "pc-track");
      const fill = el("span", "pc-fill");
      fill.style.setProperty("--w", `${(kc / monthly) * 100}%`);
      track.append(fill);
      row.append(track, el("b", "pc-kc", formatCzk(kc)));
      costs.append(row);
    }
    const total = el("div", "pc-total");
    total.append(el("span", "", "Dohromady měsíčně"), el("b", "", formatCzk(monthly)), el("small", "", `za rok ${formatCzk(yearly)}`));
    costs.append(total);
    box.append(costs);

    /* what has to be earned: said directly to her */
    const earn = el("section", "panel passive-earn");
    earn.append(el("h3", "guide-h", "Abys už nikdy nemusela pracovat"));
    const pct = PASSIVE_YIELD * 100;
    earn.append(el("p", "pcalc-text", `Bezpečně se dá vydělávat ${pct} % ročně. Proto potřebuješ mít zainvestováno:`));
    const need = el("div", "pcalc-need");
    need.append(el("strong", "", formatCzk(goal)));
    const chip = (cls, text) => el("span", `cf-chip ${cls}`, text);
    const sign = (text) => el("i", "", text);
    const proof = el("div", "pcalc-formula");
    proof.append(chip("is-cap", formatCzk(goal)), sign("×"), chip("is-count", `${pct} %`), sign("="), chip("is-price", `${formatCzk(yearly)} ročně`));
    const perMonth = el("div", "pcalc-formula");
    perMonth.append(chip("is-price", `${formatCzk(yearly)} ročně`), sign("÷"), chip("is-count", "12 měsíců"), sign("="), chip("is-cap", `${formatCzk(monthly)} měsíčně`));
    earn.append(need, el("p", "pcalc-text", `${pct} % z toho je za rok ${formatCzk(yearly)}, a to děleno 12 měsíci je právě ${formatCzk(monthly)} měsíčně:`), proof, perMonth);
    earn.append(el("p", "pcalc-text", "Bezpečné investice jsou třeba:"));
    earn.append(benchChips(), el("small", "pe-note", "za posledních 20 let, bez záruky"));
    box.append(earn);

    buildSnowball(box, monthly, goal);
  }

  /* the snowball: one slider makes it bigger, up to the money that gives 100 000 Kč a month; when it reaches the goal the banner flips to
     "no work needed". Nobody knows when an investment takes off, so there is no time on it, only the size. */
  function buildSnowball(box, monthlyNeed, goal) {
    const MAX_VALUE = (100_000 * 12) / PASSIVE_YIELD;
    const valueAt = (pos) => START_AMOUNT * (MAX_VALUE / START_AMOUNT) ** (pos / 100); // a log scale: from the start to 100 000 Kč a month

    const card = el("section", "panel snowball");
    card.append(el("h3", "guide-h", "Sněhová koule"));
    card.append(
      el("p", "pcalc-text", `Koule je velikost tvých investic. Začínáš s ${formatCzk(START_AMOUNT)} a roste o zmíněných bezpečných ${PASSIVE_YIELD * 100}\u00a0%\u00a0ročně. Posuň posuvník a uvidíš, kolik ti dává měsíčně.`),
    );

    const stage = el("div", "sb-stage");
    stage.setAttribute("aria-hidden", "true");
    for (let k = 0; k < 7; k++) {
      const flake = el("span", "sb-flake", "$");
      flake.style.setProperty("--x", `${8 + k * 14}%`);
      flake.style.setProperty("--d", `${(k * 0.7).toFixed(1)}s`);
      stage.append(flake);
    }
    const ball = el("div", "sb-ball");
    const ballIcon = el("span", "sb-ballicon", "$");
    ball.append(ballIcon);
    stage.append(ball);

    const amount = el("div", "sb-amount");
    const track = el("div", "sb-track");
    const fill = el("div", "sb-fill");
    const mark = el("span", "sb-mark");
    mark.style.left = `${(goal / MAX_VALUE) * 100}%`;
    mark.title = `cíl ${formatCzk(goal)}`;
    track.append(fill, mark);
    const marks = el("p", "sb-progress");
    marks.append(el("span", "", `cíl ${formatCzk(goal)}`), el("span", "", formatCzk(MAX_VALUE)));
    const banner = el("div", "sb-banner is-work");
    banner.setAttribute("role", "status");
    banner.setAttribute("aria-live", "polite");

    const wrap = el("label", "sb-slider");
    const label = el("span", "", "Velikost koule");
    const input = el("input");
    input.type = "range";
    input.min = "0";
    input.max = "100";
    input.step = "0.5";
    input.value = "0";
    input.setAttribute("aria-label", "Jak velká je koule");
    wrap.append(label, input);

    /* "a při [10 % ročně] ti dává měsíčně" with the rate as a bright chip */
    const labelWithRate = () => {
      const l = el("small", "sb-lbl sb-ratebox");
      l.append(document.createTextNode("a při "), el("span", "cf-chip is-count sb-rate", `${PASSIVE_YIELD * 100} % ročně`), document.createTextNode(" ti dává měsíčně"));
      return l;
    };

    let wasFree = false;
    const paint = () => {
      const value = valueAt(Number(input.value));
      const ratio = value / MAX_VALUE;
      const size = 56 + 150 * Math.sqrt(ratio);
      ball.style.width = ball.style.height = `${size}px`;
      ballIcon.style.fontSize = `${size * 0.5}px`;
      const income = (value * PASSIVE_YIELD) / 12;
      amount.replaceChildren(
        el("small", "sb-lbl", "Tvoje investice (velikost koule)"),
        el("strong", "", formatCzk(Math.round(value / 10) * 10)),
        labelWithRate(),
        el("strong", "sb-income", `${nf({ maximumFractionDigits: 0 }).format(Math.round(income))}\u00a0Kč`),
        el("small", "sb-lbl", `to je ${formatCzk(Math.round(income) * 12)} ročně`),
      );
      fill.style.width = `${ratio * 100}%`;
      const free = value >= goal - 0.5;
      banner.classList.toggle("is-free", free);
      banner.classList.toggle("is-work", !free);
      banner.replaceChildren(
        el("span", "sb-banner-icon", free ? "🏖️" : "💼"),
        el("span", "", free ? "Hotovo! Do práce chodit nemusíš." : `Zatím musíš do práce. Potřebuješ ${formatCzk(monthlyNeed)} měsíčně.`),
      );
      if (free && !wasFree) {
        banner.classList.remove("flash");
        void banner.offsetWidth;
        banner.classList.add("flash");
      }
      wasFree = free;
    };
    input.addEventListener("input", paint);

    card.append(stage, amount, track, marks, banner, wrap);
    box.append(card);
    paint();
  }

  /* ---- 2d. the 15 year simulator: a monthly deposit and a yearly return, and what the portfolio becomes ---- */

  const SIM_YEARS = 15;
  const bigCzk = (v) => (v >= 1e9 ? formatBig(v) : formatCzk(v));

  function buildSimulator(box) {
    const card = el("section", "panel simulator");
    card.append(el("h3", "guide-h", `Simulátor: tvých ${SIM_YEARS} let`));
    card.append(el("p", "cd-text", `Nastav, kolik budeš měsíčně přidávat a o kolik % ročně ti portfolio vzroste. Začínáš s ${formatCzk(START_AMOUNT)}.`));

    const slider = (title, min, max, step, value) => {
      const wrap = el("label", "sim-slider");
      const head = el("span", "sim-head");
      const val = el("b", "");
      head.append(el("span", "", title), val);
      const input = el("input");
      input.type = "range";
      input.min = String(min);
      input.max = String(max);
      input.step = String(step);
      input.value = String(value);
      input.setAttribute("aria-label", title);
      wrap.append(head, input);
      return { wrap, input, val };
    };
    const monthly = slider("Měsíčně přidáš", 0, 10000, 100, 1000);
    const rate = slider("Portfolio ročně vzroste o", 0, 100, 1, 10);

    const chart = el("div", "cmp-chart sim-chart");
    chart.setAttribute("aria-hidden", "true");
    const axis = el("div", "sim-axis");
    axis.append(el("span", "", "dnes"), el("span", "", `za ${SIM_YEARS} let`));
    const out = el("div", "sim-out");
    const legend = el("div", "cmp-legend");
    for (const [cls, text] of [["is-base", "co jsi vložila"], ["is-extra", "co vydělaly peníze samy"]]) {
      const item = el("span", "");
      item.append(el("i", `cmp-dot ${cls}`), document.createTextNode(text));
      legend.append(item);
    }

    const paint = () => {
      const c = Number(monthly.input.value);
      const r = Number(rate.input.value) / 100;
      monthly.val.textContent = formatCzk(c);
      rate.val.textContent = `${nf({ maximumFractionDigits: 0 }).format(r * 100)} %`;
      const m = (1 + r) ** (1 / 12) - 1;
      let bal = START_AMOUNT;
      let put = START_AMOUNT;
      const years = [];
      let reached = null;
      for (let month = 1; month <= SIM_YEARS * 12; month++) {
        bal = bal * (1 + m) + c;
        put += c;
        if (month % 12 === 0) years.push([put, bal]);
        if (reached === null && bal >= PASSIVE_GOAL) reached = month / 12;
      }
      const top = bal;
      chart.replaceChildren();
      for (const [dep, total] of years) {
        const col = el("div", "cmp-col");
        const gain = el("span", "cmp-seg is-extra");
        gain.style.height = `${(Math.max(0, total - dep) / top) * 100}%`;
        const base = el("span", "cmp-seg is-base");
        base.style.height = `${(dep / top) * 100}%`;
        col.append(gain, base);
        chart.append(col);
      }
      const goalLine =
        reached !== null
          ? `🏖️ ${formatCzk(PASSIVE_GOAL)} překonáš asi v ${Math.ceil(reached)}. roce.`
          : `Do ${formatCzk(PASSIVE_GOAL)} ti ještě chybí ${bigCzk(PASSIVE_GOAL - bal)}.`;
      out.replaceChildren(
        el(
          "p",
          "sim-sentence",
          `Když měsíčně přispěješ ${formatCzk(c)} a ročně se ti portfolio zvedne o ${nf({ maximumFractionDigits: 0 }).format(r * 100)} %, za ${SIM_YEARS} let budeš mít`,
        ),
        el("strong", "sim-total", bigCzk(bal)),
        el("small", "sb-lbl", `Sama vložíš ${bigCzk(put)}. Zbylých ${bigCzk(Math.max(0, bal - put))} vydělají peníze samy: každý rok se výdělek počítá i z výdělků z minulých let, proto je to tolik.`),
        el("small", "sb-lbl", goalLine),
      );
    };
    monthly.input.addEventListener("input", paint);
    rate.input.addEventListener("input", paint);
    paint();
    card.append(monthly.wrap, rate.wrap, legend, chart, axis, out, el("small", "pe-note sim-note", `Je to jen výpočet, nic není zaručené. S&P 500 dával za posledních 20 let asi ${wholePct(BENCH_FALLBACK.sp500.cagr)} ročně.`));
    box.append(card);
  }

  /* ---- 3. market cap: short, with pictures ---- */

  function logoImg(src, cls = "") {
    const img = document.createElement("img");
    img.src = src;
    img.alt = "";
    img.loading = "lazy";
    if (cls) img.className = cls;
    return img;
  }

  function buildCapGuide(box) {
    box.append(sectionIntro("Market cap je hodnota celé firmy nebo kryptoměny."));

    const formula = el("section", "panel cap-formula");
    formula.innerHTML =
      '<div class="cf-line"><span class="cf-chip is-price">cena 1 akcie</span><i>×</i><span class="cf-chip is-count">počet akcií</span><i>=</i><span class="cf-chip is-cap">market cap</span></div>';
    box.append(formula);

    const pot = el("section", "panel cap-potential");
    pot.append(el("h3", "guide-h", "Velká firma proti malé"));
    pot.append(el("p", "cd-text cr-risk", "Čím menší market cap, tím větší šance na růst, ale také větší riziko."));
    pot.append(el("p", "cd-text", "Dáš 1 000 Kč. Velká věc už nemá kam moc růst, malá může vyrůst mnohonásobně."));
    for (const [pic, name, size, mult] of [
      [logoImg("../assets/logos/discover/bitcoin.png", "pot-logo"), "Bitcoin", "už je velký, hodnota asi 1,7 bilionu $", 5],
      [el("span", "pot-logo pot-seed", "🤖"), "Malá robotická firma", "velký potenciál, hodnota asi 50 milionů $", 100],
    ]) {
      const row = el("div", "pot-row");
      const text = el("div", "pot-text");
      text.append(el("b", "", name), el("small", "", size));
      const track = el("div", "pot-track");
      const f = el("div", "pot-fill");
      f.style.setProperty("--w", `${mult}%`);
      track.append(f);
      const res = el("div", "pot-res");
      res.append(el("b", "", `třeba ×${mult}`), el("span", "", `1 000 Kč → ${formatCzk(1000 * mult)}`));
      row.append(pic, text, track, res);
      pot.append(row);
    }
    box.append(pot);

    const real = el("section", "panel cap-real");
    real.append(el("h3", "guide-h", "Market capy a jejich potenciály růstu"));
    for (const [logo, name, cap, mult] of [
      ["../assets/logos/discover/apple.png", "Apple", "asi 5 bilionů $", 2],
      ["../assets/logos/discover/bitcoin.png", "Bitcoin", "asi 1,7 bilionu $", 5],
      ["../assets/logos/tesla.png", "Tesla", "asi 1,2 bilionu $", 3],
      ["../assets/logos/discover/solana.png", "Solana", "asi 70 miliard $", 20],
      ["../assets/logos/sui.png", "Sui", "asi 4,7 miliardy $", 50],
      ["../assets/logos/bot.png", "RoboStrategy", "asi 700 milionů $", 100],
      ["../assets/logos/cards.png", "Collector Crypt", "asi 250 milionů $", 100],
      ["../assets/logos/cymetica.jpg", "Cymetica", "asi 1 milion $", 1000],
    ]) {
      const r = el("div", "cr-row");
      const text = el("div", "cr-text");
      text.append(el("b", "", name), el("strong", "", cap), el("small", "cr-grow", `1 000 Kč → ${formatCzk(1000 * mult)}`));
      const potential = el("div", "cr-pot");
      potential.append(el("small", "", "potenciál růstu"), el("b", "", `až ×${nf({ maximumFractionDigits: 0 }).format(mult)}`));
      r.append(logoImg(logo, "cr-logo"), text, potential);
      real.append(r);
    }
    box.append(real);
    buildAgeGuide(box);
  }

  /* ---- 3b. the advantage of being young (the end of the market cap part) ---- */

  function buildAgeGuide(box) {
    box.append(el("h2", "section-title guide-sub", "Jsi mladá, můžeš riskovat"));

    const lose = el("section", "panel age-lose");
    lose.append(el("h3", "guide-h", "Těch 10 % ročně dávají bezpečné investice"));
    lose.append(benchChips(), el("small", "pe-note", "za posledních 20 let, bez záruky"), el("p", "cd-text age-more", "Ty si ale můžeš dovolit víc:"));
    for (const [emoji, text] of [
      ["🏠", "Bydlíš u rodičů, nemáš nájem ani půjčky a budeš dál investovat."],
      ["💼", "V nejhorším budeš ve 25 letech chodit do práce, kam bys šla stejně."],
    ]) {
      const row = el("div", "yg-lose");
      row.append(el("span", "pc-emoji", emoji), el("span", "", text));
      lose.append(row);
    }
    lose.append(el("p", "cd-text", "Můžeš hledat věci, které nedají 10 %, ale třeba 100, 500, 1000 % a víc, například malé firmy a kryptoměny."));
    lose.append(el("p", "cd-text age-years", "Na riskování máš asi 15 let času."));
    box.append(lose);

    const fast = el("section", "panel age-fast");
    fast.append(el("h3", "guide-h", "Koule poroste mnohem rychleji"));
    fast.append(el("p", "cd-text", `Za jak dlouho se z ${formatCzk(START_AMOUNT)} stane ${formatCzk(PASSIVE_GOAL)}, když nepřidáváš další peníze a věc roste ročně o:`));
    const years = (r) => Math.log(PASSIVE_GOAL / START_AMOUNT) / Math.log(1 + r);
    const longest = years(0.1);
    for (const [r, label] of [[0.1, "10 % (bezpečné)"], [0.3, "30 %"], [1, "100 % (každý rok dvojnásobek)"]]) {
      const y = years(r);
      const row = el("div", "af-row");
      const head = el("div", "af-head");
      head.append(el("span", "", label), el("b", "", `${nf({ maximumFractionDigits: 0 }).format(Math.ceil(y))} let`));
      const track = el("div", "af-track");
      const f = el("div", "af-fill");
      f.style.setProperty("--w", `${Math.max(4, (y / longest) * 100)}%`);
      track.append(f);
      row.append(head, track);
      fast.append(row);
    }
    fast.append(
      el("p", "cd-text", `Když se hodnota zdvojnásobí každý rok, bude z ${formatCzk(START_AMOUNT)} za 15 let ${formatCzk(START_AMOUNT * 2 ** 15)}.`),
    );
    box.append(fast);

    const early = el("section", "panel age-early");
    early.append(el("h3", "guide-h", "Kdo byl u toho brzo, vydělal nejvíc"));
    early.append(el("p", "cd-text", "Máš asi 15 let času. Koukni na top investice, které za posledních 10 let vyrostly o tolik. Tolik by dnes měla tvoje koule, kdybys před 10 lety dala 1 300 Kč:"));
    const rows = el("div", "yg-rows");
    early.append(rows);
    Promise.all([guideData(), fetch("../assets/discover.json", { cache: "no-cache" }).then((r) => r.json()).catch(() => null)]).then(([d, list]) => {
      const info = Object.fromEntries((list?.items ?? []).map((i) => [i.id, i]));
      const best = Object.keys(d?.items ?? {})
        .filter((id) => info[id] && !info[id].cash && histChange(d, id, "10y") !== null)
        .map((id) => [id, histChange(d, id, "10y")])
        .sort((x, y) => y[1] - x[1])
        .slice(0, 5);
      for (const [id, ratio] of best) {
        const row = el("div", "live-row");
        const text = el("div", "live-text");
        text.append(el("b", "", info[id].name), liveLine(START_AMOUNT, ratio));
        row.append(logoImg(info[id].logo), text);
        rows.append(row);
      }
    });
    box.append(early);
    buildSimulator(box);
  }

  /* the big finish: a push towards the Objevuj tab */
  function discoverCta() {
    const card = el("section", "panel discover-cta");
    const logos = el("div", "dc-logos");
    for (const f of ["near.png", "hyperliquid.png", "solana.png", "nvidia.png", "bitcoin.png"]) logos.append(logoImg(`../assets/logos/discover/${f}`, "dc-logo"));
    card.append(el("div", "dc-emoji", "🚀"), logos);
    card.append(el("h3", "dc-title", "Další velká věc může být v Objevuj"));
    card.append(el("p", "dc-text", "Prohlédni si všechno, co můžeš sledovat, a najdi tu svoji."));
    const go = el("button", "dc-btn", "🧭 Otevřít Objevuj");
    go.type = "button";
    go.addEventListener("click", () => showTab("discover"));
    card.append(go);
    return card;
  }

  function pill(ratio, label) {
    const p = el("span", `disc-change is-${trend(ratio)}`);
    if (label) p.append(el("small", "", label));
    p.append(el("i", "arr", ARROW[trend(ratio)]), document.createTextNode(formatPct(ratio)));
    return p;
  }

  /* ---- 3c. what to invest in: big rows, only the 10 year change ---- */

  function buildInvestGuide(box) {
    box.append(sectionIntro("Bezpečnější základ a riskantnější věci s větším potenciálem."));

    const slots = [];
    const group = (title, rows) => {
      const card = el("section", "panel invest-card");
      card.append(el("h3", "guide-h", title));
      for (const [logo, name, note, id] of rows) {
        const row = el("div", "inv-row");
        const text = el("div", "inv-text");
        text.append(el("b", "", name), el("small", "", note));
        const chg = el("div", "inv-chg");
        row.append(logoImg(logo), text, chg);
        slots.push({ id, chg });
        card.append(row);
      }
      box.append(card);
    };

    group("Základ: nejbezpečnější", [
      ["../assets/logos/discover/sp500.png", "S&P 500", "500 největších firem USA", "sp500-xstock"],
      ["../assets/logos/discover/nasdaq.png", "Nasdaq 100", "100 největších technologických firem USA", "nasdaq-xstock"],
      ["../assets/logos/discover/bitcoin.png", "Bitcoin", "nejstarší a největší kryptoměna", "bitcoin"],
    ]);

    const mix = el("section", "panel invest-mix");
    mix.append(el("h3", "guide-h", "Kolik kam dáš, rozhoduješ ty"));
    mix.append(el("p", "cd-text", "Sama si určíš, kolik z portfolia dáš do bezpečných a kolik do riskantnějších věcí. Třeba:"));
    const mixInput = el("input");
    mixInput.type = "range";
    mixInput.min = "0";
    mixInput.max = "100";
    mixInput.step = "10";
    mixInput.value = "20";
    mixInput.setAttribute("aria-label", "Kolik procent dát do riskantnějších věcí");
    const mixBar = el("div", "mix-bar");
    const mixSafe = el("span", "mix-safe");
    const mixRisky = el("span", "mix-risky");
    mixBar.append(mixSafe, mixRisky);
    const mixText = el("div", "mix-text");
    const paintMix = () => {
      const risky = Number(mixInput.value);
      mixSafe.style.width = `${100 - risky}%`;
      mixRisky.style.width = `${risky}%`;
      mixText.replaceChildren(
        el("span", "mix-s", `🛡️ bezpečné ${100 - risky} %: ${formatCzk((START_AMOUNT * (100 - risky)) / 100)}`),
        el("span", "mix-r", `🚀 riskantní ${risky} %: ${formatCzk((START_AMOUNT * risky) / 100)}`),
      );
    };
    mixInput.addEventListener("input", paintMix);
    mix.append(mixBar, mixText, mixInput, el("small", "guide-note", `Příklad z ${formatCzk(START_AMOUNT)}.`));
    paintMix();
    box.append(mix);

    const risky = el("section", "panel invest-risky");
    risky.append(el("h3", "guide-h", "Riskantnější, ale s velkým potenciálem"));
    risky.append(el("p", "cd-text", "Nejvíc mohou vyrůst malé firmy nebo kryptoměny zaměřené na:"));
    const themes = el("div", "invest-themes");
    for (const [emoji, label] of [["🧠", "umělá inteligence"], ["🤖", "roboti"], ["🚀", "vesmír"], ["🧬", "biotechnologie"]]) {
      const t = el("div", "invest-theme");
      t.append(el("span", "invest-theme-ico", emoji), el("span", "", label));
      themes.append(t);
    }
    const note = el("div", "invest-note");
    note.append(el("span", "invest-note-ico", "⚖️"), el("span", "", "Čím menší firma, tím větší riziko, ale zároveň větší potenciál na růst."));
    risky.append(themes, note);
    box.append(risky);
    box.append(discoverCta());

    guideData().then((d) => {
      for (const { id, chg } of slots) {
        chg.replaceChildren();
        const r = histChange(d, id, "10y");
        if (r !== null) chg.append(pill(r, "10 let"));
        else chg.append(el("small", "inv-none", "méně než 10 let dat"));
      }
    });
  }

  /* ---- 4. the cheat sheet: the whole guide on one page ---- */

  function buildCheatGuide(box) {
    box.append(sectionIntro("Celá příručka v kostce."));
    const goal = (LIVING.reduce((a, r) => a + r[2], 0) * 12) / PASSIVE_YIELD;
    const rows = [
      ["💰", "Peníze", "money", [
        "1 000 Kč jsou 2 pizzy, milion je malé auto.",
        "Bilion je tisíc miliard (anglicky „trillion“).",
      ]],
      ["📈", "Růst o 100 %", "growth", [
        "K procentům přičti 100: +100 % je dvojnásobek, +200 % trojnásobek.",
        "Když cena klesne o 50 %, musí pak vzrůst o 100 %.",
      ]],
      ["🏖️", "Pasivní příjem", "passive", [
        `Abys nemusela pracovat, potřebuješ ${formatCzk(25000)} měsíčně, tedy ${formatCzk(300000)} ročně.`,
        `Bezpečně se dá vydělávat 10 % ročně, proto potřebuješ ${formatCzk(goal)}: 10 % z nich je ${formatCzk(300000)} ročně, tedy ${formatCzk(25000)} měsíčně.`,
        "S&P 500 a Nasdaq 100 dávaly za 20 let 11 až 16 % ročně.",
      ]],
      ["🏢", "Market cap", "cap", [
        "Market cap je hodnota celé firmy nebo kryptoměny: cena akcie × počet akcií.",
        "Čím menší firma, tím větší riziko, ale zároveň větší potenciál na růst.",
        "Jsi mladá a máš asi 15 let na riskování. Simulátor ukáže, kolik za ně můžeš mít.",
      ]],
      ["🧭", "Do čeho investovat", "invest", [
        "Bezpečný základ: S&P 500, Nasdaq 100 a Bitcoin.",
        "Riskantnější: malé firmy a krypto zaměřené na AI, roboty, vesmír a biotechnologie.",
        "Kolik kam dáš, rozhoduješ ty.",
      ]],
    ];
    for (const [emoji, title, section, lines] of rows) {
      const card = el("section", "panel cheat-card");
      const head = el("div", "cheat-head");
      head.append(el("span", "cheat-emoji", emoji), el("h3", "guide-h", title));
      const open = el("button", "cheat-open", "Otevřít");
      open.type = "button";
      open.setAttribute("aria-label", `Otevřít: ${title}`);
      open.addEventListener("click", () => showGuideSection(section));
      head.append(open);
      const list = el("ul", "cheat-list");
      for (const line of lines) list.append(el("li", "", line));
      card.append(head, list);
      box.append(card);
    }
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
    // crypto first, stocks below it (a holding without a group goes last); the order is stable inside a group
    holdings = holdings.map((h, i) => [h, i]).sort((a, b) => groupRank(a[0]) - groupRank(b[0]) || a[1] - b[1]).map(([h]) => h);
    buildProBar();

    $("content").hidden = false;
    buildPerf();
    perfRefs.box.hidden = false;
    perfRefs.num.textContent = "…";
    setHero(true);
    buildList();
    buildHistory();
    buildGuide();
    buildTabs();
    buildDiscover();

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
