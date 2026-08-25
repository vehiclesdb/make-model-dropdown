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

  assert.equal(browser.window.VehiclesDropdown.version, "0.1.4")
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
