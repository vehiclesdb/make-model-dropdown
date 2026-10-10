#!/usr/bin/env node
// sync-countries.mjs — keep "official registers of N countries" true.
//
// The country count in package.json's npm description, the library header and
// the README is a FACT about the VehiclesDB dataset, so it is read from the
// dataset's own manifest.json (`countries`, the register countries of the
// release) instead of being typed by hand. It said "14" for two releases after
// the dataset reached 15 (found 2026-10-10).
//
//   node scripts/sync-countries.mjs                    # rewrite from the published manifest
//   node scripts/sync-countries.mjs --manifest path    # or a local/other manifest (path or URL)
//   node scripts/sync-countries.mjs --check            # exit 1 if any file is stale (prepublishOnly)
//
// Zero dependencies (Node >= 18 global fetch).
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const DEFAULT_MANIFEST = "https://raw.githubusercontent.com/vehiclesdb/vehiclesdb/main/manifest.json";
export const FILES = ["package.json", "make-model-dropdown.js", "README.md"];
const PHRASE = /(registers of )(\d+)( countries)/g;

export function countryCount(manifest) {
  const list = manifest && manifest.countries;
  if (!Array.isArray(list) || list.length === 0) throw new Error("manifest has no `countries` array");
  return new Set(list.map((c) => String(c).toLowerCase())).size;
}

export function rewrite(text, n) {
  return text.replace(PHRASE, (_m, a, _old, b) => `${a}${n}${b}`);
}

async function loadManifest(src) {
  if (/^https?:\/\//.test(src)) {
    const res = await fetch(src);
    if (!res.ok) throw new Error(`manifest fetch ${res.status}: ${src}`);
    return res.json();
  }
  return JSON.parse(readFileSync(src, "utf8"));
}

async function main(argv) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const i = argv.indexOf("--manifest");
  const src = i >= 0 ? argv[i + 1] : DEFAULT_MANIFEST;
  const check = argv.includes("--check");
  const n = countryCount(await loadManifest(src));
  const stale = [];
  for (const f of FILES) {
    const p = path.join(root, f);
    const before = readFileSync(p, "utf8");
    const after = rewrite(before, n);
    if (after === before) continue;
    stale.push(f);
    if (!check) writeFileSync(p, after);
  }
  if (check && stale.length) {
    console.error(`stale country count (manifest says ${n}): ${stale.join(", ")} — run: node scripts/sync-countries.mjs`);
    process.exit(1);
  }
  console.log(`${check ? "checked" : "synced"}: ${n} countries (${src})${stale.length && !check ? `; updated ${stale.join(", ")}` : ""}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main(process.argv.slice(2)).catch((e) => { console.error(e.message); process.exit(1); });
}
