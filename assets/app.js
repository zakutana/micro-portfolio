/* Micro portfolio – page logic (no build step, no dependencies). */
(() => {
  "use strict";

  const cfg = window.MICRO_PORTFOLIO;
  const icons = window.MICRO_ICONS;

  const THEMES = [
    { id: "minecraft", label: "Minecraft", color: "#7a5230" },
    { id: "kirby", label: "Kirby", color: "#ff9ccf" },
    { id: "pokemon", label: "Pokémon", color: "#2a75bb" },
  ];

  const COINGECKO = "https://api.coingecko.com/api/v3";
  const DEXSCREENER = "https://api.dexscreener.com/tokens/v1";
  const FX_URLS = [
    "https://open.er-api.com/v6/latest/USD",
    "https://api.frankfurter.dev/v1/latest?base=USD&symbols=CZK",
  ];
  const REFRESH_MS = 60_000;

  const NS = `micro-portfolio:${cfg.id}`;
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

  const root = document.documentElement;

  function currentTheme() {
    const saved = store.get("theme");
    return THEMES.some((t) => t.id === saved) ? saved : cfg.defaultTheme;
  }

  function applyTheme(id) {
    root.dataset.theme = id;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = THEMES.find((t) => t.id === id).color;
    const mascot = document.getElementById("mascot");
    if (mascot) mascot.innerHTML = icons[id];
    document.querySelectorAll(".theme-btn").forEach((btn) => {
      btn.setAttribute("aria-pressed", String(btn.dataset.theme === id));
    });
  }

  applyTheme(currentTheme());

  /* ---------- Access code ---------- */

  async function sha256Hex(text) {
    const bytes = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  }

  async function isUnlocked() {
    const fromUrl = new URLSearchParams(location.search).get("k");
    const candidates = [fromUrl, store.get("key")].filter(Boolean).map((c) => c.trim());
    for (const code of candidates) {
      try {
        if ((await sha256Hex(`${cfg.id}:${code}`)) === cfg.codeHash) {
          store.set("key", code);
          return true;
        }
      } catch {
        return false;
      }
    }
    return false;
  }

  /* The owner's name travels in the QR link (?n=...), so it never has to live in the repo. */
  function showOwner() {
    const fromUrl = new URLSearchParams(location.search).get("n");
    if (fromUrl) store.set("name", fromUrl.trim().slice(0, 30));
    const name = store.get("name");
    if (!name) return;
    $("owner").textContent = name;
    document.title = `Micro portfolio · ${name}`;
  }

  /* ---------- Prices (all converted to CZK) ---------- */

  async function getJson(url, timeoutMs = 10_000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(timer);
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
      return new Map(rows.filter((r) => isPrice(r.current_price)).map((r) => [r.id, r.current_price]));
    } catch {
      return new Map();
    }
  }

  /* Tokenised stocks (e.g. RoboStrategy BOT) and other on-chain tokens, priced in USD. */
  async function fetchDexUsd({ chain, address }) {
    try {
      const pairs = await getJson(`${DEXSCREENER}/${chain}/${address}`);
      const best = pairs
        .filter((p) => isPrice(Number(p.priceUsd)))
        .sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
      return best ? Number(best.priceUsd) : null;
    } catch {
      return null;
    }
  }

  const sourceKey = (h) =>
    h.source.type === "coingecko" ? `cg:${h.source.id}` : `dex:${h.source.chain}:${h.source.address}`;

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
    const holdings = cfg.holdings;
    const dexHoldings = holdings.filter((h) => h.source.type === "dexscreener");
    const cgIds = [...new Set(holdings.filter((h) => h.source.type === "coingecko").map((h) => h.source.id))];

    const [cg, fxLive, ...dexUsd] = await Promise.all([
      fetchCoinGecko(cgIds),
      dexHoldings.length ? fetchUsdCzk() : null,
      ...dexHoldings.map((h) => fetchDexUsd(h.source)),
    ]);
    const fx = fxLive ?? cache.fx ?? null;
    const dexByKey = new Map(dexHoldings.map((h, i) => [sourceKey(h), dexUsd[i]]));

    const fresh = {};
    const items = holdings.map((h) => {
      const key = sourceKey(h);
      let price = null;
      if (h.source.type === "coingecko") {
        price = cg.get(h.source.id) ?? null;
      } else if (isPrice(dexByKey.get(key)) && isPrice(fx)) {
        price = dexByKey.get(key) * fx;
      }
      if (isPrice(price)) {
        fresh[key] = price;
        return { holding: h, price, live: true };
      }
      const stale = cachedPrices[key];
      return { holding: h, price: isPrice(stale) ? stale : null, live: false };
    });

    store.set(
      "prices",
      JSON.stringify({ prices: { ...cachedPrices, ...fresh }, fx: fx ?? null, ts: Date.now() }),
    );
    return { items, allLive: items.every((i) => i.live), cachedAt: cache.ts ?? null };
  }

  /* ---------- Rendering ---------- */

  const czk = new Intl.NumberFormat("cs-CZ", { style: "currency", currency: "CZK", maximumFractionDigits: 0 });
  const czkSmall = new Intl.NumberFormat("cs-CZ", { style: "currency", currency: "CZK", maximumFractionDigits: 2 });
  const formatCzk = (v) => (v < 100 ? czkSmall : czk).format(v);

  const $ = (id) => document.getElementById(id);

  function logoNode(h) {
    const box = document.createElement("span");
    box.className = "logo";
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

  function buildList() {
    const list = $("list");
    list.replaceChildren();
    for (const h of cfg.holdings) {
      const li = document.createElement("li");
      const a = document.createElement("a");
      a.className = "row";
      a.href = h.url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.setAttribute("aria-label", `${h.name} – otevřít web`);

      const name = document.createElement("span");
      name.className = "name";
      const strong = document.createElement("strong");
      strong.textContent = h.name;
      const small = document.createElement("small");
      small.textContent = h.symbol;
      name.append(strong, small);

      const value = document.createElement("span");
      value.className = "value is-loading";
      value.textContent = "…";

      a.append(logoNode(h), name, value);
      li.append(a);
      list.append(li);
    }
  }

  function showPrices({ items, allLive, cachedAt }) {
    const values = document.querySelectorAll("#list .value");
    let total = 0;
    let known = 0;

    items.forEach((item, i) => {
      const el = values[i];
      el.classList.remove("is-loading");
      el.classList.toggle("is-stale", !item.live);
      if (item.price === null) {
        el.textContent = "—";
        return;
      }
      const value = item.price * item.holding.qty;
      total += value;
      known += 1;
      el.textContent = formatCzk(value);
    });

    $("total").textContent = known ? formatCzk(total) : "—";

    const status = $("status");
    status.classList.toggle("is-warn", !allLive);
    const time = (ts) => new Date(ts).toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" });
    const dot = '<span class="dot"></span>';
    if (allLive) {
      status.innerHTML = `${dot}Živé ceny · ${time(Date.now())}`;
    } else if (known) {
      const when = cachedAt ? ` (naposledy ${time(cachedAt)})` : "";
      status.innerHTML = `${dot}Ceny se nepodařilo načíst, ukazuju poslední známé${when}`;
    } else {
      status.innerHTML = `${dot}Ceny se teď nepodařilo načíst. Zkus to za chvíli.`;
    }
  }

  /* ---------- Boot ---------- */

  function buildThemePicker() {
    const bar = $("themes");
    for (const t of THEMES) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "theme-btn";
      btn.dataset.theme = t.id;
      btn.innerHTML = icons[t.id];
      btn.title = t.label;
      btn.setAttribute("aria-label", `Motiv ${t.label}`);
      btn.addEventListener("click", () => {
        store.set("theme", t.id);
        applyTheme(t.id);
      });
      bar.append(btn);
    }
    applyTheme(currentTheme());
  }

  async function start() {
    buildThemePicker();

    if (!(await isUnlocked())) {
      $("lock").hidden = false;
      return;
    }

    showOwner();

    $("content").hidden = false;
    $("total-bar").hidden = false;
    buildList();

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
