const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const { afterEach, test } = require("node:test")
const { JSDOM } = require("jsdom")

const VehiclesDropdown = require("../make-model-dropdown.js")

test("the published browser script installs the documented global", () => {
  const browser = new JSDOM("<!doctype html>", { runScripts: "outside-only" })
  const source = fs.readFileSync(path.join(__dirname, "..", "make-model-dropdown.js"), "utf8")

  browser.window.eval(source)

  assert.equal(browser.window.VehiclesDropdown.version, "0.2.0")
  assert.equal(typeof browser.window.VehiclesDropdown.attach, "function")
  browser.window.close()
})

let sequence = 0
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

function apiBase(label) {
  sequence += 1
  return `https://${label}-${sequence}.test/api/v1`
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  })
}

function attach(options) {
  const instance = VehiclesDropdown.attach(options)
  instances.push(instance)
  return instance
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
  dom?.window.close()
  dom = null
  delete global.document
  delete global.Option
  delete global.Event
  delete global.KeyboardEvent
  delete global.fetch
})

test("request caches are isolated by credential and retry failures", async () => {
  const document = installDOM(`
    <select id="a"></select><select id="b"></select>
    <select id="c"></select><select id="d"></select>
  `)
  const base = apiBase("cache")
  const calls = []
  let retry = false
  let failed = false
  global.fetch = async (url, options) => {
    const key = options.headers.Authorization
    calls.push([url, key])
    if (key === "Bearer retry" && !retry) {
      retry = true
      return jsonResponse({ message: "temporary" }, 503)
    }
    return jsonResponse({ makes: [{ name: key, slug: key.replace("Bearer ", "") }] })
  }

  attach({ key: "alpha", apiBase: base, make: "#a", attribution: false })
  attach({ key: "beta", apiBase: base, make: "#b", attribution: false })
  await waitFor(() => document.querySelector("#a").options.length === 2 && document.querySelector("#b").options.length === 2)
  assert.equal(calls.length, 2, "different keys must authenticate independently")

  attach({ key: "alpha", apiBase: base, make: "#c", attribution: false })
  await waitFor(() => document.querySelector("#c").options.length === 2)
  assert.equal(calls.length, 2, "the same URL and key should share one request")

  attach({ key: "retry", apiBase: base, make: "#d", attribution: false, onError() { failed = true } })
  await waitFor(() => failed)
  instances.pop().destroy()
  attach({ key: "retry", apiBase: base, make: "#d", attribution: false })
  await waitFor(() => document.querySelector("#d").options.length === 2)
  assert.equal(calls.filter(([, key]) => key === "Bearer retry").length, 2,
    "a rejected promise must not poison the page cache")
})

test("malformed successful payloads are rejected without poisoning the cache", async () => {
  const document = installDOM(`<select id="make"></select>`)
  const base = apiBase("malformed")
  let calls = 0
  let errors = 0
  global.fetch = async () => {
    calls += 1
    return calls === 1 ? jsonResponse({ makes: null }) : jsonResponse({ makes: [{ name: "Audi", slug: "audi" }] })
  }

  const first = attach({
    key: "malformed-key", apiBase: base, make: "#make", attribution: false,
    onError(error) { errors += 1; assert.match(error.message, /malformed makes data/) }
  })
  await waitFor(() => errors === 1)
  first.destroy()
  instances = []

  attach({ key: "malformed-key", apiBase: base, make: "#make", attribution: false })
  await waitFor(() => document.querySelector("#make").options.length === 2)
  assert.equal(calls, 2)
})

test("attach validates its element and credential contract synchronously", () => {
  installDOM(`<div id="not-select"></div><select id="multiple" multiple></select><select id="one"></select>`)

  assert.throws(() => VehiclesDropdown.attach({ key: "", make: "#one" }), /publishable API key/)
  assert.throws(() => VehiclesDropdown.attach({ key: "key", make: "#not-select" }), /single-select/)
  assert.throws(() => VehiclesDropdown.attach({ key: "key", make: "#multiple" }), /single-select/)
  assert.throws(() => VehiclesDropdown.attach({ key: "key", make: "#one", model: "#one" }), /must be different/)
})

test("a throwing host callback cannot interrupt dependent model loading", async () => {
  const document = installDOM(`<select id="make"></select><select id="model"></select>`)
  const base = apiBase("callbacks")
  const logged = []
  const originalError = console.error
  console.error = (...args) => logged.push(args)
  global.fetch = async (url) => {
    if (url.includes("/models")) return jsonResponse({ models: [{ name: "A3", slug: "a3" }] })
    return jsonResponse({ makes: [{ name: "Audi", slug: "audi" }] })
  }

  try {
    attach({
      key: "callback-key", apiBase: base, make: "#make", model: "#model", attribution: false,
      onChange() { throw new Error("consumer failed") },
      onError() { throw new Error("error consumer failed") }
    })
    await waitFor(() => document.querySelector("#make").options.length === 2)
    document.querySelector("#make").value = "audi"
    document.querySelector("#make").dispatchEvent(new Event("change", { bubbles: true }))
    await waitFor(() => document.querySelector("#model").options.length === 2, "models after callback failure")
    assert.equal(document.querySelector("#model").options[1].value, "a3")
    // The consumer bug lands in console.error whole, and never in onError.
    assert.equal(logged.length, 1)
    assert.match(String(logged[0][1]), /consumer failed/)
  } finally {
    console.error = originalError
  }
})

test("destroying from onChange prevents the dependent request", async () => {
  const document = installDOM(`<select id="make"></select><select id="model"></select>`)
  const base = apiBase("callback-destroy")
  let modelCalls = 0
  let instance
  global.fetch = async (url) => {
    if (url.includes("/models")) {
      modelCalls += 1
      return jsonResponse({ models: [] })
    }
    return jsonResponse({ makes: [{ name: "Audi", slug: "audi" }] })
  }

  instance = attach({
    key: "callback-destroy-key", apiBase: base, make: "#make", model: "#model", attribution: false,
    onChange() { instance.destroy() }
  })
  await waitFor(() => document.querySelector("#make").options.length === 2)
  document.querySelector("#make").value = "audi"
  document.querySelector("#make").dispatchEvent(new Event("change", { bubbles: true }))
  await new Promise((resolve) => setTimeout(resolve, 10))

  assert.equal(modelCalls, 0)
  instance.destroy() // idempotent
  instances = []
})

test("initialModel waits for its intended make", async () => {
  const document = installDOM(`
    <select id="make"><option value="volkswagen" selected>Volkswagen</option></select>
    <select id="model"></select>
  `)
  const base = apiBase("initial")
  global.fetch = async (url) => {
    if (url.includes("/volkswagen/models")) {
      return jsonResponse({ models: [{ name: "Golf", slug: "golf" }] })
    }
    if (url.includes("/audi/models")) {
      return jsonResponse({ models: [{ name: "A3", slug: "a3" }] })
    }
    return jsonResponse({ makes: [
      { name: "Audi", slug: "audi" },
      { name: "Volkswagen", slug: "volkswagen" }
    ] })
  }

  attach({
    key: "initial-key", apiBase: base, make: "#make", model: "#model",
    initialMake: "audi", initialModel: "a3", attribution: false
  })
  await waitFor(() => document.querySelector("#model").options.length === 2)
  assert.equal(document.querySelector("#make").value, "volkswagen")
  assert.equal(document.querySelector("#model").value, "",
    "an initial model for Audi must never be applied to the host's Volkswagen selection")

  document.querySelector("#make").value = "audi"
  document.querySelector("#make").dispatchEvent(new Event("change", { bubbles: true }))
  await waitFor(() => document.querySelector("#model").value === "a3")
})

test("stale model responses cannot overwrite a newer make", async () => {
  const document = installDOM(`<select id="make"></select><select id="model"></select>`)
  const base = apiBase("stale")
  const resolvers = {}
  const changes = []
  global.fetch = async (url) => {
    if (!url.includes("/models")) {
      return jsonResponse({ makes: [
        { name: "Audi", slug: "audi" },
        { name: "BMW", slug: "bmw" }
      ] })
    }
    return new Promise((resolve) => {
      resolvers[url.includes("/audi/") ? "audi" : "bmw"] = resolve
    })
  }

  attach({
    key: "stale-key", apiBase: base, make: "#make", model: "#model", attribution: false,
    onChange(value) { changes.push(value) }
  })
  await waitFor(() => document.querySelector("#make").options.length === 3)
  const make = document.querySelector("#make")
  make.value = "audi"
  make.dispatchEvent(new Event("change", { bubbles: true }))
  await waitFor(() => resolvers.audi)
  make.value = "bmw"
  make.dispatchEvent(new Event("change", { bubbles: true }))
  await waitFor(() => resolvers.bmw)

  resolvers.bmw(jsonResponse({ models: [{ name: "3 Series", slug: "3-series" }] }))
  await waitFor(() => document.querySelector("#model").options.length === 2)
  resolvers.audi(jsonResponse({ models: [{ name: "A3", slug: "a3" }] }))
  await new Promise((resolve) => setTimeout(resolve, 10))

  assert.equal(document.querySelector("#model").options[1].value, "3-series")
  assert.deepEqual(changes.slice(-2), [
    { make: "audi", model: null },
    { make: "bmw", model: null }
  ])
})

test("keyboard selection follows the ARIA active option and keeps Other reachable", async () => {
  const document = installDOM(`<label for="make">Make</label><select id="make"></select>`)
  dom.window.HTMLElement.prototype.scrollIntoView = () => {}
  const base = apiBase("keyboard")
  global.fetch = async () => jsonResponse({ makes: [
    { name: "Audi", slug: "audi" },
    { name: "BMW", slug: "bmw" }
  ] })

  attach({
    key: "keyboard-key", apiBase: base, make: "#make", search: true,
    includeOther: true, attribution: false
  })
  await waitFor(() => document.querySelector("#make").options.length === 4)
  const input = document.querySelector("[role=combobox]")
  input.dispatchEvent(new Event("focus"))
  assert.equal(input.getAttribute("aria-expanded"), "true")
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }))
  assert.match(input.getAttribute("aria-activedescendant"), /-opt-0$/)
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
  assert.equal(document.querySelector("#make").value, "audi")
  assert.equal(input.value, "Audi")

  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
  input.value = ""
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }))
  assert.match(input.getAttribute("aria-activedescendant"), /-opt-2$/,
    "ArrowUp from a closed list starts at its last option")
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
  assert.equal(document.querySelector("#make").value, "other")

  input.dispatchEvent(new Event("focus"))
  input.value = "does not exist"
  input.dispatchEvent(new Event("input", { bubbles: true }))
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }))
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
  assert.equal(document.querySelector("#make").value, "other")
  assert.equal(input.value, "Other / not listed")
})

test("a required enhanced select remains focusable and requires a committed option", async () => {
  const document = installDOM(`
    <label for="make">Make</label>
    <p id="make-help">Choose one</p>
    <select id="make" required aria-describedby="make-help"></select>
  `)
  dom.window.HTMLElement.prototype.scrollIntoView = () => {}
  const base = apiBase("required")
  global.fetch = async () => jsonResponse({ makes: [{ name: "Audi", slug: "audi" }] })

  const instance = attach({ key: "required-key", apiBase: base, make: "#make", search: true, attribution: false })
  await waitFor(() => document.querySelector("#make").options.length === 2)
  const select = document.querySelector("#make")
  const input = document.querySelector("[role=combobox]")
  assert.equal(select.required, false)
  assert.equal(input.required, true)
  assert.equal(input.getAttribute("aria-describedby"), "make-help")
  assert.equal(input.checkValidity(), false)

  input.dispatchEvent(new Event("focus"))
  input.value = "Audi"
  input.dispatchEvent(new Event("input", { bubbles: true }))
  assert.equal(input.checkValidity(), false, "typing is not the same as selecting")
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
  assert.equal(select.value, "audi")
  assert.equal(input.checkValidity(), true)

  instance.destroy()
  instances = []
  assert.equal(select.required, true)
})

test("destroy ignores late network completions", async () => {
  const document = installDOM(`<select id="make"></select>`)
  const base = apiBase("destroy")
  let resolveFetch
  let errors = 0
  global.fetch = () => new Promise((resolve) => { resolveFetch = resolve })

  const instance = attach({
    key: "destroy-key", apiBase: base, make: "#make", attribution: false,
    onError() { errors += 1 }
  })
  await waitFor(() => resolveFetch)
  instance.destroy()
  instances = []
  resolveFetch(jsonResponse({ makes: [{ name: "Audi", slug: "audi" }] }))
  await new Promise((resolve) => setTimeout(resolve, 10))

  assert.equal(document.querySelector("#make").options.length, 0)
  assert.equal(errors, 0)
})

test("combobox stays in sync, restores typed text, and restores labels on destroy", async () => {
  const document = installDOM(`
    <label for="make">Vehicle make</label>
    <select id="make" style="display:inline-block"></select>
  `)
  const base = apiBase("combobox")
  global.fetch = async () => jsonResponse({ makes: [
    { name: "Audi", slug: "audi" },
    { name: "BMW", slug: "bmw" }
  ] })

  const instance = attach({
    key: "combobox-key", apiBase: base, make: "#make", search: true, attribution: true
  })
  await waitFor(() => document.querySelector("#make").options.length === 3)
  const select = document.querySelector("#make")
  const input = document.querySelector("[role=combobox]")
  const label = document.querySelector("label")
  assert.equal(label.htmlFor, input.id)

  select.value = "audi"
  select.dispatchEvent(new Event("change", { bubbles: true }))
  assert.equal(input.value, "Audi", "external form code must update the visible control")

  input.value = "not a make"
  input.dispatchEvent(new Event("input", { bubbles: true }))
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
  assert.equal(input.value, "Audi")
  assert.equal(select.value, "audi")

  input.value = "still not a make"
  input.dispatchEvent(new Event("blur"))
  // SYNCHRONOUSLY: a submit button clicked in the same tick as the blur must
  // already see the visible text agreeing with the form value.
  assert.equal(input.value, "Audi")
  assert.equal(select.value, "audi")

  instance.destroy()
  instances = instances.filter((candidate) => candidate !== instance)
  assert.equal(label.htmlFor, "make")
  assert.equal(select.style.display, "inline-block")
  assert.equal(document.querySelector(".vdb-combobox"), null)
  assert.equal(document.querySelector(".vdb-attribution"), null)
})

test("form reset restores the initial dependent selection and visible combobox", async () => {
  const document = installDOM(`
    <form id="vehicle">
      <select id="make"></select>
      <select id="model"></select>
    </form>
  `)
  const base = apiBase("reset")
  global.fetch = async (url) => {
    if (url.includes("/audi/models")) return jsonResponse({ models: [{ name: "A3", slug: "a3" }] })
    if (url.includes("/bmw/models")) return jsonResponse({ models: [{ name: "X5", slug: "x5" }] })
    return jsonResponse({ makes: [
      { name: "Audi", slug: "audi" },
      { name: "BMW", slug: "bmw" }
    ] })
  }

  attach({
    key: "reset-key", apiBase: base, make: "#make", model: "#model",
    initialMake: "audi", initialModel: "a3", search: true, attribution: false
  })
  await waitFor(() => document.querySelector("#model").value === "a3")

  const make = document.querySelector("#make")
  make.value = "bmw"
  make.dispatchEvent(new Event("change", { bubbles: true }))
  await waitFor(() => Array.from(document.querySelector("#model").options).some((option) => option.value === "x5"))
  document.querySelector("#model").value = "x5"

  document.querySelector("#vehicle").reset()

  await waitFor(() => make.value === "audi" && document.querySelector("#model").value === "a3")
  assert.equal(document.querySelector("[role=combobox]").value, "Audi")
})

test("logo blobs are credential-scoped and object URLs are instance-owned", async () => {
  const document = installDOM(`<select id="a"></select><select id="b"></select><select id="c"></select>`)
  const base = apiBase("logos")
  const logoCalls = []
  const created = []
  const revoked = []
  const originalCreate = URL.createObjectURL
  const originalRevoke = URL.revokeObjectURL
  URL.createObjectURL = () => {
    const url = `blob:test-${created.length + 1}`
    created.push(url)
    return url
  }
  URL.revokeObjectURL = (url) => revoked.push(url)
  global.fetch = async (url, options) => {
    if (new URL(url).pathname.endsWith("/logo")) {
      logoCalls.push(options.headers.Authorization)
      return new Response(new Blob(["svg"]), { status: 200, headers: { "Content-Type": "image/svg+xml" } })
    }
    return jsonResponse({ makes: [{ name: "Audi", slug: "audi" }] })
  }

  try {
    const first = attach({ key: "logo-a", apiBase: base, make: "#a", logos: true, attribution: false })
    const second = attach({ key: "logo-b", apiBase: base, make: "#b", logos: true, attribution: false })
    await waitFor(() => document.querySelector("#a").options.length === 2 && document.querySelector("#b").options.length === 2)
    document.querySelector("#a--vdb-combobox").dispatchEvent(new Event("focus"))
    document.querySelector("#b--vdb-combobox").dispatchEvent(new Event("focus"))
    await waitFor(() => created.length === 2, "two instance object URLs")
    const third = attach({ key: "logo-a", apiBase: base, make: "#c", logos: true, attribution: false })
    await waitFor(() => document.querySelector("#c").options.length === 2)
    document.querySelector("#c--vdb-combobox").dispatchEvent(new Event("focus"))
    await waitFor(() => created.length === 3, "cached blob with an instance URL")

    assert.deepEqual(logoCalls.sort(), ["Bearer logo-a", "Bearer logo-b"])
    first.destroy(); second.destroy(); third.destroy()
    instances = []
    assert.deepEqual(revoked.sort(), created.sort())
    assert.equal(document.querySelectorAll(".vdb-combobox").length, 0)
  } finally {
    URL.createObjectURL = originalCreate
    URL.revokeObjectURL = originalRevoke
  }
})

test("a failed logo fetch is a cached miss, not a retry storm", async () => {
  const document = installDOM(`<select id="make"></select>`)
  dom.window.HTMLElement.prototype.scrollIntoView = () => {}
  const base = apiBase("logo-miss")
  let logoCalls = 0
  global.fetch = async (url) => {
    if (new URL(url).pathname.endsWith("/logo")) {
      logoCalls += 1
      return new Response("denied", { status: 403 })
    }
    return jsonResponse({ makes: [{ name: "Audi", slug: "audi" }] })
  }

  attach({ key: "logo-miss-key", apiBase: base, make: "#make", logos: true, attribution: false })
  await waitFor(() => document.querySelector("#make").options.length === 2)
  const input = document.querySelector("[role=combobox]")
  // Every focus re-renders the list; each row asks for its logo. A failing
  // logo endpoint must cost ONE request per make for the whole pageview,
  // never one per render.
  for (let i = 0; i < 4; i += 1) {
    input.dispatchEvent(new Event("focus"))
    await new Promise((resolve) => setTimeout(resolve, 0))
    input.dispatchEvent(new Event("blur"))
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  await new Promise((resolve) => setTimeout(resolve, 10))
  assert.equal(logoCalls, 1, `expected a single cached miss, saw ${logoCalls} requests`)
})

test("focus plus Enter never overwrites a committed selection", async () => {
  const document = installDOM(`<select id="make"></select>`)
  dom.window.HTMLElement.prototype.scrollIntoView = () => {}
  const base = apiBase("enter-guard")
  global.fetch = async () => jsonResponse({ makes: [
    { name: "Abarth", slug: "abarth" },
    { name: "BMW", slug: "bmw" },
    { name: "Toyota", slug: "toyota" }
  ] })

  attach({ key: "enter-key", apiBase: base, make: "#make", search: true, attribution: false })
  await waitFor(() => document.querySelector("#make").options.length === 4)
  const select = document.querySelector("#make")
  const input = document.querySelector("[role=combobox]")

  select.value = "toyota"
  select.dispatchEvent(new Event("change", { bubbles: true }))
  assert.equal(input.value, "Toyota")

  // The bug this guards: focus opens the full list, and Enter with nothing
  // active used to commit the first row alphabetically (Abarth).
  input.dispatchEvent(new Event("focus"))
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
  assert.equal(select.value, "toyota", "Enter with no active row must not pick row zero")
  assert.equal(input.value, "Toyota")

  // Typing down to a single match plus Enter is still the productive path.
  input.value = "bm"
  input.dispatchEvent(new Event("input", { bubbles: true }))
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
  assert.equal(select.value, "bmw")
  assert.equal(input.value, "BMW")

  // Garbage text plus Enter restores the committed pair before any submit.
  input.value = "zzzz"
  input.dispatchEvent(new Event("input", { bubbles: true }))
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
  assert.equal(select.value, "bmw")
  assert.equal(input.value, "BMW")
})

test("a dropped server preselection announces itself instead of diverging silently", async () => {
  const document = installDOM(`
    <select id="make"><option value="lada" selected>Lada</option></select>
  `)
  const base = apiBase("preselect-drop")
  global.fetch = async () => jsonResponse({ makes: [{ name: "Audi", slug: "audi" }] })
  const changes = []
  const warnings = []
  const originalWarn = console.warn
  console.warn = (...parts) => warnings.push(parts.join(" "))
  try {
    attach({ key: "drop-key", apiBase: base, make: "#make", attribution: false,
      onChange(value) { changes.push(value) } })
    await waitFor(() => changes.length === 1)
  } finally {
    console.warn = originalWarn
  }
  assert.equal(document.querySelector("#make").value, "")
  assert.equal(changes[0].make, null, "the consumer must hear that the selection is gone")
  assert.ok(warnings.some((line) => line.includes("lada")), "the dropped value should be named")
})

test("a consumer onChange bug is not delivered to onError as an API failure", async () => {
  const document = installDOM(`<select id="make"></select><select id="model"></select>`)
  const base = apiBase("onchange-bug")
  global.fetch = async (url) => new URL(url).pathname.endsWith("/models")
    ? jsonResponse({ models: [] })
    : jsonResponse({ makes: [{ name: "Audi", slug: "audi" }] })
  const apiErrors = []
  attach({ key: "bug-key", apiBase: base, make: "#make", model: "#model", attribution: false,
    onChange() { throw new Error("consumer bug") },
    onError(error) { apiErrors.push(error) } })
  await waitFor(() => document.querySelector("#make").options.length === 2)
  const select = document.querySelector("#make")
  select.value = "audi"
  select.dispatchEvent(new Event("change", { bubbles: true }))
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(apiErrors.length, 0, "onError is for API failures, not consumer exceptions")
})

// The year step. Every select below is driven the way a person drives it:
// set the value, then dispatch the change event the browser would.
function pick(select, value) {
  select.value = value
  select.dispatchEvent(new Event("change", { bubbles: true }))
}

function optionValues(select) {
  return Array.from(select.options).map((option) => option.value)
}

test("the year step fills the chosen model's register span, newest first", async () => {
  const document = installDOM(`<select id="make"></select><select id="model"></select><select id="year"></select>`)
  const base = apiBase("year-span")
  const changes = []
  global.fetch = async (url) => new URL(url).pathname.endsWith("/models")
    ? jsonResponse({ models: [{ name: "A3", slug: "a3", years_on_record: { first: 2018, last: 2021 } }] })
    : jsonResponse({ makes: [{ name: "Audi", slug: "audi" }] })

  const instance = attach({
    key: "year-span-key", apiBase: base, make: "#make", model: "#model", year: "#year",
    attribution: false, onChange(value) { changes.push(value) }
  })
  await waitFor(() => document.querySelector("#make").options.length === 2)
  pick(document.querySelector("#make"), "audi")
  await waitFor(() => document.querySelector("#model").options.length === 2)
  const year = document.querySelector("#year")
  assert.deepEqual(optionValues(year), [""], "no model yet, no years yet")

  const before = changes.length
  pick(document.querySelector("#model"), "a3")
  assert.deepEqual(optionValues(year), ["", "2021", "2020", "2019", "2018"])
  assert.equal(year.options[0].textContent, "Year")
  assert.equal(changes.length, before + 1, "one model pick, one announcement")
  assert.deepEqual(changes.at(-1), { make: "audi", model: "a3", year: null })

  pick(year, "2019")
  assert.deepEqual(changes.at(-1), { make: "audi", model: "a3", year: 2019 })
  assert.deepEqual(instance.value, { make: "audi", model: "a3", year: 2019 })
})

test("a model the registers cannot date falls back to a recent range, or to nothing", async () => {
  const document = installDOM(`
    <select id="make-a"></select><select id="model-a"></select><select id="year-a"></select>
    <select id="make-b"></select><select id="model-b"></select><select id="year-b"></select>
  `)
  const base = apiBase("year-fallback")
  global.fetch = async (url) => new URL(url).pathname.endsWith("/models")
    ? jsonResponse({ models: [
      { name: "Q7", slug: "q7", years_on_record: null },
      { name: "Q5", slug: "q5" }, // an older API response: no key at all
      { name: "A3", slug: "a3", years_on_record: { first: 2020, last: 2021 } }
    ] })
    : jsonResponse({ makes: [{ name: "Audi", slug: "audi" }] })

  attach({ key: "fallback-key", apiBase: base, make: "#make-a", model: "#model-a", year: "#year-a", attribution: false })
  const none = attach({
    key: "fallback-key", apiBase: base, make: "#make-b", model: "#model-b", year: "#year-b",
    yearFallback: "none", attribution: false
  })
  await waitFor(() => document.querySelector("#make-a").options.length === 2 && document.querySelector("#make-b").options.length === 2)
  pick(document.querySelector("#make-a"), "audi")
  pick(document.querySelector("#make-b"), "audi")
  await waitFor(() => document.querySelector("#model-a").options.length === 4 && document.querySelector("#model-b").options.length === 4)

  // "range" (the default): the current year down forty, so the field never dead-ends.
  const current = new Date().getFullYear()
  const range = document.querySelector("#year-a")
  for (const model of ["q7", "q5"]) {
    pick(document.querySelector("#model-a"), model)
    assert.equal(range.options.length, 1 + 41, `${model}: placeholder plus ${current}..${current - 40}`)
    assert.equal(range.options[1].value, String(current))
    assert.equal(range.options[41].value, String(current - 40))
    assert.equal(range.disabled, false)
  }

  // "none": only the placeholder, and the field says it has nothing to ask.
  const empty = document.querySelector("#year-b")
  pick(document.querySelector("#model-b"), "q5")
  assert.deepEqual(optionValues(empty), [""])
  assert.equal(empty.disabled, true)
  pick(document.querySelector("#model-b"), "a3")
  assert.deepEqual(optionValues(empty), ["", "2021", "2020"])
  assert.equal(empty.disabled, false, "a dated model re-enables the field")

  pick(document.querySelector("#model-b"), "q7")
  none.destroy()
  instances = instances.filter((candidate) => candidate !== none)
  assert.equal(empty.disabled, false, "destroy hands the host its own disabled state back")
})

test("a make change clears the model and the year before announcing", async () => {
  const document = installDOM(`<select id="make"></select><select id="model"></select><select id="year"></select>`)
  const base = apiBase("year-clear")
  const changes = []
  global.fetch = async (url) => {
    if (url.includes("/audi/models")) {
      return jsonResponse({ models: [{ name: "A3", slug: "a3", years_on_record: { first: 2018, last: 2021 } }] })
    }
    if (url.includes("/bmw/models")) return new Promise(() => {}) // still loading
    return jsonResponse({ makes: [{ name: "Audi", slug: "audi" }, { name: "BMW", slug: "bmw" }] })
  }

  attach({
    key: "year-clear-key", apiBase: base, make: "#make", model: "#model", year: "#year",
    attribution: false, onChange(value) { changes.push(value) }
  })
  await waitFor(() => document.querySelector("#make").options.length === 3)
  pick(document.querySelector("#make"), "audi")
  await waitFor(() => document.querySelector("#model").options.length === 2)
  pick(document.querySelector("#model"), "a3")
  pick(document.querySelector("#year"), "2019")
  assert.deepEqual(changes.at(-1), { make: "audi", model: "a3", year: 2019 })

  pick(document.querySelector("#make"), "bmw")
  // SYNCHRONOUSLY, before BMW's models arrive: an Audi year against a BMW is
  // a wrong answer, not a lag.
  assert.deepEqual(optionValues(document.querySelector("#year")), [""])
  assert.deepEqual(changes.at(-1), { make: "bmw", model: null, year: null })
})

test("a late model list for an older make can never fill the years", async () => {
  const document = installDOM(`<select id="make"></select><select id="model"></select><select id="year"></select>`)
  const base = apiBase("year-stale")
  const resolvers = {}
  global.fetch = async (url) => {
    if (!url.includes("/models")) {
      return jsonResponse({ makes: [{ name: "Audi", slug: "audi" }, { name: "BMW", slug: "bmw" }] })
    }
    return new Promise((resolve) => {
      resolvers[url.includes("/audi/") ? "audi" : "bmw"] = resolve
    })
  }

  attach({ key: "year-stale-key", apiBase: base, make: "#make", model: "#model", year: "#year", attribution: false })
  await waitFor(() => document.querySelector("#make").options.length === 3)
  const make = document.querySelector("#make")
  pick(make, "audi")
  await waitFor(() => resolvers.audi)
  pick(make, "bmw")
  await waitFor(() => resolvers.bmw)

  // The same slug under both makes, with different spans: the only way the
  // years could tell which list filled them.
  resolvers.bmw(jsonResponse({ models: [{ name: "Sport", slug: "sport", years_on_record: { first: 2020, last: 2021 } }] }))
  await waitFor(() => document.querySelector("#model").options.length === 2)
  resolvers.audi(jsonResponse({ models: [{ name: "Sport", slug: "sport", years_on_record: { first: 1990, last: 1992 } }] }))
  await new Promise((resolve) => setTimeout(resolve, 10))

  pick(document.querySelector("#model"), "sport")
  assert.deepEqual(optionValues(document.querySelector("#year")), ["", "2021", "2020"])
})

test("initialYear waits for its intended model and survives a form reset", async () => {
  const document = installDOM(`
    <form id="vehicle">
      <select id="make"></select><select id="model"></select><select id="year"></select>
    </form>
  `)
  const base = apiBase("year-initial")
  const changes = []
  global.fetch = async (url) => new URL(url).pathname.endsWith("/models")
    ? jsonResponse({ models: [
      { name: "A1", slug: "a1", years_on_record: { first: 2010, last: 2024 } },
      { name: "A3", slug: "a3", years_on_record: { first: 2015, last: 2022 } }
    ] })
    : jsonResponse({ makes: [{ name: "Audi", slug: "audi" }] })

  attach({
    key: "year-initial-key", apiBase: base, make: "#make", model: "#model", year: "#year",
    initialMake: "audi", initialModel: "a3", initialYear: 2019, attribution: false,
    onChange(value) { changes.push(value) }
  })
  const year = document.querySelector("#year")
  await waitFor(() => year.value === "2019")
  assert.equal(document.querySelector("#model").value, "a3")
  assert.equal(year.selectedOptions[0].defaultSelected, true, "a form reset must land back here")
  assert.deepEqual(changes.at(-1), { make: "audi", model: "a3", year: 2019 })

  pick(document.querySelector("#model"), "a1")
  assert.equal(year.value, "", "the person is driving now; a new model resets the year")
  pick(year, "2012")

  document.querySelector("#vehicle").reset()
  await waitFor(() => document.querySelector("#model").value === "a3" && year.value === "2019")
})

test("a server-rendered year is reapplied once its model's years fill", async () => {
  const document = installDOM(`
    <select id="make"><option value="audi" selected>Audi</option></select>
    <select id="model"><option value="a3" selected>A3</option></select>
    <select id="year"><option value="2019" selected>2019</option></select>
  `)
  const base = apiBase("year-server")
  global.fetch = async (url) => new URL(url).pathname.endsWith("/models")
    ? jsonResponse({ models: [{ name: "A3", slug: "a3", years_on_record: { first: 2015, last: 2022 } }] })
    : jsonResponse({ makes: [{ name: "Audi", slug: "audi" }] })

  const instance = attach({ key: "year-server-key", apiBase: base, make: "#make", model: "#model", year: "#year", attribution: false })
  await waitFor(() => document.querySelector("#year").options.length === 9)
  assert.deepEqual(instance.value, { make: "audi", model: "a3", year: 2019 })
})

test("Other / not listed reaches the year step and never strands it", async () => {
  const document = installDOM(`<select id="make"></select><select id="model"></select><select id="year"></select>`)
  const base = apiBase("year-other")
  const changes = []
  global.fetch = async (url) => new URL(url).pathname.endsWith("/models")
    ? jsonResponse({ models: [{ name: "A3", slug: "a3", years_on_record: { first: 2020, last: 2021 } }] })
    : jsonResponse({ makes: [{ name: "Audi", slug: "audi" }] })

  attach({
    key: "year-other-key", apiBase: base, make: "#make", model: "#model", year: "#year",
    includeOther: true, attribution: false, onChange(value) { changes.push(value) }
  })
  await waitFor(() => document.querySelector("#make").options.length === 3)
  const make = document.querySelector("#make")
  const model = document.querySelector("#model")
  const year = document.querySelector("#year")
  pick(make, "audi")
  await waitFor(() => model.options.length === 3)
  pick(model, "a3")
  assert.deepEqual(optionValues(year), ["", "2021", "2020", "other"])
  pick(year, "other")
  assert.deepEqual(changes.at(-1), { make: "audi", model: "a3", year: "other" })

  // An unlisted model has no span, so it takes the fallback range — plus Other.
  pick(model, "other")
  assert.equal(year.options[1].value, String(new Date().getFullYear()))
  assert.equal(year.options[year.options.length - 1].value, "other")
  assert.deepEqual(changes.at(-1), { make: "audi", model: "other", year: null })

  pick(make, "other")
  assert.deepEqual(optionValues(model), ["", "other"])
  assert.deepEqual(optionValues(year), [""])
  assert.deepEqual(changes.at(-1), { make: "other", model: null, year: null })
})

test("a widget without a year select keeps the exact {make, model} contract", async () => {
  const document = installDOM(`<select id="make"></select><select id="model"></select><select id="year"></select>`)
  const base = apiBase("year-absent")
  const changes = []
  global.fetch = async (url) => new URL(url).pathname.endsWith("/models")
    ? jsonResponse({ models: [{ name: "A3", slug: "a3", years_on_record: { first: 2020, last: 2021 } }] })
    : jsonResponse({ makes: [{ name: "Audi", slug: "audi" }] })

  const instance = attach({
    key: "year-absent-key", apiBase: base, make: "#make", model: "#model",
    attribution: false, onChange(value) { changes.push(value) }
  })
  await waitFor(() => document.querySelector("#make").options.length === 2)
  pick(document.querySelector("#make"), "audi")
  await waitFor(() => document.querySelector("#model").options.length === 2)
  pick(document.querySelector("#model"), "a3")

  assert.deepEqual(changes.at(-1), { make: "audi", model: "a3" })
  assert.deepEqual(Object.keys(instance.value), ["make", "model"])
  assert.equal(document.querySelector("#year").options.length, 0, "an unconfigured select is never touched")
})

test("attach validates the year select contract synchronously", () => {
  installDOM(`<select id="make"></select><select id="model"></select><select id="year"></select>`)

  assert.throws(() => VehiclesDropdown.attach({ key: "key", make: "#make", year: "#year" }), /needs a model/)
  assert.throws(() => VehiclesDropdown.attach({ key: "key", make: "#make", model: "#model", year: "#model" }), /different <select>/)
  assert.throws(() => VehiclesDropdown.attach({ key: "key", make: "#make", model: "#model", year: "#make" }), /different <select>/)
  assert.throws(() => VehiclesDropdown.attach({ key: "key", make: "#make", model: "#model", year: "#missing" }), /year element not found/)
})

test("initialYear never lands on a make or model it was not meant for", async () => {
  const document = installDOM(`
    <select id="make-a"><option value="volkswagen" selected>Volkswagen</option></select>
    <select id="model-a"></select><select id="year-a"></select>
    <select id="make-b"><option value="volkswagen" selected>Volkswagen</option></select>
    <select id="model-b"></select><select id="year-b"></select>
  `)
  const base = apiBase("year-intended")
  global.fetch = async (url) => {
    if (url.includes("/volkswagen/models")) {
      return jsonResponse({ models: [{ name: "Golf", slug: "golf", years_on_record: { first: 2015, last: 2022 } }] })
    }
    if (url.includes("/audi/models")) {
      return jsonResponse({ models: [{ name: "A3", slug: "a3", years_on_record: { first: 2015, last: 2022 } }] })
    }
    return jsonResponse({ makes: [{ name: "Audi", slug: "audi" }, { name: "Volkswagen", slug: "volkswagen" }] })
  }

  // An initial model and no initial make: the make check passes for any
  // make, so only the model check stands between the Golf and the A3's year.
  attach({
    key: "year-intended-key", apiBase: base, make: "#make-a", model: "#model-a", year: "#year-a",
    initialModel: "a3", initialYear: 2019, attribution: false
  })
  // Without one: a Volkswagen is still not the Audi the year was meant for.
  attach({
    key: "year-intended-key", apiBase: base, make: "#make-b", model: "#model-b", year: "#year-b",
    initialMake: "audi", initialYear: 2019, attribution: false
  })
  await waitFor(() => document.querySelector("#model-a").options.length === 2 && document.querySelector("#model-b").options.length === 2)
  for (const side of ["a", "b"]) {
    pick(document.querySelector(`#model-${side}`), "golf")
    assert.equal(document.querySelector(`#year-${side}`).value, "", `${side}: an Audi's year must never date the host's Golf`)
  }

  for (const side of ["a", "b"]) {
    pick(document.querySelector(`#make-${side}`), "audi")
    await waitFor(() => Array.from(document.querySelector(`#model-${side}`).options).some((option) => option.value === "a3"))
    pick(document.querySelector(`#model-${side}`), "a3")
    assert.equal(document.querySelector(`#year-${side}`).value, "2019", `${side}: the intended A3 gets its year`)
  }
})

test("malformed spans take the fallback instead of rendering nonsense", async () => {
  const document = installDOM(`<select id="make"></select><select id="model"></select><select id="year"></select>`)
  const base = apiBase("year-malformed")
  const current = new Date().getFullYear()
  const spans = {
    ancient: { first: -8000, last: 2026 },
    zero: { first: 0, last: 0 },
    future: { first: 2020, last: 2099 },
    reversed: { first: 2022, last: 2015 },
    strings: { first: "2010", last: "2020" },
    // Last on purpose: 1e300 passes Number.isInteger and 1e300 - 1 === 1e300,
    // so the old countdown never finished.
    endless: { first: 2020, last: 1e300 }
  }
  global.fetch = async (url) => new URL(url).pathname.endsWith("/models")
    ? jsonResponse({ models: [
      ...Object.entries(spans).map(([slug, span]) => ({ name: slug, slug, years_on_record: span })),
      { name: "edges", slug: "edges", years_on_record: { first: 1886, last: current + 1 } }
    ] })
    : jsonResponse({ makes: [{ name: "Audi", slug: "audi" }] })

  attach({ key: "year-malformed-key", apiBase: base, make: "#make", model: "#model", year: "#year", attribution: false })
  await waitFor(() => document.querySelector("#make").options.length === 2)
  pick(document.querySelector("#make"), "audi")
  await waitFor(() => document.querySelector("#model").options.length === 8)
  const year = document.querySelector("#year")

  for (const slug of Object.keys(spans)) {
    pick(document.querySelector("#model"), slug)
    assert.equal(year.options.length, 1 + 41, `${slug}: the fallback range, not the payload`)
    assert.equal(year.options[1].value, String(current))
  }

  // The widest span the bounds admit stays a bounded list.
  pick(document.querySelector("#model"), "edges")
  assert.equal(year.options[1].value, String(current + 1))
  assert.equal(year.options[year.options.length - 1].value, "1886")
  assert.ok(year.options.length < 150)
})

test("a saved year outside the model's span is kept, in its place, and announced", async () => {
  const document = installDOM(`
    <select id="make-a"><option value="audi" selected>Audi</option></select>
    <select id="model-a"><option value="a3" selected>A3</option></select>
    <select id="year-a"><option value="2024" selected>2024</option></select>
    <select id="make-b"></select><select id="model-b"></select><select id="year-b"></select>
  `)
  const base = apiBase("year-kept")
  global.fetch = async (url) => new URL(url).pathname.endsWith("/models")
    ? jsonResponse({ models: [{ name: "A3", slug: "a3", years_on_record: { first: 2015, last: 2022 } }] })
    : jsonResponse({ makes: [{ name: "Audi", slug: "audi" }] })
  const warnings = []
  const originalWarn = console.warn
  console.warn = (...parts) => warnings.push(parts.join(" "))
  try {
    // An edit form: the register span ends in 2022, the customer's car is a 2024.
    const edit = attach({ key: "year-kept-key", apiBase: base, make: "#make-a", model: "#model-a", year: "#year-a", attribution: false })
    // A configured initial year older than the span, with Other enabled.
    attach({
      key: "year-kept-key", apiBase: base, make: "#make-b", model: "#model-b", year: "#year-b",
      initialMake: "audi", initialModel: "a3", initialYear: 2010, includeOther: true, attribution: false
    })
    await waitFor(() => document.querySelector("#year-a").options.length === 10 && document.querySelector("#year-b").value === "2010")

    assert.deepEqual(optionValues(document.querySelector("#year-a")),
      ["", "2024", "2022", "2021", "2020", "2019", "2018", "2017", "2016", "2015"])
    assert.deepEqual(edit.value, { make: "audi", model: "a3", year: 2024 })
    assert.deepEqual(optionValues(document.querySelector("#year-b")).slice(-3), ["2015", "2010", "other"])
  } finally {
    console.warn = originalWarn
  }
  assert.equal(warnings.filter((line) => line.includes("2024")).length, 1, "the kept year should be named, once")
  assert.equal(warnings.filter((line) => line.includes("2010")).length, 1)
})

test("the host owns disabled; the widget only ever undoes its own", async () => {
  const document = installDOM(`
    <select id="make-a"></select><select id="model-a"></select><select id="year-a" disabled></select>
    <select id="make-b"></select><select id="model-b"></select><select id="year-b"></select>
    <select id="make-c"></select><select id="model-c"></select><select id="year-c"></select>
    <select id="make-d"></select><select id="model-d"></select><select id="year-d"></select>
  `)
  const base = apiBase("year-disabled")
  global.fetch = async (url) => new URL(url).pathname.endsWith("/models")
    ? jsonResponse({ models: [
      { name: "A1", slug: "a1", years_on_record: { first: 2010, last: 2024 } },
      { name: "A3", slug: "a3", years_on_record: { first: 2015, last: 2022 } },
      { name: "Q7", slug: "q7", years_on_record: null }
    ] })
    : jsonResponse({ makes: [{ name: "Audi", slug: "audi" }] })
  const options = (side, extra) => Object.assign({
    key: "year-disabled-key", apiBase: base, make: `#make-${side}`, model: `#model-${side}`,
    year: `#year-${side}`, attribution: false
  }, extra)

  // a: disabled by the host at attach time, enabled by the host after a pick.
  attach(options("a", { initialMake: "audi", initialModel: "a3", initialYear: 2019 }))
  // b: enabled at attach time, disabled by the host afterwards.
  const b = attach(options("b"))
  // c: disabled by the widget itself ("none", nothing to choose).
  const c = attach(options("c", { yearFallback: "none" }))
  // d: "none" with Other enabled — Other is a choice, so the field stays usable.
  attach(options("d", { yearFallback: "none", includeOther: true }))
  const year = (side) => document.querySelector(`#year-${side}`)

  await waitFor(() => year("a").value === "2019", "initialYear applies to a host-disabled field")
  assert.equal(year("a").disabled, true, "the host's disabled is left alone")
  year("a").disabled = false
  pick(document.querySelector("#model-a"), "a1")
  assert.equal(year("a").disabled, false, "a host enable survives the next refill")

  for (const side of ["b", "c", "d"]) pick(document.querySelector(`#make-${side}`), "audi")
  await waitFor(() => ["b", "c", "d"].every((side) => document.querySelector(`#model-${side}`).options.length >= 4))

  year("b").disabled = true
  pick(document.querySelector("#model-b"), "a3")
  assert.equal(year("b").disabled, true, "a host disable survives the next refill")
  b.destroy()
  assert.equal(year("b").disabled, true, "destroy never re-enables what the host disabled")

  pick(document.querySelector("#model-c"), "q7")
  assert.equal(year("c").disabled, true)
  c.destroy()
  instances = instances.filter((candidate) => candidate !== b && candidate !== c)
  assert.equal(year("c").disabled, false, "destroy undoes the widget's own disabling")

  pick(document.querySelector("#model-d"), "q7")
  assert.deepEqual(optionValues(year("d")), ["", "other"])
  assert.equal(year("d").disabled, false, "Other must stay choosable")
})

test("the previous make's models never date a model during the next make's fetch", async () => {
  const document = installDOM(`<select id="make"></select><select id="model"></select><select id="year"></select>`)
  const base = apiBase("year-between")
  global.fetch = async (url) => {
    if (url.includes("/audi/models")) {
      return jsonResponse({ models: [{ name: "A3", slug: "a3", years_on_record: { first: 2018, last: 2021 } }] })
    }
    if (url.includes("/bmw/models")) return new Promise(() => {}) // still loading
    return jsonResponse({ makes: [{ name: "Audi", slug: "audi" }, { name: "BMW", slug: "bmw" }] })
  }

  attach({ key: "year-between-key", apiBase: base, make: "#make", model: "#model", year: "#year", attribution: false })
  await waitFor(() => document.querySelector("#make").options.length === 3)
  pick(document.querySelector("#make"), "audi")
  await waitFor(() => document.querySelector("#model").options.length === 2)
  pick(document.querySelector("#make"), "bmw")

  // Host code injecting an option mid-fetch (an edit form restoring its
  // saved model, say) must not be dated from Audi's list.
  const model = document.querySelector("#model")
  model.add(new Option("A3", "a3"))
  pick(model, "a3")
  assert.equal(document.querySelector("#year").options[1].value, String(new Date().getFullYear()))
})
