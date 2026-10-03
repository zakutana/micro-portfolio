#!/usr/bin/env node
/*
 * The puzzle password: it is hidden in the card number.
 *
 *   node tools/password.mjs set p1        make a random password for page p1 (and its card number); writes
 *                                         private/passwords.json and the hash (passHash) into p1/config.json
 *   node tools/password.mjs set p1 --new  the same, even if p1 already has one (the printed card then stops working!)
 *   node tools/password.mjs card          print the card numbers and check them
 *   node tools/password.mjs remove p1     take the password off the page again (the page opens directly)
 *
 * How it works: the 16-digit card number has four groups of four digits. Adding up the digits of a group gives one
 * number (random, 3-9; every card adds up to the same total, so nobody has it harder). The password is the four numbers
 * written one after another, e.g. 7, 4, 6, 7 -> 7467.
 * The numbers are random and have nothing to do with the name. The card number and the password are saved in
 * private/passwords.json, so the printed card stays valid.
 * This is a game, not security: the card number is on the card and config.json is public anyway.
 */
import { pbkdf2Sync, randomInt } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PRIVATE = path.join(ROOT, "private");
const PASSWORDS_FILE = path.join(PRIVATE, "passwords.json");
const PBKDF2_ITERATIONS = 200_000; // must match assets/app.js

/* four digits whose sum is n (no digit above 6, so a group never "gives itself away"): start from 0000 and add 1 to a random digit */
function group(n) {
  const d = [0, 0, 0, 0];
  for (let i = 0; i < n; ) {
    const k = randomInt(4);
    if (d[k] < 6) {
      d[k]++;
      i++;
    }
  }
  return d.join("");
}

/* Easy and fair: every number is a single digit (3-9) and every card has the same total (24), so both children
   do about the same amount of adding. The password is the four digits one after another, e.g. 7469. */
const TOTAL = 24;
export function makePuzzle() {
  let sums;
  do sums = Array.from({ length: 4 }, () => randomInt(3, 10));
  while (sums.reduce((a, b) => a + b, 0) !== TOTAL);
  return { number: sums.map(group).join(" "), password: sums.join("") };
}

export const solve = (number) => number.split(" ").map((g) => [...g].reduce((a, d) => a + Number(d), 0)).join("");

export const hashOf = (id, password) => pbkdf2Sync(password, `micro-portfolio:${id}`, PBKDF2_ITERATIONS, 32, "sha256").toString("hex");

const readJson = (f, fallback) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : fallback);

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [cmd, id, flag] = process.argv.slice(2);
  const configPath = (pid) => path.join(ROOT, pid, "config.json");
  const passwords = readJson(PASSWORDS_FILE, {});

  if (cmd === "set" || cmd === "remove") {
    if (!/^p\d+$/.test(id ?? "") || !fs.existsSync(configPath(id))) throw new Error(`Unknown page "${id}"`);
    const cfg = JSON.parse(fs.readFileSync(configPath(id), "utf8"));
    delete cfg.passHash;
    delete cfg.passLen;
    if (cmd === "set") {
      if (passwords[id]?.number && flag !== "--new") {
        throw new Error(`${id} already has a password and a card number (${passwords[id].number}). Use --new only if you really want new cards.`);
      }
      passwords[id] = makePuzzle();
      fs.mkdirSync(PRIVATE, { recursive: true });
      fs.writeFileSync(PASSWORDS_FILE, JSON.stringify(passwords, null, 2) + "\n");
      const next = { passHash: hashOf(id, passwords[id].password) };
      for (const [k, v] of Object.entries(cfg)) next[k] = v;
      fs.writeFileSync(configPath(id), JSON.stringify(next, null, 2) + "\n");
      console.log(`${id}: card number ${passwords[id].number}  ->  password ${passwords[id].password}`);
    } else {
      delete passwords[id];
      fs.writeFileSync(PASSWORDS_FILE, JSON.stringify(passwords, null, 2) + "\n");
      fs.writeFileSync(configPath(id), JSON.stringify(cfg, null, 2) + "\n");
      console.log(`${id}: no password`);
    }
  } else if (cmd === "card") {
    for (const [pid, v] of Object.entries(passwords)) {
      console.log(`${pid}: ${v.number}  ->  ${solve(v.number)}  ${solve(v.number) === v.password ? "OK" : "MISMATCH"}`);
    }
  } else {
    console.log("usage: node tools/password.mjs set <id> [--new] | card | remove <id>");
  }
}
