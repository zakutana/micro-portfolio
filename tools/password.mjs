#!/usr/bin/env node
/*
 * The puzzle password: the password is hidden in the card number, the key is the child's name.
 *
 *   node tools/password.mjs set p1 bandy     set page p1's password (3-7 letters a-z); writes private/passwords.json
 *                                            and the hash (passHash) + its length (passLen) into p1/config.json
 *   node tools/password.mjs card             print the card numbers and check that they decode back
 *   node tools/password.mjs remove p1        take the password off the page again (the page opens directly)
 *
 * How the number is made: every letter of the password is a number (a=1 ... z=26). The letters of the name
 * (also a=1 ... z=26, repeated over and over) are added to it; if the result is above 26, take 26 away.
 * Every result is written as two digits. Those pairs come first in the 16-digit card number, the rest is the
 * start date as DDMMYY (it means nothing). The child subtracts the name letters again and turns the numbers into letters.
 * This is a game, not security: the name is on the card and in the QR link, and config.json is public anyway.
 */
import { pbkdf2Sync } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PRIVATE = path.join(ROOT, "private");
const PASSWORDS_FILE = path.join(PRIVATE, "passwords.json");
const PBKDF2_ITERATIONS = 200_000; // must match assets/app.js
// the filler digits: the start date as DDMMYY, from tools/people.json
export function startFiller() {
  const f = path.join(ROOT, "tools/people.json");
  const date = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")).startDate : null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? "")) return "101026";
  const [y, m, d] = date.split("-");
  return `${d}${m}${y.slice(2)}`;
}
const FILLER = "101026"; // default: the date DDMMYY (make-print.mjs passes the start date of the cards)

const letters = (s) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
const val = (ch) => ch.charCodeAt(0) - 96; // a=1 ... z=26

export function cardNumber(password, name, filler = startFiller()) {
  const pw = letters(password);
  const key = letters(name);
  if (pw.length < 3 || pw.length > 7 || pw !== password) throw new Error("The password must be 3-7 letters a-z");
  if (!key) throw new Error("The name has no letters to use as a key");
  let digits = "";
  for (let i = 0; i < pw.length; i++) {
    const n = ((val(pw[i]) + val(key[i % key.length]) - 1) % 26) + 1;
    digits += String(n).padStart(2, "0");
  }
  digits = (digits + filler.repeat(3)).slice(0, 16);
  return digits.match(/.{4}/g).join(" ");
}

export function decode(number, name, length) {
  const key = letters(name);
  const d = number.replace(/\s/g, "");
  let out = "";
  for (let i = 0; i < length; i++) {
    const n = Number(d.slice(i * 2, i * 2 + 2));
    out += String.fromCharCode(96 + ((n - val(key[i % key.length]) + 25) % 26) + 1);
  }
  return out;
}

export const hashOf = (id, password) => pbkdf2Sync(password, `micro-portfolio:${id}`, PBKDF2_ITERATIONS, 32, "sha256").toString("hex");

const readJson = (f, fallback) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : fallback);

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [cmd, id, password] = process.argv.slice(2);
  const names = readJson(path.join(PRIVATE, "names.json"), {});
  const passwords = readJson(PASSWORDS_FILE, {});
  const configPath = (pid) => path.join(ROOT, pid, "config.json");

  if (cmd === "set" || cmd === "remove") {
    if (!/^p\d+$/.test(id ?? "") || !fs.existsSync(configPath(id))) throw new Error(`Unknown page "${id}"`);
    const cfg = JSON.parse(fs.readFileSync(configPath(id), "utf8"));
    delete cfg.passHash;
    delete cfg.passLen;
    if (cmd === "set") {
      if (!names[id]) throw new Error(`No name for ${id} in private/names.json`);
      cardNumber(password ?? "", names[id]); // validates
      passwords[id] = password;
      fs.mkdirSync(PRIVATE, { recursive: true });
      fs.writeFileSync(PASSWORDS_FILE, JSON.stringify(passwords, null, 2) + "\n");
      const next = { passHash: hashOf(id, password), passLen: password.length };
      for (const [k, v] of Object.entries(cfg)) next[k] = v;
      fs.writeFileSync(configPath(id), JSON.stringify(next, null, 2) + "\n");
      console.log(`${id}: password set, card number ${cardNumber(password, names[id])}`);
    } else {
      fs.writeFileSync(configPath(id), JSON.stringify(cfg, null, 2) + "\n");
      console.log(`${id}: no password`);
    }
  } else if (cmd === "card") {
    for (const [pid, pw] of Object.entries(passwords)) {
      const n = cardNumber(pw, names[pid]);
      console.log(`${pid}: ${n}  ->  ${decode(n, names[pid], pw.length)}`);
    }
  } else {
    console.log("usage: node tools/password.mjs set <id> <password> | card | remove <id>");
  }
}
