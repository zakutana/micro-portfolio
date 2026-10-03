#!/usr/bin/env node
/*
 * The puzzle password: it is hidden in the card number, the key is the child's name.
 *
 *   node tools/password.mjs set p1        set page p1's password; writes private/passwords.json and the hash (passHash)
 *                                         into p1/config.json
 *   node tools/password.mjs card          print the card numbers and check them
 *   node tools/password.mjs remove p1     take the password off the page again (the page opens directly)
 *
 * How it works (the child's name has 4 letters, e.g. ANIA): the 16-digit card number has four groups of four digits.
 * Adding up the digits of a group gives one number, and that number is the place of the letter in the alphabet
 * (A = 1, B = 2 ... Z = 26): ANIA -> 1, 14, 9, 1. The password is those numbers written one after another: 11491.
 * The digits of each group are made up from the name and the page id, so the number on the card is always the same.
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

const nameLetters = (name) =>
  name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
const place = (ch) => ch.charCodeAt(0) - 96; // a = 1 ... z = 26

export function positions(name) {
  const letters = nameLetters(name);
  if (letters.length !== 4) throw new Error(`The name must have exactly 4 letters (it has ${letters.length}: "${name}")`);
  return [...letters].map(place);
}

/* the same "random" digits every time: a tiny seeded generator */
function seeded(seed) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    return (h >>> 0) / 4294967296;
  };
}

/* four digits whose sum is n: start from 0000 and add 1 to a random digit n times */
function group(n, rnd) {
  const d = [0, 0, 0, 0];
  for (let i = 0; i < n; ) {
    const k = Math.floor(rnd() * 4);
    if (d[k] < 9) {
      d[k]++;
      i++;
    }
  }
  return d.join("");
}

export function cardNumber(name, id) {
  const rnd = seeded(`${id}:${nameLetters(name)}`);
  return positions(name).map((n) => group(n, rnd)).join(" ");
}

export const passwordOf = (name) => positions(name).join("");
export const solve = (number) => number.split(" ").map((g) => [...g].reduce((a, d) => a + Number(d), 0)).join("");

export const hashOf = (id, password) => pbkdf2Sync(password, `micro-portfolio:${id}`, PBKDF2_ITERATIONS, 32, "sha256").toString("hex");

const readJson = (f, fallback) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : fallback);

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [cmd, id] = process.argv.slice(2);
  const names = readJson(path.join(PRIVATE, "names.json"), {});
  const configPath = (pid) => path.join(ROOT, pid, "config.json");

  if (cmd === "set" || cmd === "remove") {
    if (!/^p\d+$/.test(id ?? "") || !fs.existsSync(configPath(id))) throw new Error(`Unknown page "${id}"`);
    const cfg = JSON.parse(fs.readFileSync(configPath(id), "utf8"));
    delete cfg.passHash;
    delete cfg.passLen;
    const passwords = readJson(PASSWORDS_FILE, {});
    if (cmd === "set") {
      if (!names[id]) throw new Error(`No name for ${id} in private/names.json`);
      const password = passwordOf(names[id]);
      passwords[id] = password;
      fs.mkdirSync(PRIVATE, { recursive: true });
      fs.writeFileSync(PASSWORDS_FILE, JSON.stringify(passwords, null, 2) + "\n");
      const next = { passHash: hashOf(id, password) };
      for (const [k, v] of Object.entries(cfg)) next[k] = v;
      fs.writeFileSync(configPath(id), JSON.stringify(next, null, 2) + "\n");
      console.log(`${id}: password set (${password}), card number ${cardNumber(names[id], id)}`);
    } else {
      delete passwords[id];
      fs.writeFileSync(PASSWORDS_FILE, JSON.stringify(passwords, null, 2) + "\n");
      fs.writeFileSync(configPath(id), JSON.stringify(cfg, null, 2) + "\n");
      console.log(`${id}: no password`);
    }
  } else if (cmd === "card") {
    for (const [pid, name] of Object.entries(names)) {
      const n = cardNumber(name, pid);
      console.log(`${pid}: ${n}  ->  ${positions(name).join(", ")}  ->  ${solve(n)}`);
    }
  } else {
    console.log("usage: node tools/password.mjs set <id> | card | remove <id>");
  }
}
