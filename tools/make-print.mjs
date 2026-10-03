#!/usr/bin/env node
/*
 * Print-ready PDF for the plastic cards (digital print, e.g. BlackCard): CMYK, with bleed, vector only.
 *
 *   npm run print                      -> private/cards/karticky-tisk-CMYK.pdf  (+ PNG previews of every page)
 *
 * Format: every card side is one PDF page of 91.5 x 60 mm (3 mm bleed on every side); the finished card
 * is 85.5 x 54 mm after trimming (the printer rounds the corners, so none are drawn). Order of the pages:
 * card 1 front, card 1 back, card 2 front, card 2 back. Texts and the QR code stay inside the safe zone,
 * the QR code (black on white, 3 mm white around it) is at least 5 mm from the trimmed edge.
 * Everything is vector (no raster images), fonts are embedded, colours are converted to CMYK with Ghostscript
 * and TrimBox/BleedBox are set. At the end the QR codes are scanned back from the finished PDF.
 *
 * Needs: Ghostscript (gs), poppler-utils (pdftoppm, pdfinfo, pdffonts, pdfimages), Python 3 with pikepdf and opencv-python-headless
 * (tools/print-post.py), Chromium.
 * Names come from private/names.json, the card numbers (they hide the passwords) from private/passwords.json (tools/password.mjs).
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath, pathToFileURL } from "node:url";
import qrcode from "qrcode-generator";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PRIVATE = path.join(ROOT, "private");
const OUT = path.join(PRIVATE, "cards");
const TMP = path.join(OUT, "tisk-tmp");
const FINAL = path.join(OUT, "karticky-tisk-CMYK.pdf"); // no marks (BlackCard)
const FINAL_MARKS = path.join(OUT, "karticky-tisk-CMYK-se-znackami.pdf"); // with crop marks (M CARD asks for them)
const SLUG = 8; // mm of white margin around the bleed on the version with crop marks

const PAGE_W = 91.5; // mm, with bleed
const PAGE_H = 60;
const BLEED = 3;
const PT = 72 / 25.4; // points per mm

const people = JSON.parse(fs.readFileSync(path.join(ROOT, "tools/people.json"), "utf8"));
const names = JSON.parse(fs.readFileSync(path.join(PRIVATE, "names.json"), "utf8"));
const passwords = JSON.parse(fs.readFileSync(path.join(PRIVATE, "passwords.json"), "utf8"));
const baseUrl = people.baseUrl.replace(/\/+$/, "");
// the date of the first purchase, as shown on the page ("od 10. 10. 2026"); set "startDate" in tools/people.json
const [sy, sm, sd] = people.startDate.split("-").map(Number);
const START = `${sd}. ${sm}. ${sy}`;
for (const person of people.people) {
  const cfgStart = JSON.parse(fs.readFileSync(path.join(ROOT, person.id, "config.json"), "utf8")).startDate;
  if (cfgStart !== people.startDate) console.warn(`Note: ${person.id}/config.json has startDate ${cfgStart}, the card says ${people.startDate}.`);
}

const icons = {};
vm.runInNewContext(fs.readFileSync(path.join(ROOT, "assets/icons.js"), "utf8"), { window: icons });
const MASCOT = { kirby: icons.MICRO_ICONS.kirby, waddle: icons.MICRO_ICONS.waddle };

/* ---------- QR code (vector, black) ---------- */

const MODULE = 0.7; // mm per module
const QUIET = 3; // mm of white on every side (at least 2.5 mm requested)

function qrTile(url) {
  const qr = qrcode(0, "M");
  qr.addData(url);
  qr.make();
  const n = qr.getModuleCount();
  let d = "";
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; ) {
      if (!qr.isDark(y, x)) {
        x++;
        continue;
      }
      let len = 0;
      while (x + len < n && qr.isDark(y, x + len)) len++;
      d += `M${x} ${y}h${len}v1.02h-${len}z`; // runs of dark modules; the tiny overlap closes hairline seams
      x += len;
    }
  }
  const side = n * MODULE + 2 * QUIET;
  return {
    side,
    n,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${side}mm" height="${side}mm" viewBox="${-QUIET / MODULE} ${-QUIET / MODULE} ${side / MODULE} ${side / MODULE}">
      <rect x="${-QUIET / MODULE}" y="${-QUIET / MODULE}" width="${side / MODULE}" height="${side / MODULE}" fill="#fff"/>
      <path d="${d}" fill="#000"/></svg>`,
  };
}

/* ---------- Symbols of the holdings, scattered over the back ---------- */

// pixel sizes of the logo files limit how big they may be printed at 300 dpi (checked at the end)
const LOGO_DIR = path.join(OUT, "tisk-logos");
const SPACEX = `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="50" fill="#050505"/><path d="M14 33 H36 L86 69 H64 Z" fill="#fff"/><path d="M62 33 H86 L62 51 L52 44 Z" fill="#fff"/><path d="M14 69 H36 L46 61 L38 55 Z" fill="#fff"/></svg>`;
// left, top, size (mm), rotation (deg); the safe zone and the QR code + text on the left stay free
const COINS = [
  { logo: "tesla", pad: 0.55, x: 42, y: 44.2, size: 6.2, rot: -9 },
  { logo: "bot", pad: 0, x: 49.5, y: 46.6, size: 6.2, rot: 7 },
  { logo: "cards", pad: 0.55, x: 57, y: 43.6, size: 6.2, rot: -5 },
  { vector: SPACEX, x: 64.5, y: 46.4, size: 6.2, rot: 10 },
  { logo: "sui", pad: 0.55, x: 72, y: 44, size: 6.2, rot: -8 },
  { logo: "cymetica", pad: 0, x: 79.3, y: 46.2, size: 6.2, rot: 6 },
];
const coinsHtml = () =>
  COINS.map((c) => {
    const inner = c.vector ?? `<img src="${pathToFileURL(path.join(LOGO_DIR, c.logo + ".png")).href}" style="padding:${c.pad}mm" alt="">`;
    return `<div class="coin" style="left:${c.x}mm;top:${c.y}mm;width:${c.size}mm;height:${c.size}mm;transform:rotate(${c.rot}deg)">${inner}</div>`;
  }).join("\n    ");

/* ---------- Card artwork (everything in mm; the page is 91.5 x 60 mm, the card starts 3 mm inside) ---------- */

const PALETTES = {
  pink: {
    front: { angle: 135, stops: [[0, "#ffa3d2"], [0.48, "#ff4f9a"], [1, "#7b3bf2"]] },
    back: { angle: 160, stops: [[0, "#3a1650"], [1, "#170a2a"]] },
    accent: "#ff4f9a",
  },
  blue: {
    front: { angle: 135, stops: [[0, "#7ccbff"], [0.5, "#2f6bdb"], [1, "#13307a"]] },
    back: { angle: 160, stops: [[0, "#143068"], [1, "#0a1636"]] },
    accent: "#2f6bdb",
  },
};

const hex2rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
function colorAt(stops, t) {
  if (t <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const [p0, c0] = stops[i - 1];
      const [p1, c1] = stops[i];
      const k = (t - p0) / (p1 - p0);
      const a = hex2rgb(c0);
      const b = hex2rgb(c1);
      return "#" + a.map((v, j) => Math.round(v + (b[j] - v) * k).toString(16).padStart(2, "0")).join("");
    }
  }
  return stops[stops.length - 1][1];
}

/* A gradient drawn as many flat vector bands (CSS angle semantics). Ghostscript would turn a real PDF gradient
   into a low-resolution picture while converting to CMYK, flat fills stay pure vector. Every band runs to the far
   end and is painted over by the next one, so there are no seams. */
function gradientSvg(w, h, { angle, stops }, n = 180, cls = "bg") {
  const th = (angle * Math.PI) / 180;
  const len = Math.abs(w * Math.sin(th)) + Math.abs(h * Math.cos(th));
  let rects = "";
  for (let i = 0; i < n; i++) {
    const x = (-len / 2 + (i * len) / n).toFixed(3);
    rects += `<rect x="${x}" y="-200" width="${(len + 200).toFixed(3)}" height="400" fill="${colorAt(stops, (i + 0.5) / n)}"/>`;
  }
  return `<svg class="${cls}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg"><g transform="translate(${w / 2} ${h / 2}) rotate(${angle - 90})">${rects}</g></svg>`;
}

/* the soft highlight in the top-left corner: white bands whose opacity fades out (CSS angle 115deg, 38 % -> 0 at 40 %) */
function sheenSvg(w, h, angle = 115, a0 = 0.38, reach = 0.4, n = 60) {
  const th = (angle * Math.PI) / 180;
  const len = Math.abs(w * Math.sin(th)) + Math.abs(h * Math.cos(th));
  let rects = "";
  for (let i = 0; i < n; i++) {
    const t = ((i + 0.5) / n) * reach;
    const x0 = -len / 2 + (i * reach * len) / n;
    rects += `<rect x="${x0.toFixed(3)}" y="-200" width="${((reach * len) / n + 0.03).toFixed(3)}" height="400" fill="#fff" fill-opacity="${(a0 * (1 - t / reach)).toFixed(4)}"/>`;
  }
  return `<svg class="bg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg"><g transform="translate(${w / 2} ${h / 2}) rotate(${angle - 90})">${rects}</g></svg>`;
}

/* fine concentric lines (vector) instead of a repeating gradient, which would be rasterised */
function guilloche(cx, cy) {
  let c = "";
  for (let r = 2.2; r < 110; r += 2.2) c += `<circle cx="${cx}" cy="${cy}" r="${r.toFixed(2)}"/>`;
  return `<svg class="pattern" viewBox="0 0 ${PAGE_W} ${PAGE_H}" xmlns="http://www.w3.org/2000/svg"><g fill="none" stroke="#fff" stroke-opacity=".16" stroke-width=".16">${c}</g></svg>`;
}

const MARK = (accent) =>
  `<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><circle cx="16" cy="16" r="15" fill="#fff"/><path d="M8 21 L14 14 L18 18 L25 9" fill="none" stroke="${accent}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const NFC = `<svg viewBox="0 0 34 34" xmlns="http://www.w3.org/2000/svg"><g fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round"><path d="M9 11 Q14 17 9 23"/><path d="M15 7 Q23 17 15 27"/><path d="M21 3 Q32 17 21 31"/></g></svg>`;

const CHIP = `<svg viewBox="0 0 78 58" xmlns="http://www.w3.org/2000/svg"><rect x="1" y="1" width="76" height="56" rx="10" fill="#dcae3e"/><path d="M11 1 H67 A10 10 0 0 1 77 11 V12 L12 57 H11 A10 10 0 0 1 1 47 V11 A10 10 0 0 1 11 1 Z" fill="#efcf74"/><rect x="1" y="1" width="76" height="56" rx="10" fill="none" stroke="#b98a22" stroke-width="1.5"/><path d="M1 20 H26 M1 38 H26 M52 20 H77 M52 38 H77 M26 1 V57 M52 1 V57 M26 29 H52" fill="none" stroke="#b98a22" stroke-width="1.4"/><rect x="26" y="16" width="26" height="26" rx="5" fill="none" stroke="#b98a22" stroke-width="1.4"/></svg>`;

function frontPage(p, i) {
  const pal = PALETTES[p.palette];
  const hero = p.mascot === "waddle" ? "hero waddle" : "hero kirby";
  const no = passwords[p.id].number; // the password is hidden in the number: the digit sums of the four groups (tools/password.mjs)
  return `<section class="page front" style="background:${pal.front.stops[1][1]}">
    ${gradientSvg(PAGE_W, PAGE_H, pal.front)}
    ${guilloche(71, 67)}
    ${sheenSvg(PAGE_W, PAGE_H)}
    <div class="brand"><span class="mark">${MARK(pal.accent)}</span>Micro portfolio</div>
    <div class="nfc">${NFC}</div>
    <div class="chip">${CHIP}</div>
    <div class="num">${no}</div>
    <div class="own"><small>Majitel</small><b>${p.name.toUpperCase()}</b></div>
    <div class="since">Investor od ${START}</div>
    <div class="${hero}">${MASCOT[p.mascot]}</div>
  </section>`;
}

function hatch() {
  const w = 43.5;
  const h = 8.5;
  let d = "";
  for (let x = -h; x < w; x += 3.2) d += `<path d="M${x} ${h}H${x + 1.6}L${x + 1.6 + h} 0H${x + h}Z"/>`;
  return `<svg class="hatch" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg"><g fill="#e9e1f3">${d}</g></svg>`;
}

function backPage(p, url, qr) {
  const pal = PALETTES[p.palette];
  return `<section class="page back" style="background:${pal.back.stops[0][1]}">
    ${gradientSvg(PAGE_W, PAGE_H, pal.back)}
    ${guilloche(71, 67)}
    <div class="stripe">${gradientSvg(PAGE_W, 8, { angle: 180, stops: [[0, "#1c1c26"], [0.6, "#06060a"], [1, "#191923"]] }, 40, "bg")}</div>
    <div class="sig">${hatch()}<span>Micro portfolio</span></div>
    ${coinsHtml()}
    <div class="qr">${qr.svg}</div>
    <div class="scan">Naskenuj kamerou mobilu.</div>
  </section>`;
}

const FONT = (name, file, weight = "400") =>
  `@font-face{font-family:"${name}";font-weight:${weight};src:url("${pathToFileURL(file).href}") format("woff2")}`;
const F = (f) => path.join(ROOT, "assets/fonts", f);

const css = (slug) => {
  const SW = PAGE_W + 2 * slug;
  const SH = PAGE_H + 2 * slug;
  return `
${FONT("Fredoka", F("fredoka-latin.woff2"), "400 700")}
${FONT("Fredoka", F("fredoka-latin-ext.woff2"), "400 700")}
${FONT("Nunito", F("nunito-latin.woff2"), "600 800")}
${FONT("Nunito", F("nunito-latin-ext.woff2"), "600 800")}
${FONT("JB Mono", path.join(ROOT, "tools/fonts/jetbrainsmono-700-latin.woff2"), "700")}
@page { size: ${SW + 1}mm ${SH + 1}mm; margin: 0 }
* { box-sizing: border-box; margin: 0; padding: 0 }
html, body { width: ${SW}mm; background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact }
.sheet { position: relative; width: ${SW}mm; height: ${SH}mm; overflow: hidden; break-after: page; background: #fff }
.sheet:last-child { break-after: auto }
.marks { position: absolute; inset: 0; width: 100%; height: 100% }
.page { position: absolute; left: ${slug}mm; top: ${slug}mm; width: ${PAGE_W}mm; height: ${PAGE_H}mm; overflow: hidden; color: #fff;
  font-family: "Nunito", "Fredoka", sans-serif }
.pattern, .bg { position: absolute; inset: 0; width: 100%; height: 100%; display: block }
.page > * { position: absolute }

/* front: everything that is text stays at least 6 mm from the page edge (3 mm inside the trimmed card) */
.brand { left: 6.5mm; top: 6.5mm; display: flex; align-items: center; gap: 2.2mm; font: 600 4.4mm/1 "Fredoka", sans-serif; letter-spacing: .05em }
.brand .mark { width: 6.6mm; height: 6.6mm; display: block }
.brand .mark svg { width: 100%; height: 100%; display: block }
.nfc { right: 6.5mm; top: 6.7mm; width: 6mm; height: 6mm }
.nfc svg { width: 100%; height: 100% }
.chip { left: 6.5mm; top: 19mm; width: 11mm; height: 8.2mm }
.chip svg { width: 100%; height: 100% }
.num { left: 6.5mm; top: 31.6mm; font: 700 3.9mm/1 "JB Mono", monospace; letter-spacing: .08em }
.own { left: 6.5mm; bottom: 6.6mm; display: flex; flex-direction: column; gap: .8mm }
.own small { font: 700 1.55mm/1 "Nunito", sans-serif; letter-spacing: .24em; text-transform: uppercase; opacity: .9 }
.own b { font: 600 4.8mm/1 "Fredoka", "Nunito", sans-serif; letter-spacing: .2em }
.since { left: 27mm; bottom: 6.8mm; font: 700 1.7mm/1 "Nunito", sans-serif; letter-spacing: .14em; text-transform: uppercase; opacity: .92 }
.hero { right: -1.4mm; bottom: -2.8mm; width: 30mm; height: 30mm }
.hero.waddle { width: 33mm; height: 30mm; right: -2.4mm; bottom: -2.4mm }
.hero svg, .mini svg { width: 100%; height: 100%; display: block }

/* back */
.stripe { left: 0; right: 0; top: 8mm; height: 8mm }
.sig { left: 42mm; top: 19.8mm; width: 43.5mm; height: 8.5mm; background: #f7f2fb; border-radius: 1.2mm; overflow: hidden }
.sig .hatch { position: absolute; inset: 0; width: 100%; height: 100% }
.sig span { position: absolute; left: 3mm; top: 0; bottom: 0; display: flex; align-items: center; font: 700 1.9mm/1 "Nunito", sans-serif; letter-spacing: .3em; text-transform: uppercase; color: #7b6a90 }
.qr { left: 8mm; top: 19.5mm; line-height: 0 }
.qr svg { display: block }
.scan { left: 42mm; top: 31.2mm; width: 43.5mm; font: 800 4.2mm/1.2 "Nunito", sans-serif }
.coin { background: #fff; border-radius: 50%; overflow: hidden; border: .25mm solid #fff }
.coin img, .coin svg { width: 100%; height: 100%; display: block; object-fit: cover; border-radius: 50% }
`;
};

/* crop marks: short lines at the corners of the trimmed card, starting 3 mm (the bleed) away from it */
function marksSvg(slug) {
  const SW = PAGE_W + 2 * slug;
  const SH = PAGE_H + 2 * slug;
  const t = slug + BLEED; // the trim corner offset
  const o = BLEED;
  const l = 4;
  const xs = [t, SW - t];
  const ys = [t, SH - t];
  let d = "";
  for (const x of xs) for (const y of ys) {
    const sx = x === xs[0] ? -1 : 1;
    const sy = y === ys[0] ? -1 : 1;
    d += `M${x + sx * o} ${y}h${sx * l}M${x} ${y + sy * o}v${sy * l}`;
  }
  return `<svg class="marks" viewBox="0 0 ${SW} ${SH}" xmlns="http://www.w3.org/2000/svg"><path d="${d}" fill="none" stroke="#000" stroke-width=".09"/></svg>`;
}

function html(pages, slug) {
  const sheets = pages.map((pg) => `<div class="sheet">${pg}${slug ? marksSvg(slug) : ""}</div>`);
  return `<!doctype html><html lang="cs"><head><meta charset="utf-8"><title>Micro portfolio – karty</title><style>${css(slug)}</style></head><body>
${sheets.join("\n")}</body></html>`;
}

/* ---------- Build ---------- */

const pages = [];
const links = [];
people.people.forEach((p, i) => {
  p.name = names[p.id];
  if (!p.name || !passwords[p.id]?.number) throw new Error(`Missing name or password for ${p.id}: run node tools/password.mjs set ${p.id}`);
  const url = `${baseUrl}/${p.id}/?n=${encodeURIComponent(p.name)}`;
  const qr = qrTile(url);
  links.push(url);
  pages.push(frontPage(p, i), backPage(p, url, qr));
});
execFileSync("python3", [path.join(ROOT, "tools/print-post.py"), "logos", path.join(ROOT, "assets/logos"), LOGO_DIR]);

async function build(slug, final) {
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });
  const htmlFile = path.join(TMP, "karty.html");
  fs.writeFileSync(htmlFile, html(pages, slug));

  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const page = await browser.newPage();
  await page.goto(pathToFileURL(htmlFile).href);
  await page.evaluate(() => document.fonts.ready);
  const rawPdf = path.join(TMP, "rgb.pdf");
  await page.pdf({ path: rawPdf, width: `${PAGE_W + 2 * slug + 1}mm`, height: `${PAGE_H + 2 * slug + 1}mm`, printBackground: true, margin: { top: 0, right: 0, bottom: 0, left: 0 }, preferCSSPageSize: true });
  await browser.close();

  // RGB -> CMYK, fonts embedded, no downsampling
  const cmykPdf = path.join(TMP, "cmyk.pdf");
  execFileSync("gs", [
    "-q", "-dSAFER", "-dBATCH", "-dNOPAUSE", "-sDEVICE=pdfwrite", "-dCompatibilityLevel=1.6",
    "-dPDFSETTINGS=/prepress", "-sColorConversionStrategy=CMYK", "-sProcessColorModel=DeviceCMYK",
    "-dNoOutputFonts",
    "-dDownsampleColorImages=false", "-dDownsampleGrayImages=false", "-dDownsampleMonoImages=false",
    "-dAutoRotatePages=/None", `-sOutputFile=${cmykPdf}`, rawPdf,
  ]);

  // Pure black (#000, used by the QR code) must end up as K only, not as a "rich" CMYK mixture: find out what the
  // conversion made of #000 and replace exactly that colour with 0 0 0 100 below.
  const probeHtml = path.join(TMP, "probe.html");
  fs.writeFileSync(probeHtml, '<!doctype html><style>@page{size:20mm 20mm;margin:0}html,body{margin:0;width:20mm;height:20mm;background:#000}</style><body>.</body>');
  const probePage = await (await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })).newPage();
  await probePage.goto(pathToFileURL(probeHtml).href);
  await probePage.pdf({ path: path.join(TMP, "probe-rgb.pdf"), width: "20mm", height: "20mm", printBackground: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } });
  await probePage.context().browser().close();
  execFileSync("gs", ["-q", "-dSAFER", "-dBATCH", "-dNOPAUSE", "-sDEVICE=pdfwrite", "-dPDFSETTINGS=/prepress", "-sColorConversionStrategy=CMYK", "-sProcessColorModel=DeviceCMYK", `-sOutputFile=${path.join(TMP, "probe-cmyk.pdf")}`, path.join(TMP, "probe-rgb.pdf")]);
  const richBlack = execFileSync("python3", [path.join(ROOT, "tools/print-post.py"), "probe", path.join(TMP, "probe-cmyk.pdf")]).toString().trim();
  console.log("Black #000 converts to:", richBlack || "(K only already)");

  // exact page boxes (TrimBox / BleedBox), K-only black, final file
  execFileSync("python3", [path.join(ROOT, "tools/print-post.py"), "finish", cmykPdf, final, String((PAGE_W + 2 * slug) * PT), String((PAGE_H + 2 * slug) * PT), String(BLEED * PT), richBlack, String(slug * PT)]);

  /* ---------- Checks ---------- */

  const info = execFileSync("pdfinfo", ["-box", final]).toString();
  const sizeLine = /Page size:\s+([\d.]+) x ([\d.]+) pts/.exec(info);
  const pagesLine = /Pages:\s+(\d+)/.exec(info);
  console.log(`\n=== ${path.basename(final)} ===\nPages: ${pagesLine?.[1]}, page size: ${(sizeLine[1] / PT).toFixed(2)} x ${(sizeLine[2] / PT).toFixed(2)} mm`);
  if (pagesLine?.[1] !== String(people.people.length * 2)) throw new Error(`Expected ${people.people.length * 2} pages`);
  console.log("Fonts:\n" + execFileSync("pdffonts", [FINAL]).toString().trim());
  const images = execFileSync("pdfimages", ["-list", FINAL]).toString().trim().split("\n").slice(2);
  console.log(images.length ? `Raster images:\n${images.join("\n")}` : "Raster images: none (everything is vector)");
  const lowPpi = images.map((l) => l.trim().split(/\s+/)).filter((c) => Math.min(Number(c[12]), Number(c[13])) < 300);
  if (lowPpi.length) throw new Error(`Raster images below 300 ppi: ${lowPpi.map((c) => `${c[12]}x${c[13]} ppi`).join(", ")}`);

  fs.writeFileSync(path.join(TMP, "links.json"), JSON.stringify(links));
  execFileSync("python3", [path.join(ROOT, "tools/print-post.py"), "check", final, TMP], { stdio: "inherit" });

  // previews (what the PDF looks like, converted back to RGB for the screen)
  for (let k = 1; k <= people.people.length * 2; k++) {
    execFileSync("pdftoppm", ["-r", "300", "-f", String(k), "-l", String(k), "-png", "-singlefile", final, path.join(OUT, `${slug ? "tisk-nahled-znacky" : "tisk-nahled"}-${k}`)]);
  }
  console.log(`\nDone: ${path.relative(ROOT, final)}`);
}

for (const [slug, final] of [[0, FINAL], [SLUG, FINAL_MARKS]]) await build(slug, final);
