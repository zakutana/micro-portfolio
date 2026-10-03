#!/usr/bin/env node
/*
 * Generates the passwords and the printable cards (front + back with QR code and the password).
 *
 *   npm install                      (once)
 *   npm run cards                    create passwords if missing, update the hashes, render cards
 *   npm run cards -- --rotate p2     give page p2 a new password (the old one STOPS working, only do this on purpose)
 *   npm run cards -- --base https://example.com/micro-portfolio
 *
 * Each page has a 5-character password (lowercase letters + digits, without look-alikes such as 0/o or 1/l/i).
 * It is typed once on the phone and then remembered there. The QR code only opens the page (with ?n=<name>).
 * The plain passwords live ONLY in private/passwords.json and on the printed cards (private/ is git-ignored).
 * The people's names live ONLY in private/names.json, e.g. {"p1": "Name", "p2": "Other"}, and in the QR links.
 * The pages contain just a slow PBKDF2-SHA256 hash ("passHash") of the password, salted with "micro-portfolio:<id>".
 */
import { pbkdf2Sync, randomInt } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath, pathToFileURL } from "node:url";
import qrcode from "qrcode-generator";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PRIVATE = path.join(ROOT, "private");
const OUT = path.join(PRIVATE, "cards");
const PASSWORDS_FILE = path.join(PRIVATE, "passwords.json");

const args = process.argv.slice(2);
const argValue = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};

const people = JSON.parse(fs.readFileSync(path.join(ROOT, "tools/people.json"), "utf8"));
const baseUrl = (argValue("--base") ?? people.baseUrl).replace(/\/+$/, "");
const rotate = new Set(args.flatMap((a, i) => (a === "--rotate" ? [args[i + 1]] : [])));

/* ---------- Passwords ---------- */

const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"; // lowercase + digits, no 0/o, 1/l/i look-alikes
const PBKDF2_ITERATIONS = 200_000; // must match assets/app.js
const newPassword = () => Array.from({ length: 5 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
const hashOf = (id, password) =>
  pbkdf2Sync(password, `micro-portfolio:${id}`, PBKDF2_ITERATIONS, 32, "sha256").toString("hex");

fs.mkdirSync(OUT, { recursive: true });
const NAMES_FILE = path.join(PRIVATE, "names.json");
if (!fs.existsSync(NAMES_FILE)) throw new Error(`Missing ${NAMES_FILE}, expected {"<id>": "<name>", ...}`);
const names = JSON.parse(fs.readFileSync(NAMES_FILE, "utf8"));
for (const p of people.people) {
  p.name = names[p.id];
  if (!p.name) throw new Error(`No name for "${p.id}" in ${NAMES_FILE}`);
}
const passwords = fs.existsSync(PASSWORDS_FILE) ? JSON.parse(fs.readFileSync(PASSWORDS_FILE, "utf8")) : {};

for (const id of rotate) {
  if (!people.people.some((p) => p.id === id)) throw new Error(`--rotate "${id}": unknown page id`);
}

// First work everything out and validate it, then write: passwords.json before the configs, so a failure half-way
// can never leave a config pointing at a password that was not saved.
const planned = [];
for (const p of people.people) {
  const configPath = path.join(ROOT, p.id, "config.json");
  const cfg = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const alreadyIssued = /^[0-9a-f]{64}$/.test(cfg.passHash ?? "");

  // Never silently replace a password that is already printed on a card.
  if (!passwords[p.id] && alreadyIssued && !rotate.has(p.id)) {
    throw new Error(
      `${p.id} already has a password in use, but it is missing from ${PASSWORDS_FILE}.\n` +
        `The printed card is still valid. Restore the password into ${PASSWORDS_FILE} (it is written on the card),\n` +
        `or run with --rotate ${p.id} if you really want a new password and new cards.`,
    );
  }
  if (!passwords[p.id] || rotate.has(p.id)) passwords[p.id] = newPassword();

  const next = { passHash: hashOf(p.id, passwords[p.id]) };
  for (const [key, value] of Object.entries(cfg)) if (key !== "passHash" && key !== "codeHash") next[key] = value;
  planned.push({ configPath, text: JSON.stringify(next, null, 2) + "\n" });
}
fs.writeFileSync(PASSWORDS_FILE, JSON.stringify(passwords, null, 2) + "\n");
for (const { configPath, text } of planned) fs.writeFileSync(configPath, text);

/* ---------- Cards ---------- */

const icons = {};
vm.runInNewContext(fs.readFileSync(path.join(ROOT, "assets/icons.js"), "utf8"), { window: icons });
const MASCOTS = icons.MICRO_ICONS;

function qrSvg(text) {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  let d = "";
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) if (qr.isDark(y, x)) d += `M${x} ${y}h1v1h-1z`;
  }
  return `<svg viewBox="0 0 ${n} ${n}" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges"><path d="${d}" fill="#14142b"/></svg>`;
}

const PALETTES = {
  pink: {
    bg: "radial-gradient(circle at 15% 12%, rgba(255,255,255,.7) 0 9mm, transparent 9.2mm), radial-gradient(circle at 24% 14%, rgba(255,255,255,.7) 0 12mm, transparent 12.2mm), radial-gradient(circle at 92% 20%, rgba(255,255,255,.5) 0 10mm, transparent 10.2mm), linear-gradient(160deg, #ffd9ec 0%, #ff9fcc 100%)",
    title: "#ffffff",
    titleShadow: "0 .35mm 0 #e05a9c, 0 .9mm 1.6mm rgba(224,90,156,.4)",
    name: "#ffffff",
    nameShadow: "0 1mm 0 #e05a9c, 0 2mm 3mm rgba(190,50,120,.35)",
    sub: "#8a2c62",
    panel: "#ffffff",
    panelBorder: "#ff8cc3",
    ink: "#6b2450",
  },
  blue: {
    bg: "radial-gradient(circle at 50% -15%, rgba(255,255,255,.22) 0 28mm, transparent 28.2mm), repeating-linear-gradient(135deg, rgba(255,255,255,.06) 0 5mm, transparent 5mm 10mm), linear-gradient(160deg, #4aa3ee 0%, #1d5a9a 100%)",
    title: "#ffffff",
    titleShadow: "0 .35mm 0 #1b3f7a",
    name: "#ffcb05",
    nameShadow: "0 .8mm 0 #2a3c8f, .5mm .5mm 0 #2a3c8f, -.5mm .5mm 0 #2a3c8f, 0 2mm 3mm rgba(8,30,70,.4)",
    sub: "#dcecff",
    panel: "#ffffff",
    panelBorder: "#ffcb05",
    ink: "#1c2b4d",
  },
};

function cardInner(person, side) {
  const pal = PALETTES[person.palette];
  const style = `--bg:${pal.bg};--title:${pal.title};--titleShadow:${pal.titleShadow};--name:${pal.name};--nameShadow:${pal.nameShadow};--sub:${pal.sub};--panel:${pal.panel};--panelBorder:${pal.panelBorder};--ink:${pal.ink}`;
  const mascot = MASCOTS[person.mascot];

  if (side === "front") {
    return `<div class="card front" style="${style}">
      <div class="f-title">Micro portfolio</div>
      <div class="f-name">${person.name}</div>
      <div class="f-mascot ${person.mascot}">${mascot}</div>
      <div class="star s1"><svg viewBox="0 0 24 24"><polygon points="12,1.5 15,8.6 22.5,9.2 16.8,14.1 18.6,21.5 12,17.5 5.4,21.5 7.2,14.1 1.5,9.2 9,8.6" fill="#ffd84a" stroke="#f0a91c" stroke-width="1.2" stroke-linejoin="round"/></svg></div><div class="star s2"><svg viewBox="0 0 24 24"><polygon points="12,1.5 15,8.6 22.5,9.2 16.8,14.1 18.6,21.5 12,17.5 5.4,21.5 7.2,14.1 1.5,9.2 9,8.6" fill="#ffd84a" stroke="#f0a91c" stroke-width="1.2" stroke-linejoin="round"/></svg></div><div class="star s3"><svg viewBox="0 0 24 24"><polygon points="12,1.5 15,8.6 22.5,9.2 16.8,14.1 18.6,21.5 12,17.5 5.4,21.5 7.2,14.1 1.5,9.2 9,8.6" fill="#ffd84a" stroke="#f0a91c" stroke-width="1.2" stroke-linejoin="round"/></svg></div>
    </div>`;
  }
  const url = `${baseUrl}/${person.id}/?n=${encodeURIComponent(person.name)}`;
  return `<div class="card back" style="${style}">
    <div class="b-left">
      <div class="b-mascot ${person.mascot}">${mascot}</div>
      <div class="b-scan">Naskenuj<br>kamerou<br>mobilu</div>
      <div class="b-foot">Micro portfolio<br><b>${person.name}</b></div>
    </div>
    <div class="b-right">
      <div class="b-qr">${qrSvg(url)}</div>
      <div class="b-pass"><span>heslo</span><b>${passwords[person.id]}</b></div>
    </div>
  </div>`;
}

const CSS = `
  @page { margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; background: #fff; }
  body { font-family: "Fredoka", system-ui, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .card { position: relative; width: 85.6mm; height: 54mm; overflow: hidden; background: var(--bg); color: var(--ink); }
  .card svg { display: block; width: 100%; height: 100%; }

  .front .f-title { position: absolute; left: 7mm; top: 6mm; font-size: 7mm; font-weight: 700; line-height: 1; color: var(--title); text-shadow: var(--titleShadow); }
  .front .f-name { position: absolute; left: 6.5mm; bottom: 5mm; font-size: 16mm; font-weight: 700; line-height: 1; color: var(--name); text-shadow: var(--nameShadow); }
  .front .f-mascot { position: absolute; right: 6mm; bottom: 5.5mm; width: 23mm; height: 23mm; filter: drop-shadow(0 1mm 0 rgba(0,0,0,.18)); }

  .front .f-mascot.waddle { right: 4mm; bottom: 3mm; width: 30mm; height: 30mm; }
  .back .b-mascot.waddle { width: 17mm; height: 17mm; }
  .front .star { position: absolute; filter: drop-shadow(0 .4mm 0 rgba(0,0,0,.15)); }
  .front .s1 { right: 28mm; bottom: 24mm; width: 5mm; height: 5mm; transform: rotate(-14deg); }
  .front .s2 { right: 4mm; bottom: 31mm; width: 6.5mm; height: 6.5mm; transform: rotate(12deg); }
  .front .s3 { right: 12mm; top: 5mm; width: 4mm; height: 4mm; }

  .back { display: flex; align-items: center; justify-content: space-between; padding: 0 6mm 0 6.5mm; }
  .back .b-left { display: flex; flex-direction: column; align-items: flex-start; justify-content: space-between; height: 40mm; width: 28mm; }
  .back .b-mascot { width: 13mm; height: 13mm; filter: drop-shadow(0 .6mm 0 rgba(0,0,0,.18)); }
  .back .b-scan { font-size: 4.3mm; font-weight: 700; line-height: 1.15; color: var(--title); text-shadow: var(--titleShadow); }
  .back .b-foot { font-size: 2.6mm; font-weight: 500; line-height: 1.25; color: var(--sub); }
  .back .b-foot b { font-size: 3.4mm; font-weight: 700; }
  .back .b-right { display: flex; flex-direction: column; align-items: center; gap: 2mm; }
  .back .b-qr { width: 36mm; height: 36mm; padding: 3mm; background: var(--panel); border: .8mm solid var(--panelBorder); border-radius: 3mm; box-shadow: 0 .8mm 0 rgba(0,0,0,.18); }
  .back .b-pass { display: flex; align-items: baseline; gap: 2.2mm; padding: .9mm 3.6mm; background: var(--panel); border: .6mm solid var(--panelBorder); border-radius: 2.2mm; color: var(--ink); box-shadow: 0 .6mm 0 rgba(0,0,0,.18); }
  .back .b-pass span { font-size: 2.6mm; font-weight: 600; text-transform: uppercase; letter-spacing: .25mm; }
  .back .b-pass b { font-family: ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace; font-size: 5.6mm; font-weight: 800; letter-spacing: .9mm; }

  .sheet { width: 210mm; height: 297mm; padding: 18mm 0 0 17mm; display: flex; flex-direction: column; gap: 12mm; background: #fff; }
  .sheet .row { display: flex; gap: 10mm; align-items: center; }
  .sheet .cut { outline: .2mm dashed #888; outline-offset: .6mm; }
  .sheet .label { font: 3mm/1.3 system-ui, sans-serif; color: #777; margin: 0 0 2mm; }
`;

const htmlDoc = (body) =>
  `<!doctype html><html lang="cs"><head><meta charset="utf-8"><link rel="stylesheet" href="../../assets/style.css"><style>${CSS}</style></head><body>${body}</body></html>`;

const pageFile = path.join(OUT, "_render.html");
const pageUrl = pathToFileURL(pageFile).href;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const ctx = await browser.newContext({ deviceScaleFactor: 4 }); // ~390 dpi PNGs
const page = await ctx.newPage();

async function load(body) {
  fs.writeFileSync(pageFile, htmlDoc(body));
  await page.goto(pageUrl);
  await page.evaluate(() => document.fonts.ready);
}

const written = [];
for (const person of people.people) {
  for (const side of ["front", "back"]) {
    await load(cardInner(person, side));
    const file = path.join(OUT, `${person.id}-${side}.png`);
    await page.locator(".card").screenshot({ path: file });
    written.push(file);
  }
  // Two-page PDF (front, back) in the exact credit-card size, for a print shop.
  await load(cardInner(person, "front") + cardInner(person, "back"));
  const pdf = path.join(OUT, `${person.id}-card.pdf`);
  await page.addStyleTag({ content: ".card{break-after:page} .card:last-child{break-after:auto}" });
  await page.pdf({ path: pdf, width: "85.6mm", height: "54mm", printBackground: true, preferCSSPageSize: false });
  written.push(pdf);
}

// A4 sheet for home printing: one row per person, front on the left, back on the right.
const rows = people.people
  .map(
    (p) => `<div><p class="label">${p.name}: přední strana, zadní strana (vystřihnout a slepit)</p>
      <div class="row"><div class="cut">${cardInner(p, "front")}</div><div class="cut">${cardInner(p, "back")}</div></div></div>`,
  )
  .join("");
await load(`<div class="sheet">${rows}</div>`);
const sheet = path.join(OUT, "karticky-A4.pdf");
await page.pdf({ path: sheet, format: "A4", printBackground: true });
written.push(sheet);

await browser.close();
fs.rmSync(pageFile);

console.log(written.map((f) => path.relative(ROOT, f)).join("\n"));
