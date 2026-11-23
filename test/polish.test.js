// 0.5.1: the old-dataset notice, dataset-mode registration years, six more
// locales, the minified build and the CSS theming hooks.
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const { afterEach, test } = require("node:test")
const { JSDOM, VirtualConsole } = require("jsdom")

const VehiclesDropdown = require("../make-model-dropdown.js")
const ROOT = path.join(__dirname, "..")
const SOURCE = fs.readFileSync(path.join(ROOT, "make-model-dropdown.js"), "utf8")
const MIN = fs.readFileSync(path.join(ROOT, "make-model-dropdown.min.js"), "utf8")
const pkg = require("../package.json")

function dataset() {
  return {
    version: "2026.11.12",
    makes: [
      { name: "SEAT", slug: "seat", models: [
        { name: "Ibiza", slug: "ibiza", kind: "car", availability: ["es"], global_decile: 1,
          registration_years: { first: 2015, last: 2018 } },
        { name: "León", slug: "leon", kind: "car", availability: ["es"], global_decile: 2 }
      ] }
    ]
  }
}

function json(body) {
  return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } })
}

async function waitFor(predicate, message = "condition") {
  const deadline = Date.now() + 1500
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  assert.fail(`Timed out waiting for ${message}`)
}

let dom
let instances = []

function installDOM(body) {
  dom = new JSDOM(`<!doctype html><html><body>${body}</body></html>`, { url: "https://host.test" })
  global.document = dom.window.document
  global.Option = dom.window.Option
  global.Event = dom.window.Event
  global.KeyboardEvent = dom.window.KeyboardEvent
  return dom.window.document
}

function attach(options) {
  const instance = VehiclesDropdown.attach(options)
  instances.push(instance)
  return instance
}

afterEach(() => {
  instances.forEach((instance) => instance.destroy())
  instances = []
  dom?.window.close()
  dom = null
  delete global.document
  delete global.Option
  delete global.Event
  delete global.KeyboardEvent
  delete global.fetch
})

// ---- 1. Old-dataset notice -------------------------------------------------
// A fresh copy of the widget per page (the notice is once per page), with
// the page's clock fixed at `now`.
function page(now) {
  const virtualConsole = new VirtualConsole()
  const infos = [], warns = []
  virtualConsole.on("info", (...args) => infos.push(args.join(" ")))
  virtualConsole.on("warn", (...args) => warns.push(args.join(" ")))
  const { window } = new JSDOM(`<!doctype html><select id="make"></select><select id="model"></select>`,
    { url: "https://host.test", runScripts: "outside-only", virtualConsole })
  const urls = []
  window.fetch = (url) => { urls.push(url); return new Promise(() => {}) }
  const fixed = Date.parse(now)
  window.eval(`Date = (function (D) {
    return class extends D {
      constructor(...a) { super(...(a.length ? a : [${fixed}])) }
      static now() { return ${fixed} }
    }
  })(Date)`)
  window.eval(SOURCE)
  const attachHere = (options) => window.VehiclesDropdown.attach(Object.assign({ source: "dataset", make: "#make", model: "#model" }, options))
  return { window, infos, warns, urls, attach: attachHere }
}

test("a pinned release more than two months old logs one console.info per page", () => {
  const p = page("2026-11-23T12:00:00Z")
  p.attach({ version: "2026.08.1" })
  p.attach({ version: "2026.08.1" })
  p.attach({ version: "2026.07.0" })
  assert.equal(p.infos.length, 1, "once per page, however many pickers")
  assert.match(p.infos[0], /2026\.08\.1 is 3 months old/)
  assert.match(p.infos[0], /Omit `version` \(or use @latest/)
  assert.match(p.infos[0], /https:\/\/github\.com\/vehiclesdb\/make-model-dropdown#keeping-the-data-current/)
  assert.equal(p.urls.length, 2, "only the dataset fetches (two distinct releases), no request for the notice")
  assert.deepEqual(p.warns, [])
  assert.doesNotMatch(p.window.document.body.textContent, /months|version/, "nothing visible to the visitor")
  p.window.close()
})

test("the notice reads a datasetUrl pinned with @v<YYYY.MM.P>, across a year boundary", () => {
  const p = page("2027-01-10T12:00:00Z")
  p.attach({ datasetUrl: "https://cdn.jsdelivr.net/gh/vehiclesdb/vehiclesdb@v2026.10.3/dist/vehicles.json" })
  assert.equal(p.infos.length, 1)
  assert.match(p.infos[0], /v2026\.10\.3 is 3 months old/)
  p.window.close()
})

test("no notice for latest, no version, a recent pin, a self-hosted URL or embedded data", () => {
  for (const options of [
    {}, { version: "latest" }, { version: "2026.10.3" }, { version: "2026.09.0" },
    { datasetUrl: "https://cdn.jsdelivr.net/gh/vehiclesdb/vehiclesdb@latest/dist/vehicles.json" },
    { datasetUrl: "https://example.test/vehicles.json" },
    { data: { version: "2026.01.0", makes: [] }, version: "2026.01.0" }
  ]) {
    const p = page("2026-11-23T12:00:00Z")
    p.attach(options)
    assert.deepEqual(p.infos, [], JSON.stringify(options))
    p.window.close()
  }
})

test("API mode never logs the notice", () => {
  const p = page("2026-11-23T12:00:00Z")
  p.window.VehiclesDropdown.attach({ key: "vdb_pk_x", version: "2025.01.0", make: "#make" })
  assert.deepEqual(p.infos, [])
  p.window.close()
})

// ---- 2. Dataset-mode years from registration_years --------------------------
const yearsOf = (select) => Array.from(select.options).slice(1).map((option) => option.value)

function pickModel(select, value) {
  select.value = value
  select.dispatchEvent(new Event("change", { bubbles: true }))
}

test("dataset mode fills the year step from registration_years, like API mode from years_on_record", async () => {
  installDOM(`<select id="make"></select><select id="model"></select><select id="year"></select>`)
  global.fetch = async (url) => { throw new Error(`unexpected request: ${url}`) }
  attach({ data: dataset(), make: "#make", model: "#model", year: "#year", initialMake: "seat", attribution: false })
  const model = document.querySelector("#model"), year = document.querySelector("#year")
  await waitFor(() => model.options.length === 3, "models")
  pickModel(model, "ibiza")
  assert.deepEqual(yearsOf(year), ["2018", "2017", "2016", "2015"])

  // The same span through the API's field gives the same list.
  installDOM(`<select id="make"></select><select id="model"></select><select id="year"></select>`)
  global.fetch = async (url) => String(url).includes("/models")
    ? json({ models: [{ name: "Ibiza", slug: "ibiza", kind: "car", years_on_record: { first: 2015, last: 2018 } }] })
    : json({ makes: [{ name: "SEAT", slug: "seat" }] })
  attach({ key: "vdb_pk_x", make: "#make", model: "#model", year: "#year", initialMake: "seat", attribution: false })
  const apiModel = document.querySelector("#model")
  await waitFor(() => apiModel.options.length === 2, "API models")
  pickModel(apiModel, "ibiza")
  assert.deepEqual(yearsOf(document.querySelector("#year")), ["2018", "2017", "2016", "2015"])
})

test("a dataset model without registration_years keeps the fallback range (or none)", async () => {
  installDOM(`<select id="make"></select><select id="model"></select><select id="year"></select>`)
  attach({ data: dataset(), make: "#make", model: "#model", year: "#year", initialMake: "seat", attribution: false })
  const model = document.querySelector("#model"), year = document.querySelector("#year")
  await waitFor(() => model.options.length === 3, "models")
  pickModel(model, "leon")
  const current = new Date().getFullYear()
  assert.equal(yearsOf(year).length, 41)
  assert.equal(yearsOf(year)[0], String(current))
  assert.equal(yearsOf(year)[40], String(current - 40))

  installDOM(`<select id="make"></select><select id="model"></select><select id="year"></select>`)
  attach({ data: dataset(), make: "#make", model: "#model", year: "#year", initialMake: "seat",
    yearFallback: "none", attribution: false })
  const m2 = document.querySelector("#model"), y2 = document.querySelector("#year")
  await waitFor(() => m2.options.length === 3, "models")
  pickModel(m2, "leon")
  assert.equal(y2.options.length, 1)
  assert.equal(y2.disabled, true)
})

// ---- 3. Locales -------------------------------------------------------------
function localesTable() {
  const start = SOURCE.indexOf("const LOCALES = {")
  const end = SOURCE.indexOf("\n  }\n", start)
  return new Function(`${SOURCE.slice(start, end + 4)}; return LOCALES`)()
}

test("every locale has every key, and its credit template keeps both slots", () => {
  const table = localesTable()
  assert.deepEqual(Object.keys(table).sort(), ["de", "en", "es", "fr", "it", "nl", "pl", "pt"])
  const keys = Object.keys(table.en).sort()
  for (const [code, strings] of Object.entries(table)) {
    assert.deepEqual(Object.keys(strings).sort(), keys, code)
    for (const key of keys) assert.ok(typeof strings[key] === "string" && strings[key].trim(), `${code}.${key}`)
    assert.ok(strings.attributionText.includes("{source}"), `${code}: {source}`)
    assert.ok(strings.attributionText.includes("{license}"), `${code}: {license}`)
    assert.doesNotMatch(strings.attributionText, /VehiclesDB|CC-BY/, `${code}: the names come from the links`)
  }
})

test("region tags pick the locale (de-AT is de) and the credit line keeps VehiclesDB and CC-BY 4.0", () => {
  for (const [tag, make, credit] of [
    ["de-AT", "Marke", "Fahrzeugdaten von VehiclesDB (CC-BY 4.0)"],
    ["fr-CA", "Marque", "Données véhicules fournies par VehiclesDB (CC-BY 4.0)"],
    ["it", "Marca", "Dati sui veicoli forniti da VehiclesDB (CC-BY 4.0)"],
    ["pt-BR", "Marca", "Dados de veículos fornecidos por VehiclesDB (CC-BY 4.0)"],
    ["pl_PL", "Marka", "Dane o pojazdach: VehiclesDB (CC-BY 4.0)"],
    ["nl-BE", "Merk", "Voertuiggegevens van VehiclesDB (CC-BY 4.0)"]
  ]) {
    installDOM(`<div><select id="make"></select><select id="model"></select></div>`)
    const original = console.warn
    const warnings = []
    console.warn = (...args) => warnings.push(args.join(" "))
    try {
      const instance = attach({ data: dataset(), make: "#make", model: "#model", locale: tag })
      assert.equal(instance.config.placeholderMake, make, tag)
      const line = document.querySelector(".vdb-attribution")
      assert.equal(line.textContent, credit, tag)
      assert.deepEqual(Array.from(line.querySelectorAll("a")).map((a) => a.textContent), ["VehiclesDB", "CC-BY 4.0"])
      assert.deepEqual(warnings, [], tag)
    } finally {
      console.warn = original
      instances.forEach((each) => each.destroy())
      instances = []
    }
  }
})

// ---- 4. The minified build ----------------------------------------------------
test("make-model-dropdown.min.js is built from the current source", async () => {
  const { build } = require("../scripts/build-min.js")
  assert.equal(MIN, await build(), "run `node scripts/build-min.js`")
  assert.ok(MIN.length < SOURCE.length / 2)
  assert.ok(pkg.files.includes("make-model-dropdown.min.js"))
  assert.match(MIN, /^\/\*!/, "keeps the licence banner")
})

test("the minified build attaches, auto-inits and renders the credit line", async () => {
  const urls = []
  const browser = new JSDOM(`<!doctype html><html><body>
    <div id="p" data-vehiclesdb-picker data-kind="car" data-year></div>
    <script>${MIN}</script>
    <select id="make"></select><select id="model"></select>
  </body></html>`, {
    url: "https://host.test",
    runScripts: "dangerously",
    beforeParse(window) { window.fetch = async (url) => { urls.push(url); return json(dataset()) } }
  })
  const doc = browser.window.document
  const VD = browser.window.VehiclesDropdown
  assert.equal(VD.version, pkg.version)
  await waitFor(() => doc.querySelectorAll("#p select").length === 3, "auto-init built the fields")
  await waitFor(() => doc.querySelector("#p select").options.length === 2, "makes")
  assert.equal(doc.querySelector("#p select").options[1].text, "SEAT")
  assert.equal(doc.querySelector("#p .vdb-attribution").textContent, "Vehicle data by VehiclesDB (CC-BY 4.0)")

  const instance = VD.attach({ source: "dataset", make: "#make", model: "#model", initialMake: "seat", initialModel: "ibiza" })
  await waitFor(() => instance.value.model === "ibiza", "attach() preselects")
  assert.deepEqual({ ...instance.value }, { make: "seat", model: "ibiza" })
  assert.equal(urls.length, 1, "one dataset request shared by both pickers")
  assert.equal(VD.findMake([{ name: "Citroën", slug: "citroen" }], "citroen").slug, "citroen")
  browser.window.close()
})

// ---- 5. Theming hooks -----------------------------------------------------------
test("inline styles read CSS custom properties with the old values as fallbacks", async () => {
  installDOM(`<div><select id="make"></select><select id="model"></select></div>`)
  attach({ data: dataset(), make: "#make", model: "#model", search: true })
  const list = document.querySelector(".vdb-combobox-list").getAttribute("style")
  for (const hook of ["var(--vdb-list-bg, #fff)", "var(--vdb-list-border, 1px solid #e5e7eb)",
    "var(--vdb-list-color, inherit)", "var(--vdb-list-max-height, 16rem)", "var(--vdb-list-z-index, 20)"]) {
    assert.ok(list.includes(hook), hook)
  }
  const credit = document.querySelector(".vdb-attribution").getAttribute("style")
  assert.ok(credit.includes("var(--vdb-credit-font-size, .75rem)") || credit.includes("var(--vdb-credit-font-size, 0.75rem)"), credit)
  assert.ok(credit.includes("var(--vdb-credit-color, #6b7280)"), credit)

  const input = document.querySelector(".vdb-combobox-input")
  await waitFor(() => document.querySelector("#make").options.length === 2, "makes")
  input.dispatchEvent(new Event("focus"))
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }))
  const row = document.querySelector(".vdb-combobox-list li[aria-selected=true]")
  assert.ok(row.getAttribute("style").includes("var(--vdb-list-highlight-bg, #f3f4f6)"))
})
