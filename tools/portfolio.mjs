#!/usr/bin/env node
/*
 * Records what was bought and at which price, so the pages can show growth since the hand-over.
 *
 *   node tools/portfolio.mjs genesis p1            freeze today's prices as the starting point ("genesis")
 *   node tools/portfolio.mjs genesis all --force   start over: re-baseline everything at today's prices
 *   ... --start 2026-10-10                          also set the date shown as the start of tracking (startDate)
 *   node tools/portfolio.mjs add p1 SUI --czk 200  buy 200 CZK worth of SUI at today's price
 *   node tools/portfolio.mjs add p1 SUI --qty 5    buy 5 units of SUI at today's price
 *
 * A holding in config.json keeps its purchases as "lots": [{ "date", "qty", "price" }] (price in CZK per unit);
 * its "qty" is the sum of the lots (kept for older cached versions of the page).
 * Behind a proxy run with:  NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=<ca bundle> node tools/portfolio.mjs ...
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const [command, target, symbol] = args;

const isPrice = (n) => typeof n === "number" && Number.isFinite(n) && n > 0;

async function getJson(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (attempt === 2) throw new Error(`${url}: ${err.message}`);
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
    }
  }
}

async function currentPrices(holdings) {
  const cgIds = [...new Set(holdings.filter((h) => h.source.type === "coingecko").map((h) => h.source.id))];
  const out = new Map();
  if (cgIds.length) {
    const rows = await getJson(
      `https://api.coingecko.com/api/v3/coins/markets?vs_currency=czk&per_page=250&ids=${cgIds.join(",")}`,
    );
    for (const r of rows) if (isPrice(r.current_price)) out.set(`cg:${r.id}`, r.current_price);
  }
  const dex = holdings.filter((h) => h.source.type === "dexscreener");
  if (dex.length) {
    const fx = (await getJson("https://open.er-api.com/v6/latest/USD"))?.rates?.CZK;
    if (!isPrice(fx)) throw new Error("USD/CZK rate unavailable");
    for (const h of dex) {
      const { chain, address } = h.source;
      const pairs = await getJson(`https://api.dexscreener.com/tokens/v1/${chain}/${address}`);
      const best = pairs
        .filter((p) => isPrice(Number(p.priceUsd)))
        .sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
      if (best) out.set(`dex:${chain}:${address}`, Number(best.priceUsd) * fx);
    }
  }
  return out;
}

const keyOf = (h) => (h.source.type === "coingecko" ? `cg:${h.source.id}` : `dex:${h.source.chain}:${h.source.address}`);
const round = (n, digits) => Number(n.toFixed(digits));
const lotsOf = (h) => (Array.isArray(h.lots) ? h.lots : h.qty > 0 ? [{ qty: h.qty }] : []);
const totalQty = (h) => lotsOf(h).reduce((a, l) => a + l.qty, 0);
// "qty" stays in the file as the sum of the lots: an older cached version of the page only knows "qty".
const syncQty = (h) => {
  h.qty = round(totalQty(h), 6);
};

function load(id) {
  const file = path.join(ROOT, id, "config.json");
  if (!fs.existsSync(file)) throw new Error(`Unknown page "${id}" (no ${file})`);
  return { file, cfg: JSON.parse(fs.readFileSync(file, "utf8")) };
}
function save(file, cfg) {
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + "\n");
}
const pages = () => fs.readdirSync(ROOT).filter((d) => /^p\d+$/.test(d));

async function genesis(id) {
  const { file, cfg } = load(id);
  const force = args.includes("--force");
  const prices = await currentPrices(cfg.holdings);
  const now = new Date().toISOString();
  for (const h of cfg.holdings) {
    const qty = totalQty(h);
    if (!qty) continue;
    if (Array.isArray(h.lots) && h.lots.length && !force) {
      console.log(`${id} ${h.symbol}: already has a starting point (use --force to start over)`);
      continue;
    }
    const price = prices.get(keyOf(h));
    if (!isPrice(price)) throw new Error(`${id} ${h.symbol}: no current price, nothing written`);
    h.lots = [{ date: now, qty, price: round(price, 6) }];
    syncQty(h);
    console.log(`${id} ${h.symbol}: ${qty} units at ${round(price, 4)} CZK`);
  }
  if (flag("--start")) cfg.startDate = flag("--start");
  save(file, cfg);
}

async function add(id, sym) {
  const { file, cfg } = load(id);
  const h = cfg.holdings.find((x) => x.symbol.toLowerCase() === String(sym).toLowerCase());
  if (!h) throw new Error(`${id}: no holding with symbol "${sym}"`);
  const prices = await currentPrices([h]);
  const price = prices.get(keyOf(h));
  if (!isPrice(price)) throw new Error(`${id} ${h.symbol}: no current price, nothing written`);
  const qtyArg = Number(flag("--qty"));
  const czkArg = Number(flag("--czk"));
  const qty = qtyArg > 0 ? qtyArg : czkArg > 0 ? round(czkArg / price, 6) : NaN;
  if (!(qty > 0)) throw new Error("Give --qty <units> or --czk <amount>");
  if (!Array.isArray(h.lots)) {
    h.lots = h.qty > 0 ? [{ date: new Date().toISOString(), qty: h.qty, price: round(price, 6) }] : [];
  }
  h.lots.push({ date: new Date().toISOString(), qty, price: round(price, 6) });
  syncQty(h);
  save(file, cfg);
  console.log(`${id} ${h.symbol}: +${qty} units at ${round(price, 4)} CZK (= ${round(qty * price, 2)} CZK)`);
}

try {
  if (command === "genesis") {
    for (const id of target === "all" ? pages() : [target]) await genesis(id);
  } else if (command === "add") {
    await add(target, symbol);
  } else {
    console.log("Usage: genesis <id|all> [--force] | add <id> <symbol> --qty N | --czk N");
    process.exitCode = 1;
  }
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
}
