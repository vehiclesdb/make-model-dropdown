// 0.5.0: one-tag install. `<div data-vehiclesdb-picker>` plus the script tag
// mounts a picker from data-* attributes (the element's, then the script
// tag's), with no inline script.
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const { afterEach, test } = require("node:test")
const { JSDOM } = require("jsdom")

const VehiclesDropdown = require("../make-model-dropdown.js")
const SOURCE = fs.readFileSync(path.join(__dirname, "..", "make-model-dropdown.js"), "utf8")

function dataset() {
  return {
    version: "2026.11.2",
    makes: [
      { name: "SEAT", slug: "seat", models: [
        { name: "Ibiza", slug: "ibiza", kind: "car", availability: ["es"], global_decile: 1,
          years_on_record: { first: 2010, last: 2024 } },
        { name: "León", slug: "leon", kind: "car", availability: ["es"], global_decile: 1 }
      ] },
      { name: "Yamaha", slug: "yamaha", models: [
        { name: "MT-07", slug: "mt-07", kind: "motorcycle", availability: ["es"] }
      ] }
    ]
  }
}

function json(body) {
  return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } })
}

let dom
let instances = []
let warnings = []
const originalWarn = console.warn

function installDOM(body) {
  dom = new JSDOM(`<!doctype html><html><body>${body}</body></html>`, { url: "https://host.test" })
  global.document = dom.window.document
  global.Option = dom.window.Option
  global.Event = dom.window.Event
  global.KeyboardEvent = dom.window.KeyboardEvent
  console.warn = (...args) => warnings.push(args.join(" "))
  return dom.window.document
}

function autoInit(root) {
  const mountedNow = VehiclesDropdown.autoInit(root)
  instances.push(...mountedNow)
  return mountedNow
}

async function waitFor(predicate, message = "condition") {
  const deadline = Date.now() + 1500
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  assert.fail(`Timed out waiting for ${message}`)
}

afterEach(() => {
  instances.forEach((instance) => instance.destroy())
  instances = []
  warnings = []
  console.warn = originalWarn
  dom?.window.close()
  dom = null
  delete global.document
  delete global.Option
  delete global.Event
  delete global.KeyboardEvent
  delete global.fetch
})

test("an empty container gets labelled selects, the credit line, and no key means the open dataset", async () => {
  const document = installDOM(`<form><div id="p" data-vehiclesdb-picker data-kind="car"></div></form>`)
  const urls = []
  global.fetch = async (url) => { urls.push(url); return json(dataset()) }

  const [ picker ] = autoInit()
  const container = document.getElementById("p")
  assert.ok(container.classList.contains("vdb-picker"))
  assert.equal(picker.config.source, "dataset", "no key and no source: the open dataset")
  const fields = container.querySelectorAll(".vdb-field")
  assert.equal(fields.length, 2, "make and model; no year unless data-year")
  const [ make, model ] = container.querySelectorAll("select")
  assert.deepEqual([ make.name, model.name ], [ "make", "model" ])
  for (const select of [ make, model ]) {
    const label = select.parentElement.querySelector("label")
    assert.equal(label.htmlFor, select.id, "each select has its own <label for>")
  }
  assert.deepEqual(Array.from(container.querySelectorAll("label"), (l) => l.textContent), [ "Make", "Model" ])
  assert.equal(container.lastElementChild.className, "vdb-attribution", "the credit line closes the picker")
  assert.match(container.lastElementChild.textContent, /VehiclesDB \(CC-BY 4\.0\)/)

  await waitFor(() => make.options.length === 2, "makes")
  assert.equal(urls.length, 1)
  assert.match(urls[0], /cdn\.jsdelivr\.net\/gh\/vehiclesdb\/vehiclesdb@latest\/dist\/vehicles\.json/)
  assert.deepEqual(Array.from(make.options, (o) => o.text), [ "Make", "SEAT" ], "data-kind scoped the list")
  make.value = "seat"
  make.dispatchEvent(new Event("change"))
  await waitFor(() => model.options.length === 3, "models")
  assert.equal(new dom.window.FormData(document.querySelector("form")).get("make"), "seat")
})

test("every attribute maps to the attach() option of the same meaning", async () => {
  const document = installDOM(`
    <div id="p" data-vehiclesdb-picker data-key="vdb_pk_test" data-source="api" data-kind="motorcycle"
      data-country="ES" data-order="alphabetical" data-top-makes="40" data-year data-search data-logos
      data-locale="es" data-name-make="vehicle[make]" data-name-model="vehicle[model]" data-name-year="vehicle[year]"
      data-id-name="vehicle[vehiclesdb_id]" data-required data-values="name"></div>`)
  const urls = []
  global.fetch = async (url) => {
    urls.push(url)
    return url.includes("/models") ? json({ models: [ { name: "MT-07", slug: "mt-07", kind: "motorcycle" } ] })
      : json({ makes: [ { name: "Yamaha", slug: "yamaha", logo_url: null } ] })
  }

  const [ picker ] = autoInit()
  const c = picker.config
  assert.deepEqual(
    [ c.key, c.source, c.kind, c.country, c.order, c.topMakes, c.search, c.logos, c.locale, c.values, c.attribution ],
    [ "vdb_pk_test", "api", "motorcycle", "ES", "alphabetical", 40, true, true, "es", "name", true ])
  const container = document.getElementById("p")
  const selects = Array.from(container.querySelectorAll("select"))
  assert.deepEqual(selects.map((s) => s.name), [ "vehicle[make]", "vehicle[model]", "vehicle[year]" ])
  assert.deepEqual(Array.from(container.querySelectorAll("label"), (l) => l.textContent), [ "Marca", "Modelo", "Año" ],
    "labels follow the locale")
  assert.equal(container.querySelector(".vdb-combobox-input").required, true, "data-required: the visible make input")
  assert.ok(selects.slice(1).every((s) => s.required), "data-required: model and year")
  const hidden = container.querySelector('input[type="hidden"]')
  assert.equal(hidden.name, "vehicle[vehiclesdb_id]")
  assert.equal(picker.idInput, hidden)
  assert.match(container.querySelector(".vdb-attribution").textContent, /Datos de vehículos de VehiclesDB/)

  await waitFor(() => urls.length === 1)
  assert.match(urls[0], /\/makes\?kind=motorcycle&country=ES&order=popular&limit=40$/)
  await waitFor(() => selects[0].options.length === 2)
  selects[0].value = "Yamaha"
  selects[0].dispatchEvent(new Event("change"))
  await waitFor(() => selects[1].options.length === 2, "models")
  selects[1].value = "MT-07"
  selects[1].dispatchEvent(new Event("change"))
  assert.equal(hidden.value, "motorcycle/yamaha/mt-07")
  assert.ok(selects[2].options.length > 1, "the year step is on")
})

test("Other and the placeholders take the page's own words", async () => {
  const document = installDOM(`<div id="p" data-vehiclesdb-picker data-year data-include-other
    data-other-label="Inne / brak na liście" data-placeholder-make="Marka" data-placeholder-model="Model"
    data-placeholder-year="Rok produkcji"></div>`)
  global.fetch = async () => json(dataset())
  const [ picker ] = autoInit()
  assert.equal(picker.config.includeOther, true)
  assert.equal(picker.config.otherLabel, "Inne / brak na liście")
  assert.deepEqual(Array.from(document.querySelectorAll("#p label"), (l) => l.textContent), [ "Marka", "Model", "Rok produkcji" ],
    "the built labels are the placeholders")
  await waitFor(() => picker.makeSelect.options.length === 4, "makes")
  assert.equal(picker.makeSelect.options[0].text, "Marka")
  assert.equal(picker.makeSelect.options[3].text, "Inne / brak na liście")
})

test("data-attribution=\"false\" is the existing attribution: false; any other value keeps the credit", () => {
  const document = installDOM(`
    <div id="off" data-vehiclesdb-picker data-attribution="false"></div>
    <div id="on" data-vehiclesdb-picker data-attribution="no"></div>`)
  global.fetch = async () => json(dataset())
  const [ off, on ] = autoInit()
  assert.equal(off.config.attribution, false)
  assert.equal(document.querySelector("#off .vdb-attribution"), null)
  assert.equal(on.config.attribution, true)
  assert.ok(document.querySelector("#on .vdb-attribution"))
})

test("selects marked data-make / data-model / data-year are used as they are", async () => {
  const document = installDOM(`
    <div id="p" data-vehiclesdb-picker>
      <label for="mk">Brand</label><select id="mk" name="car_make" class="form-select" data-make><option selected>Seat</option></select>
      <select id="md" name="car_model" data-model></select>
      <select id="yr" name="car_year" data-year></select>
      <input type="hidden" name="vid" data-id>
    </div>`)
  global.fetch = async () => json(dataset())
  const [ picker ] = autoInit()
  const container = document.getElementById("p")
  assert.equal(container.querySelectorAll("select").length, 3, "nothing created")
  assert.equal(container.querySelectorAll(".vdb-field").length, 0)
  assert.equal(picker.makeSelect.id, "mk")
  assert.equal(picker.yearSelect.id, "yr")
  assert.equal(picker.idInput.name, "vid")
  await waitFor(() => picker.makeSelect.value === "seat", "the stored make resolves to its option")

  picker.destroy()
  instances = []
  assert.equal(container.querySelectorAll("select").length, 3, "destroy leaves the host's own selects")
  assert.equal(container.querySelector(".vdb-attribution"), null)
})

test("two pickers on one page get their own ids and work independently", async () => {
  const document = installDOM(`
    <div id="a" data-vehiclesdb-picker></div>
    <div id="b" data-vehiclesdb-picker data-year></div>`)
  let fetches = 0
  global.fetch = async () => { fetches += 1; return json(dataset()) }
  const mountedNow = autoInit()
  assert.equal(mountedNow.length, 2)
  const ids = Array.from(document.querySelectorAll("select"), (s) => s.id)
  assert.equal(ids.length, 5)
  assert.equal(new Set(ids).size, 5, "ids are unique per instance")
  await waitFor(() => mountedNow.every((p) => p.makeSelect.options.length === 3), "makes")
  assert.ok(fetches <= 1, "one dataset request shared by both (none if an earlier test cached it)")
  mountedNow[0].makeSelect.value = "seat"
  mountedNow[0].makeSelect.dispatchEvent(new Event("change"))
  assert.equal(mountedNow[1].makeSelect.value, "")
})

test("never mounts twice, autoInit(root) picks up containers added later, destroy allows a remount", async () => {
  const document = installDOM(`<div id="a" data-vehiclesdb-picker></div><main id="later"></main>`)
  global.fetch = async () => json(dataset())
  assert.equal(autoInit().length, 1)
  assert.equal(autoInit().length, 0, "already mounted")
  assert.equal(document.querySelectorAll("#a select").length, 2)

  const later = document.getElementById("later")
  later.innerHTML = `<div id="b" data-vehiclesdb-picker></div>`
  const added = autoInit(later)
  assert.equal(added.length, 1)
  assert.equal(added[0].makeSelect.closest("[data-vehiclesdb-picker]").id, "b")
  assert.equal(autoInit(document.getElementById("b")).length, 0, "the root itself counts")

  const first = instances.shift()
  first.destroy()
  const a = document.getElementById("a")
  assert.equal(a.children.length, 0, "destroy removes what autoInit built")
  assert.ok(!a.classList.contains("vdb-picker"))
  assert.equal(autoInit().length, 1, "and the container can be mounted again")
  assert.equal(document.querySelectorAll("#a select").length, 2)
})

test("a container that cannot mount warns and leaves nothing behind", () => {
  const document = installDOM(`<div id="p" data-vehiclesdb-picker data-source="api"></div>`)
  assert.equal(autoInit().length, 0)
  assert.equal(document.getElementById("p").children.length, 0)
  assert.match(warnings.join("\n"), /could not mount a picker: .*publishable API key/)
})

test("an explicit key with no source keeps the API, as attach() does", () => {
  installDOM(`<div data-vehiclesdb-picker data-key="vdb_pk_x"></div>`)
  global.fetch = async () => json({ makes: [] })
  const [ picker ] = autoInit()
  assert.equal(picker.config.source, "api")
  assert.equal(picker.datasetMode, false)
})

test("the script tag mounts by itself, reading defaults from its own data-* attributes", async () => {
  const urls = []
  const html = `<!doctype html><html><body>
    <div id="before" data-vehiclesdb-picker></div>
    <script data-kind="motorcycle" data-locale="es">${SOURCE}</script>
    <div id="after" data-vehiclesdb-picker data-kind="car"></div>
  </body></html>`
  const browser = new JSDOM(html, {
    url: "https://host.test",
    runScripts: "dangerously",
    beforeParse(window) {
      window.fetch = async (url) => {
        urls.push(url)
        return json(dataset())
      }
    }
  })
  const doc = browser.window.document
  // Each container mounts once: the one above the tag right away, the one
  // below on DOMContentLoaded.
  await waitFor(() => doc.querySelectorAll("#before select").length === 2 && doc.querySelectorAll("#after select").length === 2,
    "both pickers mounted")
  await waitFor(() => doc.querySelector("#before select").options.length === 2 &&
    doc.querySelector("#after select").options.length === 2, "makes")
  assert.equal(doc.querySelector("#before select").options[1].text, "Yamaha", "the script tag's data-kind")
  assert.equal(doc.querySelector("#after select").options[1].text, "SEAT", "the element's own data-kind wins")
  assert.equal(doc.querySelector("#after label").textContent, "Marca", "the script tag's data-locale")
  assert.equal(browser.window.VehiclesDropdown.autoInit().length, 0)
  assert.equal(urls.length, 1)
  browser.window.close()
})

test("pages that only call attach() see no change", () => {
  const browser = new JSDOM(`<!doctype html><select id="make"></select><select id="model"></select>`,
    { runScripts: "outside-only" })
  browser.window.fetch = async () => new Response("{}")
  browser.window.eval(SOURCE)
  const doc = browser.window.document
  assert.equal(doc.querySelectorAll("select").length, 2)
  assert.equal(doc.querySelector(".vdb-picker, .vdb-attribution"), null)
  browser.window.close()
})

test("the ES module does not auto-mount on import and exports autoInit", async () => {
  const esm = await import("../make-model-dropdown.mjs")
  assert.equal(typeof esm.autoInit, "function")
  assert.equal(esm.default.autoInit, esm.autoInit)
  assert.deepEqual(esm.autoInit(), [], "no document (Node): nothing to do, nothing thrown")
  const source = fs.readFileSync(path.join(__dirname, "..", "make-model-dropdown.mjs"), "utf8")
  assert.match(source, /^\}\)\(\)$/m, "the module calls the factory without autoStart")
})
