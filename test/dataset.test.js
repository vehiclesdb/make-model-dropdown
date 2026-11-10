// 0.4.0: keyless dataset mode, country scope, stored values that are never
// blanked, the hidden canonical-id field, the RESOLUTION §3a kind-collision
// rule, and the ES module build.
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const { afterEach, test } = require("node:test")
const { JSDOM } = require("jsdom")

const VehiclesDropdown = require("../make-model-dropdown.js")

// A small file in the shape of dist/vehicles.json (slug-sorted, like the
// real one). Iveco's Daily is the dataset's real kind collision: one
// nameplate, three records, the same mass_decile.
function dataset() {
  return {
    version: "2026.11.2",
    makes: [
      { name: "Citroën", slug: "citroen", kinds: ["car"], models: [
        { name: "C3", slug: "c3", kind: "car", availability: ["es", "fr"], global_decile: 1 }
      ] },
      { name: "Iveco", slug: "iveco", kinds: ["van", "truck", "bus"], models: [
        { name: "Daily", slug: "daily", kind: "bus", mass_decile: 1, global_decile: 2, availability: ["es", "gb"],
          forms: ["35C15"], former_ids: ["bus/iveco/a50c18"] },
        { name: "Daily", slug: "daily", kind: "truck", mass_decile: 1, global_decile: 1, availability: ["es", "gb"],
          forms: ["35C15"] },
        { name: "Daily", slug: "daily", kind: "van", mass_decile: 1, global_decile: 3, availability: ["es", "de"],
          forms: ["35C15", "Turbodaily"] },
        { name: "Eurocargo", slug: "eurocargo", kind: "truck", mass_decile: 3, availability: ["es"] }
      ] },
      { name: "Lada", slug: "lada", kinds: ["car"], models: [
        { name: "Niva", slug: "niva", kind: "car", availability: ["de"] }
      ] },
      { name: "SEAT", slug: "seat", kinds: ["car"], models: [
        { name: "Ateca", slug: "ateca", kind: "car", availability: ["es"], global_decile: 2 },
        { name: "Ibiza", slug: "ibiza", kind: "car", availability: ["es"], global_decile: 1, country_ranks: { es: 1 } },
        { name: "León", slug: "leon", kind: "car", availability: ["de", "es"], global_decile: 1, country_ranks: { es: 2 },
          aliases: ["Leon ST"], forms: ["Leon Sportstourer"], former_ids: ["car/seat/leon-st"] },
        { name: "Toledo", slug: "toledo", kind: "car", availability: ["nl"], global_decile: 4 }
      ] },
      { name: "Volkswagen", slug: "volkswagen", kinds: ["car", "van"], aliases: ["VW"], models: [
        { name: "Golf", slug: "golf", kind: "car", availability: ["es"], global_decile: 1 },
        { name: "Transporter", slug: "transporter", kind: "van", availability: ["es"], global_decile: 1 }
      ] }
    ]
  }
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
  const instance = VehiclesDropdown.attach(Object.assign({ attribution: false }, options))
  instances.push(instance)
  return instance
}

function noFetch() {
  global.fetch = async (url) => { throw new Error(`unexpected request: ${url}`) }
}

async function waitFor(predicate, message = "condition") {
  const deadline = Date.now() + 1500
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  assert.fail(`Timed out waiting for ${message}`)
}

const texts = (select) => Array.from(select.options).map((option) => option.text)
const selected = (select) => select.options[select.selectedIndex]
const $ = (selector) => document.querySelector(selector)

function pick(select, value) {
  select.value = value
  select.dispatchEvent(new Event("change", { bubbles: true }))
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

test("dataset mode: one keyless fetch of the pinned release, shared by every widget", async () => {
  installDOM(`<select id="make"></select><select id="model"></select><select id="make2"></select>`)
  const requests = []
  global.fetch = async (url, init) => {
    requests.push({ url, init })
    return new Response(JSON.stringify(dataset()), { headers: { "Content-Type": "application/json" } })
  }
  // A version no other test uses, so the module-level cache starts cold.
  attach({ source: "dataset", version: "2026.11.2", make: "#make", model: "#model", kind: "car", country: "es" })
  attach({ source: "dataset", version: "2026.11.2", make: "#make2", kind: "car", country: "es" })
  await waitFor(() => $("#make").options.length > 1 && $("#make2").options.length > 1)

  assert.equal(requests.length, 1, "one fetch per dataset URL per page")
  assert.equal(requests[0].url, "https://cdn.jsdelivr.net/gh/vehiclesdb/vehiclesdb@2026.11.2/dist/vehicles.json")
  assert.equal(requests[0].init, undefined, "no key, no Authorization header")
  // Cars evidenced in Spain: Lada (Germany only) and Iveco (no cars) drop out.
  assert.deepEqual(texts($("#make")), ["Make", "Citroën", "SEAT", "Volkswagen"])

  pick($("#make"), "seat")
  await waitFor(() => $("#model").options.length > 1)
  // Popular in Spain: Spain's own ranks first, then the global decile;
  // the Toledo (Netherlands only) is out of scope.
  assert.deepEqual(texts($("#model")), ["Model", "Ibiza", "León", "Ateca"])
  assert.equal(requests.length, 1, "models come from the same file, no request per make")
})

test("dataset mode reads `data` without any request, and `datasetUrl` when self-hosted", async () => {
  installDOM(`<select id="make"></select><select id="model"></select><select id="make2"></select>`)
  noFetch()
  attach({ data: dataset(), make: "#make", model: "#model", order: "alphabetical" })
  await waitFor(() => $("#make").options.length > 1)
  assert.deepEqual(texts($("#make")), ["Make", "Citroën", "Iveco", "Lada", "SEAT", "Volkswagen"],
    "no scope: every make, by name")
  pick($("#make"), "seat")
  await waitFor(() => $("#model").options.length > 1)
  assert.deepEqual(texts($("#model")), ["Model", "Ateca", "Ibiza", "León", "Toledo"])

  const urls = []
  global.fetch = async (url) => {
    urls.push(url)
    return new Response(JSON.stringify(dataset()))
  }
  attach({ source: "dataset", datasetUrl: "https://assets.host.test/vehicles.json", make: "#make2" })
  await waitFor(() => $("#make2").options.length > 1)
  assert.deepEqual(urls, ["https://assets.host.test/vehicles.json"])
})

test("dataset mode: a failed fetch reaches onError and is not cached", async () => {
  installDOM(`<select id="make"></select><select id="make2"></select>`)
  let calls = 0
  global.fetch = async () => {
    calls += 1
    return calls === 1 ? new Response("nope", { status: 503 }) : new Response(JSON.stringify(dataset()))
  }
  const errors = []
  attach({ source: "dataset", datasetUrl: "https://flaky.test/vehicles.json", make: "#make", onError: (e) => errors.push(e) })
  await waitFor(() => errors.length === 1)
  assert.equal(errors[0].status, 503)
  attach({ source: "dataset", datasetUrl: "https://flaky.test/vehicles.json", make: "#make2" })
  await waitFor(() => $("#make2").options.length > 1, "a retry after the failure")
  assert.equal(calls, 2)
})

test("attach: the key is required only for the API; bad source/data/idInput fail fast", () => {
  installDOM(`<select id="make"></select><select id="model"></select><select id="other"></select>`)
  noFetch()
  assert.throws(() => VehiclesDropdown.attach({ make: "#make" }), /source: "dataset"/)
  assert.throws(() => VehiclesDropdown.attach({ make: "#make", source: "csv" }), /source must be/)
  assert.throws(() => VehiclesDropdown.attach({ make: "#make", data: "{}" }), /parsed dataset object/)
  assert.throws(() => VehiclesDropdown.attach({ make: "#make", model: "#model", data: dataset(), idInput: "#other" }),
    /idInput must be an <input>/)
  assert.throws(() => VehiclesDropdown.attach({ make: "#make", data: dataset(), idInput: "#make" }), /idInput/)
})

test("API mode passes country (and kind) on both requests", async () => {
  installDOM(`<select id="make"></select><select id="model"></select>`)
  const urls = []
  global.fetch = async (url) => {
    urls.push(url)
    return new Response(JSON.stringify(url.includes("/models")
      ? { models: [{ name: "León", slug: "leon", kind: "car" }] }
      : { makes: [{ name: "SEAT", slug: "seat" }] }))
  }
  attach({ key: "pk", apiBase: "https://country.test/api/v1", make: "#make", model: "#model", kind: "car", country: "es" })
  await waitFor(() => $("#make").options.length > 1)
  pick($("#make"), "seat")
  await waitFor(() => $("#model").options.length > 1)
  assert.equal(new URL(urls[0]).searchParams.get("country"), "es")
  assert.equal(new URL(urls[1]).searchParams.get("country"), "es")
  assert.equal(new URL(urls[1]).searchParams.get("kind"), "car")
})

test("a stored make and model the scoped list does not carry are kept, selected, and submitted unchanged", async () => {
  installDOM(`
    <form>
      <select id="make" name="make"><option value=""></option><option value="Lada" selected>Lada</option></select>
      <select id="model" name="model"><option value=""></option><option value="Niva 1.7i" selected>Niva 1.7i</option></select>
      <input type="hidden" id="vid" name="vid" value="">
    </form>`)
  noFetch()
  const changes = []
  attach({ data: dataset(), make: "#make", model: "#model", idInput: "#vid", values: "name",
    kind: "car", country: "es", onChange: (value) => changes.push(value) })
  await waitFor(() => $("#model").value === "Niva 1.7i" && $("#make").options.length > 2)

  assert.equal($("#make").value, "Lada", "a make outside the scope stays as stored")
  assert.equal(texts($("#make"))[1], "Lada", "right under the placeholder")
  assert.ok(texts($("#make")).includes("SEAT"), "the scoped list is all there")
  const data = new dom.window.FormData($("form"))
  assert.equal(data.get("make"), "Lada")
  assert.equal(data.get("model"), "Niva 1.7i")
  assert.equal(data.get("vid"), "", "an unresolved string has no id")
  assert.deepEqual(changes.at(-1), { make: "Lada", model: "Niva 1.7i", id: null })

  // Picking a real make still works, and the kept model goes with the old make.
  pick($("#make"), "SEAT")
  await waitFor(() => $("#model").options.length > 1)
  assert.ok(!texts($("#model")).includes("Niva 1.7i"))
})

test("a legacy free-text model under a known make is kept; keepUnknown: false drops it", async () => {
  installDOM(`
    <select id="make"><option value="seat" selected>SEAT</option></select>
    <select id="model"><option value="Leon 1.9 TDI" selected>Leon 1.9 TDI</option></select>
    <select id="make2"><option value="seat" selected>SEAT</option></select>
    <select id="model2"><option value="Leon 1.9 TDI" selected>Leon 1.9 TDI</option></select>`)
  noFetch()
  attach({ data: dataset(), make: "#make", model: "#model" })
  attach({ data: dataset(), make: "#make2", model: "#model2", keepUnknown: false })
  await waitFor(() => $("#model").options.length > 2 && $("#model2").options.length > 2)
  assert.equal($("#model").value, "Leon 1.9 TDI")
  assert.equal(selected($("#model")).defaultSelected, true, "a form reset restores it too")
  assert.equal($("#model2").value, "", "the 0.3.0 behaviour, on request")
})

test("stored names resolve to the canonical option through case, alias, form and former id", async () => {
  installDOM(`
    <select id="make"><option value="Seat" selected>Seat</option></select>
    <select id="model"><option value="Leon Sportstourer" selected>Leon Sportstourer</option></select>
    <input id="vid" type="hidden">
    <select id="make2"><option value="VW" selected>VW</option></select>
    <select id="model2"><option value="golf" selected>golf</option></select>
    <select id="make3"><option value="SEAT" selected>SEAT</option></select>
    <select id="model3"><option value="Leon X-Perience" selected>Leon X-Perience</option></select>
    <input id="vid3" type="hidden" value="car/seat/leon-st">`)
  noFetch()
  attach({ data: dataset(), make: "#make", model: "#model", idInput: "#vid", values: "name" })
  attach({ data: dataset(), make: "#make2", model: "#model2", values: "name" })
  attach({ data: dataset(), make: "#make3", model: "#model3", idInput: "#vid3", values: "name" })
  await waitFor(() => $("#vid").value && $("#model2").value === "Golf" && $("#vid3").value === "car/seat/leon")

  assert.equal($("#make").value, "SEAT", "the canonical make name, so the form stores it")
  assert.equal($("#model").value, "León", "a curated form lands on its record")
  assert.equal($("#vid").value, "car/seat/leon")
  assert.ok(!texts($("#model")).includes("Leon Sportstourer"), "nothing kept when the data resolves it")
  assert.equal($("#make2").value, "Volkswagen", "a published make alias")
  assert.equal($("#model3").value, "León", "a stored former id names its record when the text cannot")
})

test("a kind collision takes the RESOLUTION §3a tie-break, only among the scoped list", async () => {
  installDOM(`
    <select id="make"><option value="iveco" selected></option></select>
    <select id="model"><option value="Daily" selected></option></select><input id="vid">
    <select id="make2"><option value="iveco" selected></option></select>
    <select id="model2"><option value="Daily" selected></option></select><input id="vid2">
    <select id="make3"><option value="iveco" selected></option></select>
    <select id="model3"><option value="Daily" selected></option></select><input id="vid3">
    <select id="make4"><option value="iveco" selected></option></select>
    <select id="model4"><option value="Turbodaily" selected></option></select><input id="vid4">
    <select id="make5"><option value="iveco" selected></option></select>
    <select id="model5"><option value="Daily" selected></option></select><input id="vid5" value="truck/iveco/daily">`)
  noFetch()
  // Unhinted: three records, one mass_decile → kind precedence → the van.
  attach({ data: dataset(), make: "#make", model: "#model", idInput: "#vid" })
  // The van is not evidenced in Great Britain: bus beats truck.
  attach({ data: dataset(), make: "#make2", model: "#model2", idInput: "#vid2", country: "gb" })
  // A kind scopes it outright.
  attach({ data: dataset(), make: "#make3", model: "#model3", idInput: "#vid3", kind: "truck" })
  // A form only the van publishes is the van, never widened to its siblings.
  attach({ data: dataset(), make: "#make4", model: "#model4", idInput: "#vid4", country: "gb" })
  // A stored id is explicit and beats the tie-break.
  attach({ data: dataset(), make: "#make5", model: "#model5", idInput: "#vid5" })
  await waitFor(() => ["#vid", "#vid2", "#vid3", "#vid5"].every((s) => $(s).value) && $("#model4").options.length > 2)

  assert.equal($("#vid").value, "van/iveco/daily")
  assert.equal(selected($("#model")).value, "daily")
  assert.equal($("#vid2").value, "bus/iveco/daily")
  assert.equal($("#vid3").value, "truck/iveco/daily")
  assert.equal($("#model4").value, "Turbodaily", "out of scope in gb: kept as given")
  assert.equal($("#vid4").value, "")
  assert.equal($("#vid5").value, "truck/iveco/daily")

  // The person picks the third "Daily" row: the id follows the OPTION, not
  // the first option with that value.
  const model = $("#model")
  const truck = Array.from(model.options).findIndex((o) => o.value === "daily" && o !== selected(model) &&
    Array.from(model.options).indexOf(o) > 0)
  model.selectedIndex = truck
  model.dispatchEvent(new Event("change", { bubbles: true }))
  assert.match($("#vid").value, /^(bus|truck)\/iveco\/daily$/)
  assert.notEqual($("#vid").value, "van/iveco/daily")
})

test("findModel: the lowest mass_decile wins a kind collision, then kind precedence", () => {
  const { findModel } = VehiclesDropdown
  const transit = [
    { name: "Transit", slug: "transit", kind: "truck", mass_decile: 2 },
    { name: "Transit", slug: "transit", kind: "car", mass_decile: 4 },
    { name: "Transit", slug: "transit", kind: "van" } // unranked: last
  ]
  assert.equal(findModel(transit, "Transit").kind, "truck")
  const tied = [
    { name: "X", slug: "x", kind: "motorcycle", mass_decile: 1 },
    { name: "X", slug: "x", kind: "moped", mass_decile: 1 },
    { name: "X", slug: "x", kind: "quad", mass_decile: 1 },
    { name: "X", slug: "x", kind: "car", mass_decile: 1 }
  ]
  assert.equal(findModel(tied, "x").kind, "car")
  assert.equal(findModel(tied.filter((m) => m.kind !== "car"), "x").kind, "moped")
  assert.equal(findModel(tied.filter((m) => m.kind === "quad" || m.kind === "motorcycle"), "x").kind, "motorcycle")
  assert.equal(findModel([{ name: "Y", slug: "y", kind: "car", massDecile: 1 }, { name: "Y", slug: "y", kind: "van", massDecile: 3 }], "y").kind,
    "car", "the SDK's camelCase field counts too")
})

test("idInput follows the selection and announces it; the custom event carries the id", async () => {
  installDOM(`<div id="host"><select id="make"></select><select id="model"></select><input id="vid" type="hidden"></div>`)
  noFetch()
  const idEvents = []
  const details = []
  $("#vid").addEventListener("change", () => idEvents.push($("#vid").value))
  $("#host").addEventListener("make-model-dropdown:change", (event) => details.push(event.detail))
  const instance = attach({ data: dataset(), make: "#make", model: "#model", idInput: "#vid", includeOther: true })
  await waitFor(() => $("#make").options.length > 1)

  pick($("#make"), "seat")
  await waitFor(() => $("#model").options.length > 1)
  pick($("#model"), "leon")
  assert.equal($("#vid").value, "car/seat/leon")
  assert.deepEqual(instance.value, { make: "seat", model: "leon", id: "car/seat/leon" })
  assert.deepEqual(details.at(-1), { make: "seat", model: "leon", id: "car/seat/leon" })

  pick($("#model"), "other")
  assert.equal($("#vid").value, "", "Other has no id")
  pick($("#model"), "ibiza")
  pick($("#make"), "volkswagen")
  assert.equal($("#vid").value, "", "a make change clears the id with the model")
  assert.deepEqual(idEvents, ["car/seat/leon", "", "car/seat/ibiza", ""])
})

test("setValue resolves like a stored value: canonical when it can, kept when it cannot", async () => {
  installDOM(`<select id="make"></select><select id="model"></select><input id="vid">`)
  noFetch()
  const instance = attach({ data: dataset(), make: "#make", model: "#model", idInput: "#vid", values: "name" })
  await instance.setValue({ make: "citroen", model: "c3" })
  assert.deepEqual(instance.value, { make: "Citroën", model: "C3", id: "car/citroen/c3" })
  await instance.setValue({ make: "Seat", model: "Leon 1.9 TDI" })
  assert.deepEqual(instance.value, { make: "SEAT", model: "Leon 1.9 TDI", id: null })
  await instance.setValue({ make: "Tata", model: "Nano" })
  assert.deepEqual(instance.value, { make: "Tata", model: "Nano", id: null })
  assert.equal(texts($("#make")).filter((t) => t === "Tata").length, 1)
  await instance.setValue({ make: "Seat", model: "Whatever", id: "car/seat/leon-st" })
  assert.deepEqual(instance.value, { make: "SEAT", model: "León", id: "car/seat/leon" })
})

test("otherValue: an app's own word for Other round-trips a stored escape hatch", async () => {
  installDOM(`
    <select id="make"><option value="Otro" selected>Otro</option></select>
    <select id="model"><option value="Otro" selected>Otro</option></select><input id="vid" value="">`)
  noFetch()
  attach({ data: dataset(), make: "#make", model: "#model", idInput: "#vid", values: "name",
    includeOther: true, otherLabel: "Otro", otherValue: "Otro" })
  await waitFor(() => $("#model").value === "Otro" && $("#make").options.length > 2)
  assert.equal($("#make").value, "Otro")
  assert.equal(texts($("#make")).filter((t) => t === "Otro").length, 1, "no duplicate row for the stored value")
  assert.equal(texts($("#model")).filter((t) => t === "Otro").length, 1)
  assert.equal($("#vid").value, "")
})

test("the combobox shows a kept make and mirrors the host's disabled", async () => {
  installDOM(`<select id="make"><option value="Tata" selected>Tata</option></select>`)
  noFetch()
  attach({ data: dataset(), make: "#make", search: true })
  await waitFor(() => $("#make").options.length > 2)
  const input = document.querySelector("[role=combobox]")
  assert.equal(input.value, "Tata")
  $("#make").disabled = true
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(input.disabled, true)
  $("#make").disabled = false
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(input.disabled, false)
})

test("a model list that fails to load keeps the stored model and its id", async () => {
  installDOM(`
    <select id="make"><option value="seat" selected>SEAT</option></select>
    <select id="model"><option value="leon" selected>León</option></select>
    <input id="vid" value="car/seat/leon">`)
  global.fetch = async (url) => url.includes("/models")
    ? new Response("{}", { status: 500 })
    : new Response(JSON.stringify({ makes: [{ name: "SEAT", slug: "seat" }] }))
  const errors = []
  attach({ key: "pk", apiBase: "https://models-down.test/api/v1", make: "#make", model: "#model",
    idInput: "#vid", onError: (e) => errors.push(e) })
  await waitFor(() => errors.length === 1)
  assert.equal($("#model").value, "leon")
  assert.equal($("#vid").value, "car/seat/leon")
})

test("the ES module build is in sync with the UMD source and imports cleanly", async () => {
  const { build } = require("../scripts/build-esm.js")
  assert.equal(fs.readFileSync(path.join(__dirname, "..", "make-model-dropdown.mjs"), "utf8"), build(),
    "run `node scripts/build-esm.js`")
  const esm = await import("../make-model-dropdown.mjs")
  const legacy = await import("../index.mjs")
  const pkg = await import("make-model-dropdown")
  assert.equal(esm.default.version, require("../package.json").version)
  assert.equal(typeof esm.attach, "function")
  assert.equal(typeof esm.findModel, "function")
  assert.equal(legacy.default, esm.default)
  assert.equal(pkg.default, esm.default, "`import` resolves to the ES module build")
  assert.equal(globalThis.VehiclesDropdown, undefined, "the module build defines no global")
  const source = fs.readFileSync(path.join(__dirname, "..", "make-model-dropdown.mjs"), "utf8")
  assert.doesNotMatch(source, /^\s*import\s/m, "one self-contained file: importmap vendors a single file")
})
