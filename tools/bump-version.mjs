#!/usr/bin/env node
/*
 * Run before every deploy (after changing anything in assets/; config.json alone does not need it): gives the page a new "?v=" so phones
 * never combine cached old files with new ones.   node tools/bump-version.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const version = Date.now().toString(36);
for (const dir of fs.readdirSync(root).filter((d) => /^p\d+$/.test(d))) {
  const file = path.join(root, dir, "index.html");
  const html = fs.readFileSync(file, "utf8");
  const next = html.replace(/\?v=[0-9a-z]+/g, `?v=${version}`);
  if (next === html) throw new Error(`${file}: no ?v= found`);
  fs.writeFileSync(file, next);
  console.log(`${dir}/index.html -> v=${version}`);
}
