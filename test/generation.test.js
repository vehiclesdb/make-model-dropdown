// 0.6.0: the optional generation step (API mode, plans with full records).
// Every test runs the widget in a fresh page (a JSDOM window with the
// source evaluated in it), because the plan notice is once per page and the
// request caches are per page.
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const { test } = require("node:test")
const { JSDOM, VirtualConsole } = require("jsdom")

const ROOT = path.join(__dirname, "..")
const SOURCE = fs.readFileSync(path.join(ROOT, "make-model-dropdown.js"), "utf8")
const MIN = fs.readFileSync(path.join(ROOT, "make-model-dropdown.min.js"), "utf8")
const pkg = require("../package.json")
const API = "https://vehiclesdb.com/api/v1"

const MAKES = { makes: [ { name: "Audi", slug: "audi" }, { name: "SEAT", slug: "seat" } ] }
const AUDI = { models: [
  { name: "A3", slug: "a3", kind: "car", years_on_record: { first: 1996, last: 2025 } },
  { name: "Q7", slug: "q7", kind: "car" },
  { name: "A4", slug: "a4", kind: "car" }
] }
const SEAT = { models: [ { name: "Ibiza", slug: "ibiza", kind: "car" } ] }
// The API's own example rows, plus every shape of unknown year.
const A3_GENERATIONS = { generations: [
  { id: "a3-8l", name: "8L", years: { start: 1996, end: 2003 }, ended: true },
  { id: "a3-8p", name: "8P", years: { start: 2003, end: 2013 }, ended: true },
  { id: "a3-8v", name: "8V", years: { start: 2012, end: 2020 }, ended: true },
  { id: "a3-8y", name: "8Y", years: { start: 2020, end: null }, ended: false }
], count: 4, dataset_version: "2026.11.12" }
const Q7_GENERATIONS = { generations: [
  { id: "q7-4l", name: "4L", years: { start: 2005, end: null }, ended: true },
  { id: "q7-x", name: "Prototype", years: { start: null, end: 2004 }, ended: true },
  { id: "q7-y", name: "Unknown", years: { start: null, end: null }, ended: true }
], count: 3, dataset_version: "2026.11.12" }
const PLAN_REQUIRED = { error: "plan_required", feature: "generations", available: 4,
  message: "Generations are part of the full records your plan does not include.",
  upgrade_url: "https://vehiclesdb.example/pricing" }

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
}

// The API, with the generations answer per model slug: a body (200), a
// [status, body] pair, an Error (network failure), or a promise.
function api(generations = {}) {
  return (url) => {
    const path = url.replace(API, "").split("?")[0]
    if (path === "/makes") return json(MAKES)
    if (path === "/makes/audi/models") return json(AUDI)
    if (path === "/makes/seat/models") return json(SEAT)
    const match = /^\/makes\/(\w+)\/models\/([\w-]+)\/generations$/.exec(path)
    if (match) {
      const answer = generations[match[2]] ?? { generations: [], count: 0 }
      if (answer instanceof Error) throw answer
      if (typeof answer.then === "function") return answer
      if (Array.isArray(answer)) return json(answer[1], answer[0])
      return json(answer)
    }
    return json({ error: "not_found" }, 404)
  }
}

function page(body, { routes = api(), script = SOURCE } = {}) {
  const virtualConsole = new VirtualConsole()
  const infos = [], warns = [], errors = []
  virtualConsole.on("info", (...args) => infos.push(args.join(" ")))
  virtualConsole.on("warn", (...args) => warns.push(args.join(" ")))
  virtualConsole.on("error", (...args) => errors.push(args.join(" ")))
  const { window } = new JSDOM(`<!doctype html><html><body>${body}</body></html>`,
    { url: "https://host.test", runScripts: "outside-only", virtualConsole })
  const calls = []
  window.fetch = async (url, init) => { calls.push({ url, auth: init?.headers?.Authorization }); return routes(url) }
  window.eval(script)
  const doc = window.document
  const VD = window.VehiclesDropdown
  const generationCalls = () => calls.filter((call) => call.url.includes("/generations"))
  const pick = (selector, value) => {
    const select = doc.querySelector(selector)
    select.value = value
    select.dispatchEvent(new window.Event("change", { bubbles: true }))
  }
  return { window, doc, VD, calls, generationCalls, infos, warns, errors, pick }
}

async function waitFor(predicate, message = "condition") {
  const deadline = Date.now() + 1500
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  assert.fail(`Timed out waiting for ${message}`)
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 30))

const FORM = `<form id="f">
  <label for="make">Make</label><select id="make" name="make"></select>
  <label for="model">Model</label><select id="model" name="model"></select>
  <label for="year">Year</label><select id="year" name="year"></select>
  <label for="generation">Generation</label><select id="generation" name="generation" required></select>
  <input id="vid" name="vid" type="hidden">
</form>`

// Values built in the page's realm, compared as plain data.
const plain = (value) => JSON.parse(JSON.stringify(value))

function labels(doc, selector) {
  return Array.from(doc.querySelectorAll(selector)).map((option) => option.text)
}

function hiddenState(doc) {
  const select = doc.querySelector("#generation")
  return { select: select.hidden, label: doc.querySelector('label[for="generation"]').hidden,
    disabled: select.disabled, required: select.required }
}

async function attached(p, options = {}) {
  const changes = []
  const instance = p.VD.attach(Object.assign({ key: `vdb_pk_${Math.random()}`, make: "#make", model: "#model",
    generation: "#generation", onChange: (value) => changes.push(value) }, options))
  await waitFor(() => p.doc.querySelector("#make").options.length > 1, "makes")
  return { instance, changes }
}

async function chooseModel(p, make, model) {
  p.pick("#make", make)
  await waitFor(() => p.doc.querySelector("#model").options.length > 1, "models")
  p.pick("#model", model)
}

// ---- 200 with rows ------------------------------------------------------------
test("a model with generations fills and shows the step: labels, ids, kind and the key", async () => {
  const p = page(FORM, { routes: api({ a3: A3_GENERATIONS, q7: Q7_GENERATIONS }) })
  const { instance } = await attached(p, { key: "vdb_pk_one" })
  assert.deepEqual(hiddenState(p.doc), { select: true, label: true, disabled: true, required: false },
    "hidden, disabled and not required before a model is chosen")

  await chooseModel(p, "audi", "a3")
  await waitFor(() => p.doc.querySelector("#generation").options.length === 5, "generations")
  assert.deepEqual(labels(p.doc, "#generation option"),
    [ "Generation", "8L (1996–2003)", "8P (2003–2013)", "8V (2012–2020)", "8Y (2020–)" ])
  assert.deepEqual(Array.from(p.doc.querySelectorAll("#generation option")).map((o) => o.value),
    [ "", "a3-8l", "a3-8p", "a3-8v", "a3-8y" ])
  assert.deepEqual(hiddenState(p.doc), { select: false, label: false, disabled: false, required: true },
    "shown, enabled, and the page's own `required` is back")
  const call = p.generationCalls()[0]
  assert.equal(call.url, `${API}/makes/audi/models/a3/generations?kind=car`, "kind from the chosen model")
  assert.equal(call.auth, "Bearer vdb_pk_one")

  // Unknown years are left out, never invented; an ended generation with no
  // sourced last year is not shown as still in production.
  p.pick("#model", "q7")
  await waitFor(() => p.doc.querySelector("#generation").options.length === 4, "q7 generations")
  assert.deepEqual(labels(p.doc, "#generation option"), [ "Generation", "4L (2005–?)", "Prototype (–2004)", "Unknown" ])
  instance.destroy()
  p.window.close()
})

test("the instance's kind goes in the request, and values: \"name\" puts names in the options", async () => {
  const p = page(FORM, { routes: api({ a3: A3_GENERATIONS }) })
  await attached(p, { kind: "car", values: "name" })
  p.pick("#make", "Audi")
  await waitFor(() => p.doc.querySelector("#model").options.length > 1, "models")
  p.pick("#model", "A3")
  await waitFor(() => p.doc.querySelector("#generation").options.length === 5, "generations")
  assert.match(p.generationCalls()[0].url, /\/makes\/audi\/models\/a3\/generations\?kind=car$/, "slugs in the URL, not names")
  assert.deepEqual(Array.from(p.doc.querySelectorAll("#generation option")).map((o) => o.value),
    [ "", "8L", "8P", "8V", "8Y" ])
  p.window.close()
})

test("value, onChange and the change event carry the generation; the id field stays the model's", async () => {
  const p = page(FORM, { routes: api({ a3: A3_GENERATIONS }) })
  const events = []
  p.doc.addEventListener("make-model-dropdown:change", (event) => events.push(event.detail))
  const { instance, changes } = await attached(p, { idInput: "#vid" })
  assert.equal(instance.value.generation, null, "the key exists with a generation select, null when none")
  await chooseModel(p, "audi", "a3")
  await waitFor(() => p.doc.querySelector("#generation").options.length === 5, "generations")
  p.pick("#generation", "a3-8p")
  const expected = { id: "a3-8p", name: "8P", years: { start: 2003, end: 2013 } }
  assert.deepEqual(plain(instance.value), { make: "audi", model: "a3", generation: expected, id: "car/audi/a3" })
  assert.deepEqual(plain(changes.at(-1).generation), expected)
  assert.deepEqual(plain(events.at(-1).generation), expected)
  assert.equal(p.doc.querySelector("#vid").value, "car/audi/a3", "no composite id")
  // Picking another model clears the generation before announcing.
  p.pick("#model", "a4")
  assert.equal(changes.at(-1).model, "a4")
  assert.equal(changes.at(-1).generation, null)
  // Without a generation select, the payload keeps its old shape.
  const q = page(`<select id="make"></select><select id="model"></select>`)
  const bare = q.VD.attach({ key: "vdb_pk_x", make: "#make", model: "#model" })
  assert.deepEqual(Object.keys(bare.value), [ "make", "model" ])
  p.window.close(); q.window.close()
})

// ---- hidden: empty, 403, 404, network, dataset ---------------------------------
for (const [ name, answer ] of [
  [ "an empty list", { generations: [], count: 0 } ],
  [ "a 404", [ 404, { error: "not_found", message: "Nothing here" } ] ],
  [ "a network error", new TypeError("Failed to fetch") ],
  [ "a malformed body", { generations: [ { name: 3 } ] } ]
]) {
  test(`${name} hides and disables the step, tells the visitor nothing, and the form still submits`, async () => {
    const p = page(FORM, { routes: api({ a3: answer }) })
    const errors = []
    const { instance } = await attached(p, { onError: (error) => errors.push(error) })
    await chooseModel(p, "audi", "a3")
    await waitFor(() => p.generationCalls().length === 1, "the request")
    await tick()
    assert.deepEqual(hiddenState(p.doc), { select: true, label: true, disabled: true, required: false })
    assert.equal(instance.value.generation, null)
    assert.deepEqual(errors, [], "onError is for the picker's own data, not the optional step")
    assert.deepEqual(p.infos, [])
    assert.doesNotMatch(p.doc.body.textContent, /error|plan|upgrade|could not/i)
    const form = p.doc.querySelector("#f")
    assert.equal(form.checkValidity(), true, "a hidden step is never required")
    const data = new p.window.FormData(form)
    assert.equal(data.get("model"), "a3")
    assert.equal(data.has("generation"), false)
    p.window.close()
  })
}

test("403 plan_required: hidden, ONE console.info per page with the upgrade URL, no more requests", async () => {
  const p = page(FORM + `<select id="make2"></select><select id="model2"></select><select id="gen2"></select>`,
    { routes: api({ a3: [ 403, PLAN_REQUIRED ], a4: [ 403, PLAN_REQUIRED ] }) })
  const errors = []
  await attached(p, { key: "vdb_pk_free", onError: (error) => errors.push(error) })
  await chooseModel(p, "audi", "a3")
  await waitFor(() => p.infos.length === 1, "the notice")
  assert.match(p.infos[0], /generation step is hidden/)
  assert.match(p.infos[0], /plan does not include/)
  assert.match(p.infos[0], /https:\/\/vehiclesdb\.example\/pricing/, "the response's upgrade_url")
  assert.deepEqual(hiddenState(p.doc), { select: true, label: true, disabled: true, required: false })
  assert.deepEqual(errors, [])
  assert.deepEqual(p.warns, [])

  p.pick("#model", "a4")
  await tick()
  assert.equal(p.generationCalls().length, 1, "the plan answered for this key; no request per model")
  // A second picker on the same page and key: no second notice.
  p.VD.attach({ key: "vdb_pk_free", make: "#make2", model: "#model2", generation: "#gen2" })
  await tick()
  assert.equal(p.infos.length, 1, "once per page")
  assert.equal(p.doc.querySelector("#f").checkValidity(), true)
  p.window.close()
})

test("dataset mode and `data` never ask for generations and keep the step hidden", async () => {
  const dataset = { version: "2026.11.12", makes: [ { name: "Audi", slug: "audi", models: [ { name: "A3", slug: "a3", kind: "car" } ] } ] }
  for (const options of [ { source: "dataset" }, { data: dataset } ]) {
    const p = page(FORM, { routes: () => json(dataset) })
    p.VD.attach(Object.assign({ make: "#make", model: "#model", generation: "#generation" }, options))
    await waitFor(() => p.doc.querySelector("#make").options.length > 1, "makes")
    await chooseModel(p, "audi", "a3")
    await tick()
    assert.equal(p.generationCalls().length, 0)
    assert.deepEqual(hiddenState(p.doc), { select: true, label: true, disabled: true, required: false })
    assert.deepEqual(p.infos, [])
    p.window.close()
  }
})

test("Other and a kept model hide the step with no request", async () => {
  const p = page(FORM, { routes: api({ a3: A3_GENERATIONS }) })
  await attached(p, { includeOther: true, initialMake: "audi", initialModel: "A3 Sportback Legacy" })
  await waitFor(() => p.doc.querySelector("#model").value === "A3 Sportback Legacy", "kept model")
  p.pick("#model", "other")
  await tick()
  assert.equal(p.generationCalls().length, 0)
  assert.equal(hiddenState(p.doc).select, true)
  p.window.close()
})

test("a step already on screen stays put while the next model loads, and a stale answer is dropped", async () => {
  let release
  const slow = new Promise((resolve) => { release = resolve })
  const p = page(FORM, { routes: api({ a3: A3_GENERATIONS, q7: slow.then(() => json(Q7_GENERATIONS)), a4: { generations: [] } }) })
  await attached(p)
  await chooseModel(p, "audi", "a3")
  await waitFor(() => p.doc.querySelector("#generation").options.length === 5, "a3")
  p.pick("#model", "q7")
  assert.equal(p.doc.querySelector("#generation").hidden, false, "no flicker between two models")
  assert.equal(p.doc.querySelector("#generation").disabled, true, "but not choosable until its list lands")
  p.pick("#model", "a4")
  await tick()
  release()
  await tick()
  assert.equal(p.doc.querySelector("#generation").options.length, 1, "the Q7 answer never fills the A4's step")
  assert.equal(p.doc.querySelector("#generation").hidden, true)
  p.window.close()
})

// ---- year and generation ------------------------------------------------------
test("year first preselects the one generation that holds it; ambiguous years and a visitor's pick are left alone", async () => {
  const p = page(FORM, { routes: api({ a3: A3_GENERATIONS }) })
  const { instance } = await attached(p, { year: "#year" })
  await chooseModel(p, "audi", "a3")
  await waitFor(() => p.doc.querySelector("#generation").options.length === 5, "generations")

  p.pick("#year", "2016")
  assert.equal(p.doc.querySelector("#generation").value, "a3-8v", "2016 is only 8V")
  assert.equal(instance.value.generation.id, "a3-8v", "announced with the year")
  p.pick("#year", "2022")
  assert.equal(p.doc.querySelector("#generation").value, "a3-8y", "a preselection follows the year; open end = current")
  p.pick("#year", "2003")
  assert.equal(p.doc.querySelector("#generation").value, "", "2003 is 8L and 8P: no guess")
  p.pick("#year", "2016")
  assert.equal(p.doc.querySelector("#generation").value, "a3-8v")

  // Still changeable, and once the visitor picks, the year never moves it.
  p.pick("#generation", "a3-8p")
  p.pick("#year", "2022")
  assert.equal(p.doc.querySelector("#generation").value, "a3-8p")
  assert.deepEqual({ year: instance.value.year, gen: instance.value.generation.id }, { year: 2022, gen: "a3-8p" })

  // Generation first: the year is not touched.
  p.pick("#model", "a4")
  p.pick("#model", "a3")
  await waitFor(() => p.doc.querySelector("#generation").options.length === 5, "generations again")
  p.pick("#generation", "a3-8l")
  assert.equal(p.doc.querySelector("#year").value, "")
  p.window.close()
})

test("an ended generation with no sourced last year is a maybe, never a match", async () => {
  const p = page(FORM, { routes: api({ q7: { generations: [
    { id: "a", name: "A", years: { start: 2005, end: null }, ended: true },
    { id: "b", name: "B", years: { start: 2015, end: 2020 }, ended: true }
  ] } }) })
  await attached(p, { year: "#year" })
  await chooseModel(p, "audi", "q7")
  await waitFor(() => p.doc.querySelector("#generation").options.length === 3, "generations")
  p.pick("#year", "2016")
  assert.equal(p.doc.querySelector("#generation").value, "", "A might still cover 2016")
  p.pick("#year", "2010")
  assert.equal(p.doc.querySelector("#generation").value, "", "A's end is unknown, so not a sure match")
  p.window.close()
})

test("a year chosen while the list loads still preselects when it lands", async () => {
  let release
  const slow = new Promise((resolve) => { release = resolve })
  const p = page(FORM, { routes: api({ a3: slow.then(() => json(A3_GENERATIONS)) }) })
  await attached(p, { year: "#year" })
  await chooseModel(p, "audi", "a3")
  p.pick("#year", "2016")
  release()
  await waitFor(() => p.doc.querySelector("#generation").options.length === 5, "generations")
  assert.equal(p.doc.querySelector("#generation").value, "a3-8v")
  p.window.close()
})

// ---- stored values --------------------------------------------------------------
test("initialGeneration and setValue restore a generation by id or name; an unknown one is kept as given", async () => {
  const p = page(FORM, { routes: api({ a3: A3_GENERATIONS }) })
  const { instance } = await attached(p, { initialMake: "audi", initialModel: "a3", initialGeneration: "a3-8p", year: "#year", initialYear: 2016 })
  await waitFor(() => p.doc.querySelector("#generation").value === "a3-8p", "initial generation")
  assert.equal(p.doc.querySelector("#generation").options[2].defaultSelected, true, "a form reset restores it")
  assert.equal(instance.value.generation.id, "a3-8p", "the stored generation wins over the year's match")

  await instance.setValue({ make: "audi", model: "a3", generation: "8Y" })
  assert.equal(p.doc.querySelector("#generation").value, "a3-8y", "by name")
  assert.equal(instance.value.generation.name, "8Y")

  await instance.setValue({ make: "audi", model: "a3", generation: "a3-legacy" })
  assert.equal(p.doc.querySelector("#generation").value, "a3-legacy", "never blanked")
  assert.deepEqual(plain(instance.value.generation), { id: "a3-legacy", name: null, years: null })
  assert.ok(p.warns.length === 0)
  p.window.close()
})

test("a server-rendered generation is read as the initial one", async () => {
  const body = FORM.replace(`<select id="generation" name="generation" required></select>`,
    `<select id="generation" name="generation"><option value="a3-8v" selected>8V</option></select>`)
  const p = page(body, { routes: api({ a3: A3_GENERATIONS }) })
  await attached(p, { initialMake: "audi", initialModel: "a3" })
  await waitFor(() => p.doc.querySelector("#generation").options.length === 5, "generations")
  assert.equal(p.doc.querySelector("#generation").value, "a3-8v")
  p.window.close()
})

test("the widget only undoes its own hiding and disabling; destroy restores the page's state", async () => {
  const body = `<form>
    <select id="make"></select><select id="model"></select>
    <div data-vdb-field="generation" id="wrap"><label>Gen <select id="generation" required></select></label></div>
    <label for="generation" id="other" hidden>Already hidden by the page</label>
  </form>`
  const p = page(body, { routes: api({ a3: A3_GENERATIONS }) })
  const { instance } = await attached(p)
  const wrap = p.doc.querySelector("#wrap")
  const wrapping = p.doc.querySelector("#wrap label")
  assert.equal(wrap.hidden, true, "a marked wrapper hides with the step")
  assert.equal(wrapping.hidden, true, "and a <label> around the select")
  await chooseModel(p, "audi", "a3")
  await waitFor(() => p.doc.querySelector("#generation").options.length === 5, "generations")
  assert.equal(wrap.hidden, false)
  assert.equal(p.doc.querySelector("#other").hidden, true, "the page's own hidden label stays hidden")
  p.pick("#model", "a4")
  await tick()
  assert.equal(wrap.hidden, true)
  instance.destroy()
  const select = p.doc.querySelector("#generation")
  assert.deepEqual([ wrap.hidden, select.hidden, select.disabled, select.required, p.doc.querySelector("#other").hidden ],
    [ false, false, false, true, true ])

  // A select the page disabled itself stays disabled when shown.
  const q = page(FORM.replace(`required></select>`, `disabled></select>`), { routes: api({ a3: A3_GENERATIONS }) })
  await attached(q)
  await chooseModel(q, "audi", "a3")
  await waitFor(() => q.doc.querySelector("#generation").options.length === 5, "generations")
  assert.equal(q.doc.querySelector("#generation").disabled, true)
  p.window.close(); q.window.close()
})

test("generation needs a model, and its own select", () => {
  const p = page(FORM)
  assert.throws(() => p.VD.attach({ key: "k", make: "#make", generation: "#generation" }), /generation needs a model/)
  assert.throws(() => p.VD.attach({ key: "k", make: "#make", model: "#model", generation: "#model" }), /different <select>/)
  p.window.close()
})

// ---- one tag ----------------------------------------------------------------------
test("data-generation builds a hidden field that shows for a model with generations", async () => {
  const p = page(`<form><div id="p" data-vehiclesdb-picker data-key="vdb_pk_tag" data-kind="car" data-year
    data-generation data-required data-name-generation="car_generation"></div></form>`,
  { routes: api({ a3: A3_GENERATIONS }) })
  const root = p.doc.querySelector("#p")
  const field = root.querySelector('.vdb-field[data-vdb-field="generation"]')
  const select = field.querySelector("select[data-generation]")
  assert.equal(field.hidden, true, "wrapper hidden from the start")
  assert.equal(field.querySelector("label").textContent, "Generation")
  assert.equal(select.name, "car_generation")
  assert.equal(select.required, false)
  assert.equal(root.lastElementChild.className, "vdb-attribution", "the credit still closes the picker")
  await waitFor(() => root.querySelector("select[data-make]").options.length > 1, "makes")
  p.pick("#p select[data-make]", "audi")
  await waitFor(() => root.querySelector("select[data-model]").options.length > 1, "models")
  p.pick("#p select[data-model]", "a3")
  await waitFor(() => select.options.length === 5, "generations")
  assert.deepEqual([ field.hidden, select.hidden, select.disabled, select.required ], [ false, false, false, true ])
  assert.equal(p.generationCalls()[0].url, `${API}/makes/audi/models/a3/generations?kind=car`)
  p.window.close()
})

test("keyless one tag with data-generation stays hidden; existing marked selects are used", async () => {
  const dataset = { version: "2026.11.12", makes: [ { name: "Audi", slug: "audi", models: [ { name: "A3", slug: "a3", kind: "car" } ] } ] }
  const p = page(`<div id="p" data-vehiclesdb-picker data-generation></div>
    <div id="q" data-vehiclesdb-picker data-key="vdb_pk_q"><select data-make></select><select data-model></select>
      <label for="g">G</label><select id="g" data-generation></select></div>`,
  { routes: (url) => url.includes("jsdelivr") ? json(dataset) : api({ a3: A3_GENERATIONS })(url) })
  const keyless = p.doc.querySelector('#p [data-vdb-field="generation"]')
  assert.equal(keyless.hidden, true)
  assert.equal(p.doc.querySelector('label[for="g"]').hidden, true)
  await waitFor(() => p.doc.querySelector("#q select[data-make]").options.length > 1, "makes")
  p.pick("#q select[data-make]", "audi")
  await waitFor(() => p.doc.querySelector("#q select[data-model]").options.length > 1, "models")
  p.pick("#q select[data-model]", "a3")
  await waitFor(() => p.doc.querySelector("#g").options.length === 5, "generations")
  assert.equal(p.doc.querySelector('label[for="g"]').hidden, false)
  await waitFor(() => p.doc.querySelector("#p select[data-make]").options.length > 1, "dataset makes")
  p.pick("#p select[data-make]", "audi")
  await waitFor(() => p.doc.querySelector("#p select[data-model]").options.length > 1, "dataset models")
  p.pick("#p select[data-model]", "a3")
  await tick()
  assert.equal(keyless.hidden, true)
  assert.equal(p.generationCalls().length, 1, "only the keyed picker asked")
  p.window.close()
})

test("every locale words the generation placeholder, and data-placeholder-generation wins", () => {
  const expected = { en: "Generation", es: "Generación", de: "Generation", fr: "Génération",
    it: "Generazione", pt: "Geração", pl: "Generacja", nl: "Generatie" }
  const body = Object.keys(expected).map((locale) =>
    `<div data-vehiclesdb-picker data-locale="${locale}" data-generation></div>`).join("") +
    `<div id="own" data-vehiclesdb-picker data-generation data-placeholder-generation="Série"></div>`
  const p = page(body, { routes: () => new Promise(() => {}) })
  const pickers = p.doc.querySelectorAll("[data-vehiclesdb-picker]")
  Object.values(expected).forEach((word, index) => {
    const field = pickers[index].querySelector('[data-vdb-field="generation"]')
    assert.equal(field.querySelector("label").textContent, word)
  })
  assert.equal(p.doc.querySelector('#own [data-vdb-field="generation"] label').textContent, "Série")
  p.window.close()
})

// ---- builds ---------------------------------------------------------------------
test("the minified build runs the generation step; both builds say 0.6.0", async () => {
  const p = page(FORM, { routes: api({ a3: A3_GENERATIONS }), script: MIN })
  assert.equal(p.VD.version, "0.6.0")
  assert.equal(pkg.version, "0.6.0")
  await attached(p)
  await chooseModel(p, "audi", "a3")
  await waitFor(() => p.doc.querySelector("#generation").options.length === 5, "generations")
  assert.equal(p.doc.querySelector("#generation").options[4].text, "8Y (2020–)")
  const esm = await import("../make-model-dropdown.mjs")
  assert.equal(esm.version, "0.6.0")
  assert.ok(fs.readFileSync(path.join(ROOT, "make-model-dropdown.mjs"), "utf8").includes("loadGenerations"))
  p.window.close()
})
