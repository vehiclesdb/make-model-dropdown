import { test } from "node:test";
import assert from "node:assert/strict";
import { countryCount, rewrite } from "../scripts/sync-countries.mjs";

test("counts distinct register countries from the manifest", () => {
  assert.equal(countryCount({ countries: ["ar", "ca", "de", "GB", "gb"] }), 4);
  assert.throws(() => countryCount({}), /no `countries`/);
});

test("rewrites every 'registers of N countries' phrase and nothing else", () => {
  const src = "from official registers of 14 countries. 14,000+ models; registers of 14 countries";
  assert.equal(rewrite(src, 15), "from official registers of 15 countries. 14,000+ models; registers of 15 countries");
  assert.equal(rewrite("no phrase here", 15), "no phrase here");
});
