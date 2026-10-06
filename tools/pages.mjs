#!/usr/bin/env node
/*
 * Switches the two pages off (the QR codes then open a blank page) and on again.
 *
 *   node tools/pages.mjs off [p1]   p1/index.html and p2/index.html (or just the one named) become empty pages; the real ones are kept in tools/paused/
 *   node tools/pages.mjs on [p1]    puts the real pages back (all of them, or just the one named)
 *   node tools/pages.mjs status
 *
 * Push to main afterwards: GitHub Pages needs a minute or two, and phones may keep the old page in their cache for a while.
 * (The data files stay where they are; to take everything offline, turn GitHub Pages off in the repository settings.)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const saved = path.join(root, "tools", "paused");
const MARK = "<!-- micro-portfolio:paused -->";
const BLANK = `<!doctype html>
<html lang="cs">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title></title>
  ${MARK}
</head>
<body style="margin:0;background:#fff"></body>
</html>
`;

const only = process.argv[3];
const pages = fs.readdirSync(root).filter((d) => /^p\d+$/.test(d) && (!only || d === only));
const command = process.argv[2];
if (only && !pages.length) throw new Error(`no such page: ${only}`);

for (const dir of pages) {
  const file = path.join(root, dir, "index.html");
  const copy = path.join(saved, `${dir}.index.html`);
  const paused = fs.readFileSync(file, "utf8").includes(MARK);
  if (command === "off") {
    if (paused) {
      console.log(`${dir}: already off`);
      continue;
    }
    fs.mkdirSync(saved, { recursive: true });
    fs.copyFileSync(file, copy);
    fs.writeFileSync(file, BLANK);
    console.log(`${dir}: off (real page kept in tools/paused/${dir}.index.html)`);
  } else if (command === "on") {
    if (!paused) {
      console.log(`${dir}: already on`);
      continue;
    }
    if (!fs.existsSync(copy)) throw new Error(`${copy} is missing, cannot restore ${dir}`);
    fs.copyFileSync(copy, file);
    fs.unlinkSync(copy);
    console.log(`${dir}: on`);
  } else if (command === "status") {
    console.log(`${dir}: ${paused ? "OFF (blank page)" : "on"}`);
  } else {
    console.log("Usage: node tools/pages.mjs off | on | status");
    process.exit(1);
  }
}
