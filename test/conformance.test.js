// RESOLUTION.md conformance (vehiclesdb/vehiclesdb conformance/resolve.json),
// driven through the widget itself: each pair case is a stored make/model
// put on the selects, and the canonical id the widget writes to its idInput
// is the answer.
//
// The widget implements the contract's STRICT rungs only (fold, alias, form,
// plus the id rungs through a stored id): a picker never preselects a guess.
// So it runs the pair cases whose method is fold, alias or form, and the
// cases that expect no answer (null or ambiguous). Text-entry cases (one
// string, make split out of it) and the lenient rungs (cleaned, fuzzy) are
// not the widget's job and are skipped.
//
//   VDB_CONFORMANCE=path/to/conformance/resolve.json \
//   VDB_DATA=path/to/dist/vehicles.json node --test test/conformance.test.js
const assert = require("node:assert/strict")
const fs = require("node:fs")
const { test } = require("node:test")
const { JSDOM } = require("jsdom")

const VehiclesDropdown = require("../make-model-dropdown.js")

const STRICT = new Set(["fold", "alias", "form"])
const casesPath = process.env.VDB_CONFORMANCE
const dataPath = process.env.VDB_DATA

function versionAtLeast(have, want) {
  const a = String(have).split(".").map(Number), b = String(want).split(".").map(Number)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0)
  }
  return true
}

if (!casesPath || !dataPath) {
  test("RESOLUTION conformance (set VDB_CONFORMANCE and VDB_DATA to run)", { skip: true }, () => {})
} else {
  const suite = JSON.parse(fs.readFileSync(casesPath, "utf8"))
  const data = JSON.parse(fs.readFileSync(dataPath, "utf8"))
  const runnable = suite.cases.filter((c) => c.entry === "pair" &&
    (STRICT.has(c.method) || c.expect === null || c.expect === "ambiguous") &&
    !(Array.isArray(c.kinds) && c.kinds.length > 1) &&
    versionAtLeast(data.version, c.min_dataset || "0"))

  test(`RESOLUTION conformance: ${runnable.length} strict pair cases of ${suite.cases.length} (dataset ${data.version})`, async (t) => {
    assert.ok(runnable.length > 0, "no runnable cases: is this the right file?")
    const dom = new JSDOM("<!doctype html><select id=make></select><select id=model></select><input id=vid>")
    global.document = dom.window.document
    global.Option = dom.window.Option
    global.Event = dom.window.Event
    global.fetch = async (url) => { throw new Error(`unexpected request: ${url}`) }
    try {
      for (const c of runnable) {
        await t.test(`${c.make} | ${c.model}${c.kind ? ` (kind ${c.kind})` : ""} → ${c.expect}`, async () => {
          document.body.innerHTML = "<select id=make></select><select id=model></select><input id=vid>"
          const kind = c.kind || (Array.isArray(c.kinds) && c.kinds.length === 1 ? c.kinds[0] : null)
          const instance = VehiclesDropdown.attach({ data, make: "#make", model: "#model", idInput: "#vid",
            kind, attribution: false })
          try {
            await instance.setValue({ make: c.make, model: c.model })
            const expected = c.expect === null || c.expect === "ambiguous" ? null : c.expect
            assert.equal(instance.value.id, expected, c.note)
          } finally {
            instance.destroy()
          }
        })
      }
    } finally {
      dom.window.close()
      delete global.document
      delete global.Option
      delete global.Event
      delete global.fetch
    }
  })
}
