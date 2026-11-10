// 0.4.1: a server-rendered dataset slice as `data` (the Ruby gem's
// Vehicles.dataset_slice), and the localized, non-blankable credit line.
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const { afterEach, test } = require("node:test")
const { JSDOM } = require("jsdom")

const VehiclesDropdown = require("../make-model-dropdown.js")

// Written by the gem, unedited:
//   ruby -rvehicles -rjson -e 'puts JSON.generate(Vehicles.dataset_slice(kind: :car, country: :ie))'
// (vehicles 0.9.2, data 2026.11.2). Ireland's cars: 36 makes, 238 models,
// ~80 KB; the shape is the same as Spain's (~300 KB).
const FIXTURE = path.join(__dirname, "fixtures", "gem-slice-car-ie.json")
const slice = () => JSON.parse(fs.readFileSync(FIXTURE, "utf8"))

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

function captureWarnings() {
  const warnings = []
  const original = console.warn
  console.warn = (...args) => { warnings.push(args.join(" ")) }
  return { warnings, restore() { console.warn = original } }
}

const $ = (selector) => document.querySelector(selector)
const texts = (select) => Array.from(select.options).map((option) => option.text)
const selected = (select) => select.options[select.selectedIndex]

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

// ---- the gem's slice as `data` --------------------------------------------

test("a gem dataset slice as data: no request, every make in it, canonical ids", async () => {
  installDOM(`<select id="make"></select><select id="model"></select><input type="hidden" id="vid">`)
  noFetch()
  const data = slice()
  attach({ data, kind: "car", country: "ie", make: "#make", model: "#model", idInput: "#vid", attribution: false })
  await waitFor(() => $("#make").options.length > 1, "makes")

  assert.equal($("#make").options.length - 1, data.makes.length)
  $("#make").value = "volkswagen"
  $("#make").dispatchEvent(new Event("change", { bubbles: true }))
  await waitFor(() => $("#model").options.length > 1, "models")
  // Ireland's own registration order, from the slice's projected country_ranks.
  const vw = data.makes.find((make) => make.slug === "volkswagen").models
  const best = vw.slice().sort((a, b) => a.country_ranks.ie - b.country_ranks.ie)[0]
  assert.equal(texts($("#model"))[1], best.name)
  $("#model").value = "golf"
  $("#model").dispatchEvent(new Event("change", { bubbles: true }))
  assert.equal($("#vid").value, "car/volkswagen/golf")
})

test("stored values resolve on the slice the way they do on the release", async () => {
  // A make alias, a registry form, and a stored former id: what CarHey's edit
  // forms render.
  installDOM(`
    <select id="make"><option value="VW" selected>VW</option></select>
    <select id="model"><option value="Vw Golf" selected>Vw Golf</option></select>
    <select id="make2"><option value="BMW" selected>BMW</option></select>
    <select id="model2"><option value="whatever" selected>whatever</option></select>
    <input type="hidden" id="vid2" value="car/bmw/serie-3">`)
  noFetch()
  const data = slice()
  attach({ data, kind: "car", country: "ie", values: "name", make: "#make", model: "#model", attribution: false })
  attach({ data, kind: "car", country: "ie", make: "#make2", model: "#model2", idInput: "#vid2", attribution: false })
  await waitFor(() => selected($("#model"))?.text === "Golf" && selected($("#model2"))?.text === "3 Series", "reselection")

  assert.equal(selected($("#make")).value, "Volkswagen")
  assert.equal($("#vid2").value, "car/bmw/3-series", "a former id selects the record that absorbed it")
})

// ---- the credit line --------------------------------------------------------

function creditOf(element) {
  const links = Array.from(element.querySelectorAll("a")).map((a) => [a.textContent, a.href])
  return { text: element.textContent, links }
}

const REQUIRED_LINKS = [
  ["VehiclesDB", "https://vehiclesdb.com/"],
  ["CC-BY 4.0", "https://creativecommons.org/licenses/by/4.0/"]
]

test("the credit line links VehiclesDB and the licence, in English by default", async () => {
  installDOM(`<div><select id="make"></select></div>`)
  noFetch()
  attach({ data: slice(), make: "#make" })

  const credit = creditOf($(".vdb-attribution"))
  assert.equal(credit.text, "Vehicle data by VehiclesDB (CC-BY 4.0)")
  assert.deepEqual(credit.links, REQUIRED_LINKS)
})

test("locale: 'es' translates the credit line and the widget's own strings", async () => {
  installDOM(`<div><select id="make" required></select><select id="model"></select><select id="year"></select></div>`)
  noFetch()
  attach({ data: slice(), kind: "car", locale: "es-ES", make: "#make", model: "#model", year: "#year", includeOther: true })
  await waitFor(() => $("#make").options.length > 1, "makes")

  const credit = creditOf($(".vdb-attribution"))
  assert.equal(credit.text, "Datos de vehículos de VehiclesDB (CC-BY 4.0)")
  assert.deepEqual(credit.links, REQUIRED_LINKS)
  assert.equal($("#make").options[0].text, "Marca")
  assert.ok(texts($("#make")).includes("Otro / no está en la lista"))
  $("#make").value = "seat"
  $("#make").dispatchEvent(new Event("change", { bubbles: true }))
  await waitFor(() => $("#model").options.length > 1, "models")
  assert.equal($("#model").options[0].text, "Modelo")
  $("#model").value = "leon"
  $("#model").dispatchEvent(new Event("change", { bubbles: true }))
  await waitFor(() => $("#year").options.length > 1, "years")
  assert.equal($("#year").options[0].text, "Año")
})

test("explicit options beat the locale's defaults", async () => {
  installDOM(`<div><select id="make"></select></div>`)
  noFetch()
  attach({ data: slice(), locale: "es", placeholderMake: "Fabricante", make: "#make",
    attributionText: "Fuente: {source}, licencia {license}" })
  await waitFor(() => $("#make").options.length > 1, "makes")

  assert.equal($("#make").options[0].text, "Fabricante")
  const credit = creditOf($(".vdb-attribution"))
  assert.equal(credit.text, "Fuente: VehiclesDB, licencia CC-BY 4.0")
  assert.deepEqual(credit.links, REQUIRED_LINKS)
})

test("the credit cannot be blanked: a template without both links falls back, warned", () => {
  for (const attributionText of ["", "Datos de vehículos", "Datos: {source}", "{license}", 42]) {
    installDOM(`<div><select id="make"></select></div>`)
    noFetch()
    const { warnings, restore } = captureWarnings()
    try {
      attach({ data: slice(), locale: "es", attributionText, make: "#make" })
    } finally {
      restore()
    }
    const credit = creditOf($(".vdb-attribution"))
    assert.equal(credit.text, "Datos de vehículos de VehiclesDB (CC-BY 4.0)", JSON.stringify(attributionText))
    assert.deepEqual(credit.links, REQUIRED_LINKS)
    assert.match(warnings.join("\n"), /attributionText must contain \{source\} and \{license\}/)
    instances.forEach((instance) => instance.destroy())
    instances = []
  }
})

test("the template is text: markup in it is never parsed", () => {
  installDOM(`<div><select id="make"></select></div>`)
  noFetch()
  attach({ data: slice(), make: "#make", attributionText: "<b>{source}</b> {license}<img src=x>" })

  const credit = $(".vdb-attribution")
  assert.equal(credit.querySelector("b, img"), null)
  assert.equal(credit.textContent, "<b>VehiclesDB</b> CC-BY 4.0<img src=x>")
})

test("an unknown locale falls back to English with a warning", () => {
  installDOM(`<div><select id="make"></select></div>`)
  noFetch()
  const { warnings, restore } = captureWarnings()
  try {
    attach({ data: slice(), locale: "xx", make: "#make" })
  } finally {
    restore()
  }
  assert.equal($(".vdb-attribution").textContent, "Vehicle data by VehiclesDB (CC-BY 4.0)")
  assert.match(warnings.join("\n"), /no "xx" locale/)
})
