#!/usr/bin/env node
/*
 * Builds assets/discover-history.json for the "Objevuj" tab: the price of every watched asset 10 years, 5 years and 1 year ago
 * (Yahoo Finance, in USD; the real stock / ETF / coin the token follows) and on the day of the genesis block (CoinGecko, the token itself).
 * The page compares those old prices with the live price from CoinGecko, so the percentages are always "up or down since then".
 *
 *   node tools/discover-history.mjs                     genesis day = startDate of p1/config.json
 *   node tools/discover-history.mjs --genesis 2026-10-07
 *
 * Also the "cash" row (Czech crowns): how much value the crown lost over each horizon. Inflation (Eurostat HICP for the Czech Republic) and
 * debasement (growth of the money supply M2, World Bank) are counted one after the other: (1 + inflation) x (1 + debasement) - 1, the way
 * a yearly loss is compounded. Both use a window of the same length that ends with the latest published month / year; for the genesis day
 * the last yearly rates are spread over the days.
 *
 * An item in assets/discover.json needs "yahoo": "<ticker>" to get the long horizons (no ticker: only the genesis day).
 * An asset that did not exist yet 5 or 10 years ago gets null (the page shows a dash).
 * Run it again whenever the genesis day changes, and now and then to refresh the 1 / 5 / 10 year dates.
 * Behind a proxy run with:  NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=<ca bundle> node tools/discover-history.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);

const items = JSON.parse(fs.readFileSync(path.join(ROOT, "assets/discover.json"), "utf8")).items.filter((i) => i.group !== "upcoming" && !i.cash);
const genesis = flag("--genesis") ?? JSON.parse(fs.readFileSync(path.join(ROOT, "p1/config.json"), "utf8")).startDate.slice(0, 10);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function getJson(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
      if (res.status === 429) throw new Error("rate limited");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (i === tries - 1) throw new Error(`${url}: ${err.message}`);
      await sleep(5000 * (i + 1));
    }
  }
}

const today = new Date();
const iso = (d) => d.toISOString().slice(0, 10);
const yearsAgo = (n) => {
  const d = new Date(today);
  d.setUTCFullYear(d.getUTCFullYear() - n);
  return d;
};
const horizons = { "10y": iso(yearsAgo(10)), "5y": iso(yearsAgo(5)), "1y": iso(yearsAgo(1)) };

/* Yahoo: daily closes; the first trading day on or after the date (null if the asset did not exist yet then) */
async function yahooSeries(symbol) {
  const from = Math.floor(yearsAgo(10).getTime() / 1000) - 10 * 86400;
  const to = Math.floor(today.getTime() / 1000) + 86400;
  const data = await getJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${from}&period2=${to}&interval=1d`);
  const r = data.chart.result[0];
  const close = r.indicators.quote[0].close;
  return r.timestamp.map((t, i) => [iso(new Date(t * 1000)), close[i]]).filter(([, c]) => c > 0);
}
function priceOn(series, date) {
  const hit = series.find(([d]) => d >= date);
  if (!hit) return null;
  const gap = (new Date(hit[0]) - new Date(date)) / 86400000;
  return gap > 10 ? null : hit[1];
}

const ids = items.map((i) => i.id);
const last = {};
const simple = await getJson(`https://api.coingecko.com/api/v3/simple/price?vs_currencies=usd&ids=${ids.join(",")}`);
for (const id of ids) last[id] = simple[id]?.usd ?? null;

const out = { asOf: iso(today), genesis, horizons, items: {} };
for (const it of items) {
  const row = { last: last[it.id] };
  if (it.yahoo) {
    const series = await yahooSeries(it.yahoo);
    for (const [key, date] of Object.entries(horizons)) row[key] = priceOn(series, date);
  } else {
    // no Yahoo ticker (e.g. a coin that is not listed there): only what CoinGecko's free history reaches, about a year back
    for (const key of Object.keys(horizons)) row[key] = null;
    try {
      const [y1, m1, d1] = horizons["1y"].split("-");
      const h1 = await getJson(`https://api.coingecko.com/api/v3/coins/${it.id}/history?date=${d1}-${m1}-${y1}&localization=false`);
      row["1y"] = h1.market_data?.current_price?.usd ?? null;
    } catch {
      row["1y"] = null;
    }
    await sleep(2500);
  }
  // the genesis day: the token itself, from CoinGecko (one call per asset, with pauses because of the rate limit)
  const [y, m, d] = genesis.split("-");
  try {
    const h = await getJson(`https://api.coingecko.com/api/v3/coins/${it.id}/history?date=${d}-${m}-${y}&localization=false`);
    row.genesis = h.market_data?.current_price?.usd ?? null;
  } catch (err) {
    console.error(`${it.id}: genesis price failed (${err.message})`);
    row.genesis = null;
  }
  out.items[it.id] = row;
  console.log(it.id.padEnd(18), JSON.stringify(row));
  await sleep(2500);
}
/* ---------- the Czech crown: inflation and debasement ---------- */
// inflation: Eurostat HICP (monthly); debasement: how much the money supply grew (World Bank, broad money M2 in crowns, yearly)
const hicp = await getJson("https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/prc_hicp_midx?format=JSON&lang=EN&geo=CZ&coicop=CP00&unit=I15&sinceTimePeriod=2015-01");
const months = Object.entries(hicp.dimension.time.category.index).sort((a, b) => a[1] - b[1]).map(([m, i]) => [m, hicp.value[String(i)]]).filter(([, v]) => v > 0);
const idx = Object.fromEntries(months);
const [lastMonth, lastIdx] = months[months.length - 1];
const monthsBack = (m, n) => {
  const [y, mo] = m.split("-").map(Number);
  const t = y * 12 + (mo - 1) - n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
};
const yoy = lastIdx / idx[monthsBack(lastMonth, 12)] - 1; // the last 12-month inflation

const wb = await getJson("https://api.worldbank.org/v2/country/CZ/indicator/FM.LBL.BMNY.CN?format=json&per_page=60&date=2010:2030");
const m2 = Object.fromEntries(wb[1].filter((r) => r.value > 0).map((r) => [Number(r.date), r.value]));
const m2Year = Math.max(...Object.keys(m2).map(Number));
const m2Growth = m2[m2Year] / m2[m2Year - 1] - 1; // the last yearly growth of the money supply

/* One number for the page: both losses of value one after the other, like a yearly loss that is compounded
   (1 000 Kc -> 1 000 x (1 - inflation) x (1 - debasement) ...). The two overlap in theory, but the page counts both. */
const withCombined = (c) => ({
  ...c,
  combined: c.inflation === null || c.debasement === null ? null : (1 + c.inflation) * (1 + c.debasement) - 1,
});
const cash = {};
for (const key of Object.keys(horizons)) {
  const n = Number(key.slice(0, -1));
  // a window of the same length that ends with the latest published month / year
  const thenIdx = idx[monthsBack(lastMonth, 12 * n)];
  const thenM2 = m2[m2Year - n];
  cash[key] = withCombined({ inflation: thenIdx ? thenIdx / lastIdx - 1 : null, debasement: thenM2 ? thenM2 / m2[m2Year] - 1 : null });
}
const days = (today - new Date(genesis)) / 86400000;
cash.genesis = withCombined({ inflation: (1 + yoy) ** (-days / 365) - 1, debasement: (1 + m2Growth) ** (-days / 365) - 1 });
out.cash = { ...cash, inflationYoY: yoy, inflationAsOf: lastMonth, moneySupplyGrowth: m2Growth, moneySupplyAsOf: String(m2Year) };
console.log("cash", JSON.stringify(out.cash));

fs.writeFileSync(path.join(ROOT, "assets/discover-history.json"), JSON.stringify(out, null, 1) + "\n");
console.log(`written assets/discover-history.json (genesis ${genesis}, as of ${out.asOf})`);
