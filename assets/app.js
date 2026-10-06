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
  const GLOSSARY = [
    ["Cena za kus", "Kolik stojí jedna jednotka právě teď. Mění se každou chvíli."],
    ["Nákupní cena", "Průměrná cena, za kterou byly ty kusy koupené. Když nakoupíš ve dvou dnech za různé ceny, spočítá se průměr."],
    ["Zisk / ztráta", "Rozdíl mezi dnešní hodnotou a tím, co sis do toho vložila. Plus znamená, že to roste, minus, že je to teď míň. Dokud nic neprodáš, je to jen na papíře."],
    ["Za 24 hodin", "O kolik se cena změnila za poslední den. Jeden špatný den ještě nic neznamená."],
    ["Tržní kapitalizace", "Kolik by stála všechna ta mince nebo všechny akcie firmy dohromady. Větší je obvykle stabilnější a menší může kolísat víc."],
    ["Podíl", "Kolik procent celého portfolia tvoří tahle položka. Když je peníze rozložené do víc věcí, jedna špatná zpráva nepokazí všechno."],
    ["Inflace", "O kolik se zdražilo. Když ceny stoupnou o 10 %, koupíš za stejné koruny o desetinu míň věcí. Koruny v peněžence ani na účtu tedy pomalu ztrácejí sílu, i když jejich číslo zůstává stejné."],
    ["Debasement", "Postupné ředění peněz: stát a banky vytvářejí víc a víc nových peněz (peněžní zásoba v Česku roste zhruba o 7 % ročně), takže každá koruna znamená míň. V Objevuj u měn počítáme inflaci a debasement jedno po druhém, jako kdyby ti každý rok z těch zbylých peněz oba ubrali svůj kus."],
    ["Crypto", "Digitální peníze a žetony, které existují jen na internetu, třeba Bitcoin, Sui nebo COTI. Obchoduje se s nimi pořád, i v noci a o víkendu, a cena umí poskočit nebo spadnout o desítky procent za den."],
    ["Akcie", "Malý kousek firmy. Když se firmě daří, hodnota její akcie může růst, a když ne, může klesat. U nás jsou to digitální kopie skutečných akcií, takže se s nimi dá obchodovat i o víkendu."],
    ["Indexy", "Balíček stovek firem najednou, třeba S&P 500 je 500 největších firem USA. Když koupíš index, rozložíš peníze do spousty firem a jedna špatná zpráva ti tolik neublíží. Většinou kolísá míň než jedna akcie."],
    ["Genesis blok", "Úplně první nákup, od kterého se počítá růst. Každý další nákup je další blok. Když v Objevuj zvolíš „Od genesis bloku“, uvidíš, o kolik se věc změnila od dne, kdy jste začali."],
    ["Komodity", "Suroviny, které se těží nebo pěstují, třeba zlato, stříbro nebo ropa. Jejich cena se mění podle toho, kolik jich lidé potřebují a kolik se jich najde. Zlato a stříbro lidé odpradávna používají jako uchovatele hodnoty, ropa je spíš surovina pro průmysl a dopravu a její cena kolísá víc."],
    ["Měny", "Peníze, které používá nějaký stát, třeba koruna nebo dolar. Hodnotu jim nedává zlato ani žádný kov, ale důvěra v ně. Státy a banky je můžou tisknout skoro bez omezení, a proto všechny měny časem ztrácejí hodnotu. V Objevuj vidíš, o kolik za zvolenou dobu přišla koruna."],
    ["Collectibles", "Sběratelské věci, které mají cenu proto, že jich je málo a lidé je chtějí, třeba vzácné Pokémon karty. Cena závisí na tom, jak je karta vzácná, kolik jí zbylo a v jakém je stavu. Na rozdíl od akcií nic nevydělávají, hodnota je jen v tom, že za ně někdo jednou zaplatí víc."],
    ["PSA 10", "Nejvyšší známka, jakou může karta dostat od firmy PSA, která karty prověřuje a zapouzdří do plastu. 10 znamená skoro dokonalý stav. Karta v téhle známce stojí i několikanásobně víc než stejná karta s drobnými vadami."],
    ["Upcoming", "Firmy, které se zatím nedají koupit na burze, ale lidé čekají, že tam jednou vstoupí (to se říká IPO). Zatím u nich nejsou ceny, jen štítek „brzy“."],
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
  ];
  const TAB_ICONS = {
    portfolio: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5V12h8.5"/>',
    history: '<path d="M5 6.5h14M5 12h14M5 17.5h8.5"/>',
    discover: '<circle cx="12" cy="12" r="8.5"/><path d="M15.8 8.2l-2.1 5.5-5.5 2.1 2.1-5.5z"/>',
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
    setHero(id === "portfolio");
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
    const saved = store.get("range");
    if (saved && [...select.options].some((o) => o.value === saved)) select.value = saved;
    select.addEventListener("change", () => {
      store.set("range", select.value);
      paintChanges();
    });
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
    buildGlossary();
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
