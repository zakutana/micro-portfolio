#!/usr/bin/env node
/*
 * Builds assets/discover-history.json for the "Objevuj" tab: the price of every watched asset 10 years, 5 years and 1 year ago
 * (Yahoo Finance, in USD; the real stock / ETF / coin the token follows) and on the day of the genesis block (CoinGecko, the token itself).
 * The page compares those old prices with the live price from CoinGecko, so the percentages are always "up or down since then".
 *
 *   node tools/discover-history.mjs                     genesis day = startDate of p1/config.json
 *   node tools/discover-history.mjs --genesis 2026-10-07
 *
 * Also the "cash" row (Czech crowns): how much value the crown lost over each horizon, from two sides that are shown separately
 * (the page shows one number, "combined": what a crown buys of a basket that is half everyday goods and half gold): inflation (Eurostat HICP for the Czech Republic: a window of the same length that ends with the latest
 * published month; for the genesis day the last 12-month rate spread over the days) and debasement (how much less gold one crown buys: gold in USD from Yahoo x USD/CZK from Yahoo).
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
    for (const key of Object.keys(horizons)) row[key] = null;
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
const goldUsd = await yahooSeries("GC=F");
const usdCzk = await yahooSeries("USDCZK=X");
const goldCzkOn = (date) => {
  const g = priceOn(goldUsd, date);
  const f = priceOn(usdCzk, date);
  return g && f ? g * f : null;
};
const lastOf = (series) => series[series.length - 1][1];
const goldCzkNow = lastOf(goldUsd) * lastOf(usdCzk);

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
/* One number for the page: what one crown buys of a basket that is half everyday goods (inflation) and half gold (debasement). */
const withCombined = (c) => ({
  ...c,
  combined: c.inflation === null || c.debasement === null ? null : 1 / (0.5 / (1 + c.inflation) + 0.5 / (1 + c.debasement)) - 1,
});
const cash = {};
for (const [key, date] of Object.entries(horizons)) {
  // inflation: the window of the same length that ends with the latest month Eurostat has published
  const then = idx[monthsBack(lastMonth, 12 * Number(key.slice(0, -1)))];
  const g = goldCzkOn(date);
  cash[key] = withCombined({ inflation: then ? then / lastIdx - 1 : null, debasement: g ? g / goldCzkNow - 1 : null });
}
const days = (today - new Date(genesis)) / 86400000;
const gGen = goldCzkOn(genesis);
cash.genesis = withCombined({ inflation: (1 + yoy) ** (-days / 365) - 1, debasement: gGen ? gGen / goldCzkNow - 1 : null });
out.cash = { ...cash, inflationYoY: yoy, inflationAsOf: lastMonth };
console.log("cash", JSON.stringify(out.cash));

fs.writeFileSync(path.join(ROOT, "assets/discover-history.json"), JSON.stringify(out, null, 1) + "\n");
console.log(`written assets/discover-history.json (genesis ${genesis}, as of ${out.asOf})`);
