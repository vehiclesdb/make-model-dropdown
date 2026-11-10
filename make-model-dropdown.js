/*!
 * VehiclesDropdown — the car make and model dropdown.
 * https://vehiclesdb.com/make-and-model-dropdown
 *
 * A dependent make → model picker for any web page, powered by the VehiclesDB
 * API or by the open VehiclesDB dataset file (no key): 14,000+ models across
 * 850+ makes (cars, motorcycles, mopeds, vans, trucks, buses), reconciled from
 * official national vehicle registers. An optional third step picks the model
 * year.
 *
 * Zero dependencies. No build step. MIT licensed.
 * Data: CC-BY 4.0 (identity layer) — the widget renders attribution for you.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory()
  else root.VehiclesDropdown = factory()
})(globalThis, function () {
  "use strict"

  const DEFAULTS = {
    source: "api",         // "api" (publishable key) | "dataset" (the open dataset file, no key)
    apiBase: "https://vehiclesdb.com/api/v1",
    version: "latest",     // dataset mode: the release to read, e.g. "2026.11.2"
    datasetUrl: null,      // dataset mode: your own copy of dist/vehicles.json
    data: null,            // dataset mode: an already-parsed vehicles.json (or a subset in its shape)
    kind: null,            // "car" | "motorcycle" | "moped" | "van" | "truck" | "bus"
    country: null,         // two-letter code, e.g. "de"
    order: "popular",      // "popular" | "alphabetical" (models)
    topMakes: null,        // e.g. 40 — only the N most-registered makes, best first
    initialMake: null,     // slug (or name) preselected on load, e.g. "audi"
    initialModel: null,    // slug (or name) preselected once its make's models load
    initialYear: null,     // e.g. 2019 — preselected once its model's years fill
    yearFallback: "range", // a model with no register span: "range" | "none"
    values: "slug",        // what option values hold: "slug" | "name"
    includeOther: false,   // append an "Other / not listed" escape hatch
    otherLabel: "Other / not listed", // its text
    otherValue: "other",   // its option value
    keepUnknown: true,     // a stored value the list does not carry stays selected, unchanged
    idInput: null,         // an <input> kept filled with the selected model's canonical id
    logos: false,          // render make logos (combobox mode only)
    search: false,         // searchable combobox instead of a plain <select>
    attribution: true,     // "Vehicle data by VehiclesDB" line (CC-BY credit)
    placeholderMake: "Make",
    placeholderModel: "Model",
    placeholderYear: "Year",
    requiredMessage: "Please select a vehicle make.", // validity message on a required make field
    onChange: null,        // ({ make, model }) => {} — plus `year`/`id` when a year select/idInput is attached
    onError: null          // (error) => {}
  }

  // How far back `yearFallback: "range"` reaches: the current year down to
  // forty years ago covers the cars a garage actually sees on its ramps.
  const FALLBACK_YEARS = 40
  // The bounds of a believable register span: nothing was registered as a
  // motor vehicle before 1886 (the Benz Patent-Motorwagen), and nothing is on
  // record past next year's model year. They also cap every year list at
  // ~140 rows, whatever the payload says.
  const FIRST_YEAR = 1886

  // In-page caches — the dataset is immutable per release, so one fetch per
  // URL per pageview is the right amount of network.
  const jsonCache = new Map()
  const logoCache = new Map()
  // Dataset mode: one fetch (and one preparation) per dataset URL, and one
  // preparation per `data` object the host passes, shared by every widget on
  // the page.
  const datasetCache = new Map()
  const preparedData = new WeakMap()
  // The record behind each <option> the widget renders. Option VALUES cannot
  // say which record they stand for: without a `kind`, Iveco's Daily is three
  // records (bus, truck, van) with one slug, and the canonical id needs the
  // one actually selected.
  const optionItems = new WeakMap()

  // The same file the SDKs and the Ruby gem read (dist/vehicles.min.json
  // lacks names, aliases, forms and availability, so it cannot serve here).
  const DATASET_BASE = "https://cdn.jsdelivr.net/gh/vehiclesdb/vehiclesdb"

  function resolveEl(elOrSelector, name) {
    const el = typeof elOrSelector === "string" ? document.querySelector(elOrSelector) : elOrSelector
    if (!el) throw new Error(`VehiclesDropdown: ${name} element not found`)
    if (el.tagName !== "SELECT" || el.multiple) {
      throw new Error(`VehiclesDropdown: ${name} must be a single-select <select> element`)
    }
    return el
  }

  function resolveInput(elOrSelector) {
    const el = typeof elOrSelector === "string" ? document.querySelector(elOrSelector) : elOrSelector
    if (!el || el.tagName !== "INPUT") throw new Error("VehiclesDropdown: idInput must be an <input> element (a hidden field works)")
    return el
  }

  function requestCacheKey(url, key) {
    return JSON.stringify([url, key])
  }

  function logoURL(apiBase, slug) {
    return `${apiBase}/makes/${encodeURIComponent(slug)}/logo?variant=emblem`
  }

  async function fetchJSON(url, key, collection) {
    const cacheKey = requestCacheKey(url, key)
    if (jsonCache.has(cacheKey)) return jsonCache.get(cacheKey)
    const promise = fetch(url, { headers: { Authorization: `Bearer ${key}` } }).then(async (response) => {
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        const error = new Error(body.message || `VehiclesDB API answered ${response.status}`)
        error.status = response.status
        error.code = body.error
        throw error
      }
      const body = await response.json()
      const items = body && body[collection]
      if (!Array.isArray(items) || items.some((item) =>
        !item || typeof item.name !== "string" || typeof item.slug !== "string")) {
        throw new Error(`VehiclesDB API returned malformed ${collection} data`)
      }
      return body
    })
    jsonCache.set(cacheKey, promise)
    promise.catch(() => jsonCache.delete(cacheKey))
    return promise
  }

  // Logos need the Authorization header, and an <img src> cannot send one —
  // so fetch each Blob once per API/key pair. Object URLs belong to an
  // instance, though: destroy() revokes them instead of leaking page-lifetime
  // browser resources. A 404 is a normal, cacheable miss.
  async function fetchLogoBlob(apiBase, key, slug) {
    const url = logoURL(apiBase, slug)
    const cacheKey = requestCacheKey(url, key)
    if (logoCache.has(cacheKey)) return logoCache.get(cacheKey)
    const promise = fetch(url, {
      headers: { Authorization: `Bearer ${key}` }
    }).then(async (response) => {
      if (response.status === 404) return null
      if (!response.ok) throw new Error(`VehiclesDB logo API answered ${response.status}`)
      return response.blob()
      // ANY failure is a cached miss for the rest of the pageview: the letter
      // chip renders instead. Every keystroke re-renders up to 50 rows, so a
      // misbehaving logo endpoint retried per render would be a request storm.
    }).catch(() => null)
    logoCache.set(cacheKey, promise)
    return promise
  }

  function query(config) {
    const params = new URLSearchParams()
    if (config.kind) params.set("kind", config.kind)
    if (config.country) params.set("country", config.country)
    if (config.topMakes) {
      params.set("order", "popular")
      params.set("limit", config.topMakes)
    }
    const s = params.toString()
    return s ? `?${s}` : ""
  }

  function optionValue(config, item) {
    return config.values === "name" ? item.name : item.slug
  }

  // ---- Dataset mode: the open file, filtered in the page ------------------
  // `dist/vehicles.json` is `{version, makes: [{name, slug, aliases?,
  // models: [{name, slug, kind, availability, aliases?, forms?, former_ids?,
  // mass_decile?, global_decile?, country_ranks?}]}]}`. A host may pass a
  // subset in that shape as `data` (one country's cars, rendered by its
  // server) instead of the whole release.
  function prepareDataset(data) {
    if (!data || !Array.isArray(data.makes) || data.makes.some((make) =>
      !make || typeof make.name !== "string" || typeof make.slug !== "string" ||
      (make.models != null && !Array.isArray(make.models)))) {
      throw new Error("VehiclesDB dataset is malformed: expected {makes: [{name, slug, models: [...]}]}")
    }
    const makes = data.makes.map((raw) => ({
      name: raw.name,
      slug: raw.slug,
      kinds: raw.kinds || [],
      aliases: raw.aliases || [],
      models: (raw.models || []).filter((model) =>
        model && typeof model.name === "string" && typeof model.slug === "string")
    }))
    // Name-alphabetical, diacritic-insensitive, like the gem, the SDKs and
    // the API's make list (the file arrives slug-sorted).
    makes.sort((a, b) => ordinal(norm(a.name), norm(b.name)) || ordinal(a.slug, b.slug))
    return { version: data.version || null, makes }
  }

  function datasetFor(config) {
    if (config.data) {
      let prepared = preparedData.get(config.data)
      if (!prepared) {
        prepared = Promise.resolve().then(() => prepareDataset(config.data))
        preparedData.set(config.data, prepared)
      }
      return prepared
    }
    const url = config.datasetUrl ||
      `${DATASET_BASE}@${encodeURIComponent(config.version || "latest")}/dist/vehicles.json`
    if (datasetCache.has(url)) return datasetCache.get(url)
    const promise = fetch(url).then(async (response) => {
      if (!response.ok) {
        const error = new Error(`VehiclesDB dataset answered ${response.status}`)
        error.status = response.status
        throw error
      }
      return prepareDataset(await response.json())
    })
    datasetCache.set(url, promise)
    // A failed fetch is not cached: the next widget (or a retry) asks again.
    promise.catch(() => datasetCache.delete(url))
    return promise
  }

  // The scoped list, the same filters the API applies server-side: `kind`
  // keeps that kind, `country` keeps models the registers have evidence for
  // there (`availability`).
  function inScope(config, model) {
    const country = config.country ? String(config.country).toLowerCase() : null
    return (!config.kind || model.kind === config.kind) &&
      (!country || (Array.isArray(model.availability) && model.availability.includes(country)))
  }

  // The API's two orders. Popular: the country's own registration rank when
  // the data has one, then the global decile, then the name.
  function orderModels(config, models) {
    const country = config.country ? String(config.country).toLowerCase() : null
    if (config.order !== "popular") return models.slice().sort((a, b) => ordinal(a.name, b.name))
    const rank = (model) => {
      const value = country && model.country_ranks ? model.country_ranks[country] : null
      return Number.isFinite(value) ? value : null
    }
    const decile = (model) => Number.isFinite(model.global_decile) ? model.global_decile : 99
    return models.slice().sort((a, b) => {
      const ra = rank(a), rb = rank(b)
      if ((ra === null) !== (rb === null)) return ra === null ? 1 : -1
      return (ra || 0) - (rb || 0) || decile(a) - decile(b) || ordinal(a.name, b.name)
    })
  }

  // The canonical id a database should store: kind/make_slug/model_slug.
  function modelId(make, model) {
    return make && model && model.kind ? `${model.kind}/${make.slug}/${model.slug}` : ""
  }

  // ---- Matching typed text to a make or model ------------------------------
  // VehiclesDB's resolution contract (RESOLUTION.md in the dataset repo) is
  // one set of rules for every surface: the Ruby gem, the API, the SDKs and
  // this widget. A stored "Citroen" or "VW" or "Focus C-Max" must pick the
  // same record here that the API resolves it to, so this is a port of the
  // contract's strict rungs, not a widget-flavoured approximation. Only the
  // curated rungs run here (name/slug, published aliases, curated forms):
  // typo correction is a guess, and a picker that silently preselects a
  // guess writes a wrong answer into someone's form.

  // The contract's one normalization: NFKD, drop combining marks, lowercase,
  // every run of non-[a-z0-9] becomes one space. "Škoda" → "skoda",
  // "Mercedes-Benz" → "mercedes benz", "Lynk & Co" → "lynk co".
  function norm(value) {
    return String(value == null ? "" : value).normalize("NFKD").replace(/\p{Mn}+/gu, "")
      .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
  }

  // A native-script alias (比亚迪, 현대) normalizes to nothing; like the gem,
  // it is then compared by its trimmed, lowercased raw text instead.
  function key(value) {
    return norm(value) || `raw:${String(value == null ? "" : value).trim().toLowerCase()}`
  }

  // Spacing-blind: "XCeed" is the dataset's "X Ceed", "A 5" is the "A5".
  function squash(k) { return k.replace(/ /g, "") }

  // "Serie 3" is how BMW sells the 3 Series in Spain and Italy ("Série" in
  // France normalizes the same).
  const LOCALIZED_SERIES = /^serie (\w+)$/

  // Code point order, never locale-aware: the contract's string comparison.
  function ordinal(a, b) { return a < b ? -1 : a > b ? 1 : 0 }

  // RESOLUTION §3a, the kind-collision tie-break: when a rung's hits are ONE
  // nameplate in several kinds (Iveco's Daily: bus, truck, van), the record
  // with the lowest `mass_decile` answers (absent = unranked = last), then by
  // kind precedence, then by id. Every surface applies the same rule, so an
  // unhinted "Iveco Daily" is the van in the gem, the API, the SDKs and here.
  const KIND_PRECEDENCE = [ "van", "car", "bus", "truck", "moped", "motorcycle" ]
  function massDecile(item) {
    const value = item.mass_decile != null ? item.mass_decile : item.massDecile
    return Number.isFinite(value) ? value : Infinity
  }
  function kindCollisionOrder(a, b) {
    const da = massDecile(a), db = massDecile(b)
    if (da !== db) return da < db ? -1 : 1
    const ka = KIND_PRECEDENCE.indexOf(a.kind), kb = KIND_PRECEDENCE.indexOf(b.kind)
    const ra = ka < 0 ? KIND_PRECEDENCE.length : ka, rb = kb < 0 ? KIND_PRECEDENCE.length : kb
    if (ra !== rb) return ra - rb
    return ordinal(String(a.kind), String(b.kind)) ||
      ordinal(String(a.id || a.slug), String(b.id || b.slug))
  }

  // Run rungs strongest first; the first that finds anything decides. Hits
  // on one nameplate answer (several kinds of it are a kind collision,
  // settled by the tie-break above, never ambiguity); hits on two nameplates
  // are AMBIGUOUS and stop the ladder, because a weaker rung must never
  // overrule data that says "either".
  const AMBIGUOUS = []
  function firstRung(rungs) {
    for (const rung of rungs) {
      const hits = rung()
      if (hits === AMBIGUOUS) return null
      if (!hits.length) continue
      const slugs = new Set(hits.map((item) => item.slug))
      if (slugs.size > 1) return null
      return hits.slice().sort(kindCollisionOrder)[0]
    }
    return null
  }

  function fieldHits(items, field, k) {
    const tight = squash(k)
    const exact = items.filter((item) => (item[field] || []).some((v) => key(v) === k))
    if (exact.length) return exact
    return items.filter((item) => (item[field] || []).some((v) => squash(key(v)) === tight))
  }

  // A make by slug or name, then by a published alias ("VW", "Merc").
  function findMake(makes, wanted) {
    const k = key(wanted)
    if (!makes || k === "raw:") return null
    return firstRung([
      () => makes.filter((m) => key(m.slug) === k || key(m.name) === k),
      () => fieldHits(makes, "aliases", k)
    ])
  }

  // A model of one make: name or slug (then spacing-blind, then "Serie N"),
  // then a published alias, then a curated form, the registry spelling the
  // dataset folds into the record ("Focus C-Max" is the C-Max).
  function findModel(models, wanted) {
    const k = key(wanted)
    if (!models || k === "raw:") return null
    const named = (q) => () => {
      const exact = models.filter((m) => key(m.slug) === q || key(m.name) === q)
      if (exact.length) return exact
      // Spacing-blind only counts when it lands on ONE name: "a 5" must not
      // choose between an "A5" and an "A 5" if a make had both.
      const loose = models.filter((m) => squash(key(m.name)) === squash(q))
      return new Set(loose.map((m) => key(m.name))).size > 1 ? AMBIGUOUS : loose
    }
    const series = k.replace(LOCALIZED_SERIES, "$1 series")
    return firstRung([
      named(k),
      ...(series !== k ? [ named(series) ] : []),
      () => fieldHits(models, "aliases", k),
      () => fieldHits(models, "forms", k)
    ])
  }

  // A stored canonical id (`van/iveco/daily`), then a published former id,
  // among one make's models: the contract's id rungs, the strongest there
  // are. A hidden id field saved by an earlier edit keeps naming its exact
  // record, kind included, even where the name alone would collide.
  function findModelById(make, models, id) {
    const wanted = String(id == null ? "" : id).trim()
    if (!make || !models || !wanted) return null
    return firstRung([
      () => models.filter((m) => modelId(make, m) === wanted),
      () => models.filter((m) => Array.isArray(m.former_ids) && m.former_ids.includes(wanted))
    ])
  }

  // The searchable list: every make whose name, slug or published alias
  // contains what was typed, compared by `norm` and spacing-blind. Exact
  // answers first, then name hits, then alias-only hits ("vw" lists
  // Volkswagen), each group in the list's own order (popular or A to Z).
  function filterItems(items, text) {
    const needle = norm(text)
    if (!needle) return items
    const tight = squash(needle)
    const groups = [ [], [], [], [] ]
    for (const item of items) {
      const names = [ norm(item.name), norm(item.slug) ]
      const aliases = (item.aliases || []).map(norm).filter(Boolean)
      if (names.concat(aliases).some((n) => n === needle || squash(n) === tight)) groups[0].push(item)
      else if (names.some((n) => n.includes(needle))) groups[1].push(item)
      else if (names.some((n) => squash(n).includes(tight))) groups[2].push(item)
      else if (aliases.some((n) => n.includes(needle) || squash(n).includes(tight))) groups[3].push(item)
    }
    return groups.flat()
  }

  function fillSelect(select, placeholder, items, config, selected) {
    const previous = selected !== undefined ? selected : select.value
    select.replaceChildren(new Option(placeholder, "", previous === "", previous === ""))
    for (const item of items) {
      const value = optionValue(config, item)
      const option = new Option(item.name, value, value === previous, value === previous)
      optionItems.set(option, item)
      select.add(option)
    }
  }

  // The escape hatch's text and value are the host's: `otherLabel` to
  // translate, `otherValue` ("other" by default) for apps that store their
  // own word for it.
  function appendOther(select, config) {
    select.add(new Option(config.otherLabel, config.otherValue))
  }

  // Select one option as the field's initial state, the one a form reset
  // restores.
  function preselect(select, option) {
    option.selected = true
    Array.from(select.options).forEach((each) => { each.defaultSelected = each === option })
  }

  function optionFor(select, item) {
    return Array.from(select.options).find((option) => optionItems.get(option) === item)
  }

  // NEVER BLANK A STORED VALUE. A value the list does not carry (a legacy
  // free-text model, a make outside the `kind`/`country` scope, a name the
  // data says could be two records) is kept as one extra option, selected,
  // so the form submits it unchanged until the person picks something else.
  // It sits right under the placeholder, where an editor sees it. `id` is
  // the canonical id it stands for, when one is known (see failModels).
  function keepOption(select, value, id) {
    const option = new Option(value, value)
    optionItems.set(option, { kept: true, id: id || "" })
    select.insertBefore(option, select.options[1] || null)
    preselect(select, option)
  }

  // A model's register span, or null. `years_on_record` reached the API
  // after the widget did, so a missing key (older responses, mocks) means
  // the same as an explicit null — and so does anything that is not a sane
  // {first, last} pair inside FIRST_YEAR..next year. Never trust a span
  // enough to render nonsense: `last: 1e300` passes Number.isInteger and,
  // since 1e300 - 1 === 1e300, would never finish counting down.
  function yearSpan(model, currentYear) {
    const span = model && model.years_on_record
    if (!span || !Number.isInteger(span.first) || !Number.isInteger(span.last)) return null
    const sane = FIRST_YEAR <= span.first && span.first <= span.last && span.last <= currentYear + 1
    return sane ? span : null
  }

  // Years as fillSelect items, NEWEST FIRST: a garage books a recent car far
  // more often than a classic, so the likely answer sits at the top.
  function yearItems(first, last) {
    const items = []
    for (let year = last; year >= first; year -= 1) items.push({ name: String(year), slug: String(year) })
    return items
  }

  function attributionLine(container) {
    const p = document.createElement("p")
    p.className = "vdb-attribution"
    p.style.cssText = "font-size:.75rem;color:#6b7280;margin:.375rem 0 0;"
    const a = document.createElement("a")
    a.href = "https://vehiclesdb.com"
    a.target = "_blank"
    a.rel = "noopener"
    a.textContent = "VehiclesDB"
    a.style.cssText = "color:inherit;text-decoration:underline;"
    p.append("Vehicle data by ", a, " (CC-BY 4.0)")
    container.append(p)
    return p
  }

  // The initial-letter chip — the fallback that always works. Rendered
  // whenever a make has no logo (most do not; coverage is partial on
  // purpose) or the logo fails to load.
  function chip(name) {
    const span = document.createElement("span")
    span.className = "vdb-chip"
    span.textContent = (name[0] || "?").toUpperCase()
    span.style.cssText = "display:inline-flex;align-items:center;justify-content:center;" +
      "width:1.25rem;height:1.25rem;border-radius:9999px;background:#e5e7eb;color:#374151;" +
      "font-size:.7rem;font-weight:600;flex:none;"
    return span
  }

  class Instance {
    constructor(options) {
      this.config = Object.assign({}, DEFAULTS, options)
      if (this.config.source !== "api" && this.config.source !== "dataset") {
        throw new Error(`VehiclesDropdown: source must be "api" or "dataset", got ${JSON.stringify(this.config.source)}`)
      }
      if (this.config.data != null && typeof this.config.data !== "object") {
        throw new Error("VehiclesDropdown: `data` must be the parsed dataset object ({makes: [...]}), not a string")
      }
      // `data` is a dataset by definition; passing it is enough.
      this.datasetMode = this.config.source === "dataset" || this.config.data != null
      const key = this.config.key
      if (!this.datasetMode && (typeof key !== "string" || !key.trim())) {
        throw new Error("VehiclesDropdown: pass your publishable API key as `key` (get one free at https://vehiclesdb.com), " +
          "or use the open dataset with no key: `source: \"dataset\"`")
      }

      this.makeSelect = resolveEl(this.config.make, "make")
      this.modelSelect = this.config.model ? resolveEl(this.config.model, "model") : null
      if (this.modelSelect === this.makeSelect) {
        throw new Error("VehiclesDropdown: make and model must be different <select> elements")
      }
      if (!this.config.initialModel && this.modelSelect?.value) {
        this.config.initialModel = this.modelSelect.value
      }
      // The year depends on the model, so a year select without one has
      // nothing to fill from — say so now, not with a silently empty field.
      this.yearSelect = this.config.year ? resolveEl(this.config.year, "year") : null
      if (this.yearSelect && !this.modelSelect) {
        throw new Error("VehiclesDropdown: year needs a model <select> to depend on")
      }
      if (this.yearSelect && (this.yearSelect === this.makeSelect || this.yearSelect === this.modelSelect)) {
        throw new Error("VehiclesDropdown: year must be a different <select> element from make and model")
      }
      if (!this.config.initialYear && this.yearSelect?.value) {
        this.config.initialYear = this.yearSelect.value
      }
      // The canonical id of the selected model, for the host's database. Its
      // server-rendered value is a stored id: the strongest answer there is
      // for which record the saved model is (see findModelById).
      this.idInput = this.config.idInput ? resolveInput(this.config.idInput) : null
      if (this.idInput && !this.modelSelect) {
        throw new Error("VehiclesDropdown: idInput needs a model <select> to take the id from")
      }
      this.initialId = this.idInput ? this.idInput.value : ""
      // `disabled` belongs to the host. The widget only ever disables the
      // year select for its OWN reason (yearFallback "none" with nothing to
      // choose), remembers that it did, and only ever undoes that.
      this.yearDisabledByWidget = false
      this.destroyed = false
      this.logoUrls = new Map()
      this.objectUrls = new Set()

      this.handleMakeChange = () => {
        this.combobox?.sync()
        this.makeChanged()
      }
      this.handleModelChange = () => { this.modelChanged() }
      this.handleYearChange = () => { this.notify() }
      this.makeSelect.addEventListener("change", this.handleMakeChange)
      if (this.modelSelect) this.modelSelect.addEventListener("change", this.handleModelChange)
      if (this.yearSelect) this.yearSelect.addEventListener("change", this.handleYearChange)
      this.form = this.makeSelect.form
      this.handleFormReset = () => {
        // The reset event fires before the browser restores form controls.
        // Wait one task, then rebuild the dependent options for the restored
        // make and reapply the configured/server-rendered initial model and year.
        setTimeout(() => {
          if (this.destroyed) return
          this.initialModelApplied = false
          this.initialYearApplied = false
          this.combobox?.sync()
          this.makeChanged()
        }, 0)
      }
      this.form?.addEventListener("reset", this.handleFormReset)

      if (this.config.search || this.config.logos) this.enhance()
      if (this.config.attribution) {
        const anchor = (this.yearSelect || this.modelSelect || this.makeSelect).parentElement || this.makeSelect
        this.attributionEl = attributionLine(anchor)
      }

      this.loading = this.loadMakes()
    }

    get api() { return this.config.apiBase.replace(/\/$/, "") }

    // The make list for this widget's scope: from the API, or from the
    // dataset filtered here (a make stays when one of its models does).
    async fetchMakes() {
      if (!this.datasetMode) {
        const data = await fetchJSON(`${this.api}/makes${query(this.config)}`, this.config.key, "makes")
        return data.makes
      }
      const dataset = await datasetFor(this.config)
      return dataset.makes.filter((make) => make.models.some((model) => inScope(this.config, model)))
    }

    async fetchModels(make, slug) {
      if (this.datasetMode) {
        if (!make) return []
        await datasetFor(this.config)
        return orderModels(this.config, make.models.filter((model) => inScope(this.config, model)))
      }
      const params = new URLSearchParams()
      if (this.config.kind) params.set("kind", this.config.kind)
      if (this.config.country) params.set("country", this.config.country)
      if (this.config.order === "popular") params.set("order", "popular")
      const url = `${this.api}/makes/${encodeURIComponent(slug)}/models?${params}`
      return (await fetchJSON(url, this.config.key, "models")).models
    }

    async loadMakes() {
      try {
        const makes = await this.fetchMakes()
        if (this.destroyed) return
        this.makes = makes
        // The host's own selection (a server-rendered edit form) wins over
        // `initialMake`, as it always has.
        const preselected = this.makeSelect.value
        this.renderMakes()

        // The preselected make, by the resolution contract (slug, name or a
        // published alias, by `norm`): a stored "Citroen" or "VW" lands on
        // its make. Resolved even when the host already rendered a make, so
        // the model and year steps can tell whether that is the intended one.
        this.initialMakeItem = this.config.initialMake ? findMake(makes, this.config.initialMake) : null
        const wanted = preselected || (this.config.initialMake == null ? "" : String(this.config.initialMake))
        this.initialMakeKept = null
        const outcome = this.selectMake(wanted)
        if ((outcome === "kept" || outcome === "other") && !preselected) this.initialMakeKept = wanted

        this.combobox?.sync()

        if (this.makeSelect.value) this.makeChanged()
        else if (preselected) {
          // `keepUnknown: false`: a server-rendered selection the list does
          // not carry has just been dropped. Say so: the consumer's own state
          // still holds the old value, and a silent empty submit is the
          // worst outcome.
          console.warn(`[VehiclesDropdown] preselected make ${JSON.stringify(preselected)} is not in the fetched list; selection cleared`)
          this.notify()
        }
      } catch (error) {
        if (!this.destroyed) this.fail(error)
      }
    }

    renderMakes() {
      fillSelect(this.makeSelect, this.config.placeholderMake, this.makes, this.config, "")
      if (this.config.includeOther) appendOther(this.makeSelect, this.config)
      if (this.combobox) this.combobox.setItems(this.makes)
    }

    // Put a stored make on the make select: the option itself, or its make
    // by the contract, or (keepUnknown) the value as given. Returns what
    // happened: "selected", "other", "kept" or "" (nothing selected).
    selectMake(wanted) {
      if (!wanted) return ""
      const select = this.makeSelect
      if (wanted === this.config.otherValue && this.config.includeOther) {
        preselect(select, Array.from(select.options).find((option) => option.value === wanted))
        return "other"
      }
      const item = this.makes.find((make) => optionValue(this.config, make) === wanted) || findMake(this.makes, wanted)
      if (item) {
        preselect(select, optionFor(select, item))
        this.combobox?.display(item)
        return "selected"
      }
      if (!this.config.keepUnknown) return ""
      keepOption(select, wanted)
      return "kept"
    }

    // Set a stored make/model (and year, and id) after attach, by the same
    // rules as the initial values: resolved to the canonical options when the
    // data can, kept as given when it cannot. Resolves once applied.
    async setValue({ make = null, model = null, year = null, id = null } = {}) {
      await this.loading
      if (this.destroyed || !this.makes) return
      this.config.initialMake = make
      this.config.initialModel = model
      this.config.initialYear = year
      this.initialId = id || ""
      this.initialModelApplied = false
      this.initialYearApplied = false
      this.renderMakes()
      this.initialMakeItem = make ? findMake(this.makes, make) : null
      this.initialMakeKept = null
      const wanted = make == null ? "" : String(make)
      const outcome = this.selectMake(wanted)
      if (outcome === "kept" || outcome === "other") this.initialMakeKept = wanted
      this.combobox?.sync()
      await this.makeChanged()
    }

    async makeChanged() {
      // CLEAR THE MODEL BEFORE ANNOUNCING. The old model belongs to the old
      // make, so reporting {make: "suzuki", model: "golf"} for the moment
      // between the change and the fetch is not a lag, it is a wrong answer —
      // and onChange consumers write it straight into their form state.
      // The year belongs to the old model, so it goes with it.
      this.models = null
      this.modelsMake = null
      // Only the latest call may fill the model select: a value check alone
      // cannot tell two loads for the same make apart (setValue right after
      // attach), and the older one would spend the initial model.
      const turn = this.makeTurn = (this.makeTurn || 0) + 1
      if (this.modelSelect) {
        fillSelect(this.modelSelect, this.config.placeholderModel, [], this.config, "")
      }
      if (this.yearSelect) this.fillYears()
      this.notify()
      if (this.destroyed) return
      if (!this.modelSelect) return

      const makeValue = this.makeSelect.value
      if (!makeValue) return
      // `values: "name"` still needs the slug for the URL — look it up.
      const make = this.makes?.find((m) => optionValue(this.config, m) === makeValue)
      // Other, or a kept make the list does not carry: there are no models to
      // load, but a stored model still deserves to survive the edit.
      if ((makeValue === this.config.otherValue && this.config.includeOther) || (!make && (this.makes || this.datasetMode))) {
        if (this.config.includeOther) appendOther(this.modelSelect, this.config)
        this.applyInitialModel(null, [])
        return
      }
      const slug = make ? make.slug : makeValue

      try {
        const models = await this.fetchModels(make, slug)
        if (this.destroyed || turn !== this.makeTurn || this.makeSelect.value !== makeValue) return
        // The list and the select it fills are swapped TOGETHER, past the
        // stale-response guard: the year step reads its spans from this list,
        // so it can only ever describe the models actually on screen.
        this.models = models
        this.modelsMake = make || { slug }
        fillSelect(this.modelSelect, this.config.placeholderModel, models, this.config, "")
        if (this.config.includeOther) appendOther(this.modelSelect, this.config)
        this.applyInitialModel(this.modelsMake, models)
      } catch (error) {
        if (this.destroyed || turn !== this.makeTurn || this.makeSelect.value !== makeValue) return
        // The model list could not load. The stored model (and its id) stay
        // as they were, so submitting the form now changes nothing.
        this.applyInitialModel(make || null, [], this.initialId)
        this.fail(error)
      }
    }

    // The preselected model, applied exactly once — after that the person
    // is driving, and a make change must reset the model like always.
    // Matched by the resolution contract like the make: a stored id (or a
    // former id) from `idInput` first, then name or slug (spacing-blind,
    // "Serie 3"), a published alias, or a curated form, so a free-text
    // "Focus C-Max" saved by an older form preselects the C-Max. When the
    // data says it could be two records, or nothing matches, the stored
    // text is kept as given (keepUnknown), never guessed and never blanked.
    applyInitialModel(make, models, keptId) {
      const wanted = this.config.initialModel == null ? "" : String(this.config.initialModel)
      if (!(wanted || this.initialId) || this.initialModelApplied || !this.isInitialMake(make)) return
      this.initialModelApplied = true
      const select = this.modelSelect
      const match = findModelById(make, models, this.initialId) || (wanted ? findModel(models, wanted) : null)
      this.initialModelItem = match
      if (match) preselect(select, optionFor(select, match))
      else if (wanted && wanted === this.config.otherValue && this.config.includeOther) {
        preselect(select, Array.from(select.options).find((option) => option.value === wanted))
      } else if (wanted && this.config.keepUnknown) keepOption(select, wanted, keptId)
      else return
      this.modelChanged()
    }

    // Is `make` the one `initialMake` names (or is there no initialMake)?
    // Compared as resolved records, so "vw" and "volkswagen" agree. With no
    // record (Other, or a kept make), the kept initialMake is its own answer.
    isInitialMake(make) {
      if (!this.config.initialMake) return true
      if (!make) return this.initialMakeKept != null && this.makeSelect.value === this.initialMakeKept
      return Boolean(this.initialMakeItem && make.slug === this.initialMakeItem.slug)
    }

    // The record behind the selected model option: a dataset/API model, a
    // kept value ({kept: true}), or null (placeholder, Other).
    selectedModel() {
      const select = this.modelSelect
      const option = select && select.selectedIndex >= 0 ? select.options[select.selectedIndex] : null
      return (option && option.value && optionItems.get(option)) || null
    }

    modelChanged() {
      // Same rule as the make: refill the year for THIS model before
      // announcing, so no payload ever pairs a model with another one's year.
      if (this.yearSelect) this.fillYears()
      this.notify()
    }

    // The year step makes no request: the spans ride on the models list the
    // model step already fetched (this.models). So its only race is the
    // model select itself — read its value NOW, at fill time, never from a
    // value captured earlier, and look it up in the list that filled it.
    fillYears() {
      const select = this.yearSelect
      const modelValue = this.modelSelect.value
      if (!modelValue) {
        fillSelect(select, this.config.placeholderYear, [], this.config, "")
        this.disableYear(false)
        return
      }

      // "Other / not listed" has no span by definition, nor has a kept
      // value; they take the fallback like any model the registers cannot
      // date. The record is the selected OPTION's, not the first with its
      // value: without a `kind`, one slug can be several records.
      const selected = this.selectedModel()
      const model = selected && !selected.kept ? selected : null
      const current = new Date().getFullYear()
      const span = yearSpan(model, current)
      // THE DEFAULT IS A RANGE, NOT A DEAD END. About one model in eight has
      // no register span, and a booking form whose year field goes blank for
      // that customer is a lost booking; the picker should never dead-end.
      // "none" is the opt-out for forms that would rather ask nothing than
      // offer years the registers cannot vouch for.
      const none = !span && this.config.yearFallback === "none"
      const items = span ? yearItems(span.first, span.last)
        : none ? []
        : yearItems(current - FALLBACK_YEARS, current)
      fillSelect(select, this.config.placeholderYear, items, this.config, "")
      if (this.config.includeOther) appendOther(select, this.config)

      // The preselected year, applied exactly once and only to its intended
      // make and model — after that the person is driving.
      const make = this.makes?.find((m) => optionValue(this.config, m) === this.makeSelect.value)
      const wantedModel = this.config.initialModel
      const intendedInitialModel = !wantedModel || modelValue === wantedModel ||
        (model && model.slug === this.initialModelItem?.slug)
      if (this.config.initialYear && !this.initialYearApplied && this.isInitialMake(make) && intendedInitialModel) {
        this.initialYearApplied = true
        this.keepYear(String(this.config.initialYear), modelValue)
      }

      // Disabled only when there is truly nothing to choose: with
      // includeOther the escape hatch is a choice, and so is a kept year.
      this.disableYear(none && select.options.length === 1)
    }

    // NEVER DROP A VALUE THE HOST GAVE US. Spans are register years, so an
    // edit form's saved 2024 against a model on record 2015–2022 is common,
    // not an error — keep it as an option, in its place (newest first), and
    // say so once, the way a dropped make is announced.
    keepYear(wanted, modelValue) {
      const select = this.yearSelect
      if (!Array.from(select.options).some((option) => option.value && option.value === wanted)) {
        if (wanted === this.config.otherValue) appendOther(select, this.config)
        else if (/^\d+$/.test(wanted)) {
          const before = Array.from(select.options).find((option) =>
            option.value === this.config.otherValue || (option.value && Number(option.value) < Number(wanted)))
          select.add(new Option(wanted, wanted), before || null)
        } else {
          console.warn(`[VehiclesDropdown] initial year ${JSON.stringify(wanted)} is not a year; selection cleared`)
          return
        }
        if (!this.yearKeptWarned) {
          this.yearKeptWarned = true
          console.warn(`[VehiclesDropdown] year ${JSON.stringify(wanted)} is not on record for model ${JSON.stringify(modelValue)}; kept as given`)
        }
      }
      select.value = wanted
      Array.from(select.options).forEach((option) => {
        option.defaultSelected = option.value === select.value
      })
    }

    // The widget's own reason to disable the year select, and only that:
    // set on entering it (unless the host already had the field disabled),
    // cleared on leaving it, never a write-back of the host's state.
    disableYear(disable) {
      if (disable && !this.yearDisabledByWidget && !this.yearSelect.disabled) {
        this.yearSelect.disabled = true
        this.yearDisabledByWidget = true
      } else if (!disable && this.yearDisabledByWidget) {
        this.yearSelect.disabled = false
        this.yearDisabledByWidget = false
      }
    }

    async logoUrl(slug) {
      // Logos are an API feature (they need the key); keyless dataset mode
      // renders the letter chip, which is always the fallback anyway.
      if (!this.config.key) return null
      const cacheKey = requestCacheKey(logoURL(this.api, slug), this.config.key)
      if (this.logoUrls.has(cacheKey)) return this.logoUrls.get(cacheKey)

      const promise = fetchLogoBlob(this.api, this.config.key, slug).then((blob) => {
        if (!blob || this.destroyed) return null
        const url = URL.createObjectURL(blob)
        this.objectUrls.add(url)
        return url
      })
      this.logoUrls.set(cacheKey, promise)
      return promise
    }

    // The searchable combobox: a text input + ARIA listbox layered over the
    // make <select>, which stays in the DOM (hidden) as the form value —
    // progressive enhancement, the form submits the same either way.
    // Keyboard per the WAI-ARIA combobox pattern: arrows move the active
    // option (aria-activedescendant), Enter chooses it, Escape closes.
    enhance() {
      const select = this.makeSelect
      const listId = `vdb-listbox-${(Instance.sequence = (Instance.sequence || 0) + 1)}`
      const wrap = document.createElement("div")
      wrap.className = "vdb-combobox"
      wrap.style.cssText = "position:relative;"
      select.insertAdjacentElement("beforebegin", wrap)
      const originalDisplay = select.style.display
      select.style.display = "none"
      wrap.append(select)

      const input = document.createElement("input")
      input.type = "text"
      input.setAttribute("role", "combobox")
      input.setAttribute("aria-expanded", "false")
      input.setAttribute("aria-autocomplete", "list")
      input.setAttribute("aria-controls", listId)
      input.placeholder = this.config.placeholderMake
      input.autocomplete = "off"
      const originalRequired = select.required
      select.required = false
      input.required = originalRequired
      input.disabled = select.disabled
      // The host owns `disabled` and may flip it after attach (a form that
      // locks fields once verified): mirror it onto the visible input.
      const View = select.ownerDocument.defaultView
      const observer = View && View.MutationObserver
        ? new View.MutationObserver(() => { input.disabled = select.disabled })
        : null
      if (observer) observer.observe(select, { attributes: true, attributeFilter: [ "disabled" ] })
      // Inherit the host select's classes, so the combobox wears whatever the
      // page's forms wear — Tailwind, Bootstrap, hand-rolled CSS, anything.
      input.className = `vdb-combobox-input ${select.className}`.trim()
      if (select.getAttribute("aria-label")) input.setAttribute("aria-label", select.getAttribute("aria-label"))
      if (select.getAttribute("aria-labelledby")) input.setAttribute("aria-labelledby", select.getAttribute("aria-labelledby"))
      if (select.getAttribute("aria-describedby")) input.setAttribute("aria-describedby", select.getAttribute("aria-describedby"))
      if (select.getAttribute("aria-invalid")) input.setAttribute("aria-invalid", select.getAttribute("aria-invalid"))

      // Keep explicit <label for="make"> elements useful after enhancement.
      // The original select keeps its id for form code and selectors; labels
      // point at the visible input until destroy() restores them.
      const inputId = select.id ? `${select.id}--vdb-combobox` : `${listId}-input`
      input.id = inputId
      const labels = select.id
        ? Array.from(select.ownerDocument.querySelectorAll("label[for]")).filter((label) => label.htmlFor === select.id)
        : []
      labels.forEach((label) => { label.htmlFor = inputId })

      const list = document.createElement("ul")
      list.id = listId
      list.setAttribute("role", "listbox")
      list.className = "vdb-combobox-list"
      list.style.cssText = "position:absolute;z-index:20;inset-inline:0;top:100%;max-height:16rem;" +
        "overflow-y:auto;margin:.25rem 0 0;padding:.25rem;list-style:none;background:#fff;" +
        "border:1px solid #e5e7eb;border-radius:.5rem;box-shadow:0 10px 15px -3px rgb(0 0 0/.1);display:none;"

      wrap.prepend(input)
      wrap.append(list)

      const self = this
      let items = []
      let shown = []   // the item behind each rendered row, by index
      let active = -1  // index into `shown`
      let open = false
      let blurTimer = null

      // The selected make's badge INSIDE the input — the flag treatment
      // (intl-tel-input's move). Logos mode only; the chip fallback keeps
      // the slot honest for uncovered marques.
      let adornment = null
      if (this.config.logos) {
        adornment = document.createElement("span")
        adornment.className = "vdb-combobox-adornment"
        adornment.style.cssText = "position:absolute;left:.875rem;top:50%;transform:translateY(-50%);" +
          "display:none;pointer-events:none;line-height:0;"
        wrap.append(adornment)
      }

      let adornedFor = null
      function showSelected(item) {
        input.value = item.name
        if (!adornment) return
        // choose() lands here twice per pick (directly, then again via the
        // change event through sync()); repainting the chip while the cached
        // logo re-resolves flashes the letter fallback. Same item, no repaint.
        if (adornedFor === item.name && adornment.childElementCount) return
        adornedFor = item.name
        adornment.style.display = "inline-flex"
        input.style.paddingLeft = "2.75rem"
        adornment.replaceChildren(chip(item.name))
        if (item.value) return // the escape-hatch row has no logo to fetch
        self.logoUrl(item.slug).then((url) => {
          if (!url || input.value !== item.name) return
          const img = document.createElement("img")
          img.src = url
          img.alt = ""
          img.style.cssText = "width:1.375rem;height:1.375rem;object-fit:contain;"
          adornment.replaceChildren(img)
        })
      }

      function close() {
        open = false; active = -1
        list.style.display = "none"
        input.setAttribute("aria-expanded", "false")
        input.removeAttribute("aria-activedescendant")
      }
      function openList() { open = true; list.style.display = "block"; input.setAttribute("aria-expanded", "true") }

      function setActive(index) {
        const rows = list.children
        if (active >= 0 && rows[active]) {
          rows[active].style.background = ""
          rows[active].setAttribute("aria-selected", "false")
        }
        active = index
        if (active < 0 || !rows[active]) return input.removeAttribute("aria-activedescendant")
        rows[active].style.background = "#f3f4f6"
        rows[active].setAttribute("aria-selected", "true")
        rows[active].scrollIntoView({ block: "nearest" })
        input.setAttribute("aria-activedescendant", rows[active].id)
      }

      function choose(item) {
        showSelected(item)
        // The escape-hatch row carries its own fixed value (otherValue);
        // real makes answer to the configured values mode.
        select.value = item.value !== undefined ? item.value : optionValue(self.config, item)
        select.dispatchEvent(new Event("change", { bubbles: true }))
        close()
      }

      function row(item, index) {
        const li = document.createElement("li")
        li.id = `${listId}-opt-${index}`
        li.setAttribute("role", "option")
        li.setAttribute("aria-selected", "false")
        li.style.cssText = "display:flex;align-items:center;gap:.5rem;padding:.375rem .5rem;" +
          "border-radius:.375rem;cursor:pointer;"
        li.addEventListener("mousedown", (event) => { event.preventDefault(); choose(item) })
        li.addEventListener("mouseenter", () => setActive(index))

        if (self.config.logos && !item.value) {
          const holder = chip(item.name)
          li.append(holder)
          self.logoUrl(item.slug).then((url) => {
            if (!url) return
            const img = document.createElement("img")
            img.src = url
            img.alt = ""
            img.style.cssText = "width:1.25rem;height:1.25rem;object-fit:contain;flex:none;"
            img.addEventListener("error", () => img.replaceWith(chip(item.name)))
            holder.replaceWith(img)
          })
        }

        // The make's NAME is always the identifier; a logo only ever
        // accompanies it (trademark hygiene, and it reads better too).
        li.append(document.createTextNode(item.name))
        return li
      }

      function render(filter) {
        shown = filterItems(items, filter).slice(0, 50)
        // The escape hatch rides along unfiltered: a picker should never
        // dead-end, least of all for the person whose make is not listed.
        if (self.config.includeOther) shown = shown.concat({ name: self.config.otherLabel, value: self.config.otherValue })
        active = -1
        input.removeAttribute("aria-activedescendant")
        list.replaceChildren(...shown.map(row))
        shown.length ? openList() : close()
      }

      // The selected make, or the selected option as a row of its own: the
      // Other row, or a stored make kept as given (keepUnknown), which the
      // input must show rather than blank.
      function selectedItem() {
        if (!select.value) return undefined
        const item = items.find((each) => optionValue(self.config, each) === select.value)
        if (item) return item
        const option = select.options[select.selectedIndex]
        return option ? { name: option.text, value: option.value } : undefined
      }

      function restoreSelected() {
        const item = selectedItem()
        if (item) showSelected(item)
        else {
          input.value = ""
          if (adornment) {
            adornment.style.display = "none"
            adornment.replaceChildren()
            input.style.paddingLeft = ""
          }
        }
        syncValidity()
      }

      function syncValidity() {
        if (!originalRequired) return
        const item = selectedItem()
        input.setCustomValidity(item && input.value === item.name ? "" : self.config.requiredMessage)
      }

      input.addEventListener("input", () => { render(input.value); syncValidity() })
      input.addEventListener("focus", () => {
        if (blurTimer) clearTimeout(blurTimer)
        input.select()
        render("")
      })
      input.addEventListener("blur", () => {
        // Synchronously: list rows preventDefault on mousedown so they never
        // blur the input, which means a blur is always a real departure — and
        // a submit button clicked right after must find the visible text and
        // the form value already agreeing.
        restoreSelected()
        blurTimer = setTimeout(close, 100)
      })
      input.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          event.preventDefault()
          restoreSelected()
          return close()
        }
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault()
          const delta = event.key === "ArrowDown" ? 1 : -1
          if (!open) {
            render(input.value)
            if (shown.length) setActive(delta > 0 ? 0 : shown.length - 1)
            return
          }
          const next = active < 0 ? (delta > 0 ? 0 : shown.length - 1) : (active + delta + shown.length) % shown.length
          return setActive(next)
        }
        if (event.key === "Enter") {
          // Commit only a deliberate choice: an arrowed-to row, the single
          // remaining match, or text that names one exactly. Focusing the
          // field opens the full list, and Enter there must never quietly
          // swap a committed selection for the first row alphabetically.
          if (open && shown.length && active >= 0) {
            event.preventDefault()
            return choose(shown[active])
          }
          // Text agreeing with the committed selection is a plain form
          // submit, not a re-pick (a re-pick would clear the chosen model).
          const committed = selectedItem()
          if (committed && input.value === committed.name) return close()
          if (open && shown.length === 1) {
            event.preventDefault()
            return choose(shown[0])
          }

          // Text that names one make outright, by the same rules as
          // preselection ("citroen", "VW"); a typo is not a choice.
          const exact = findMake(items, input.value)
          if (exact) {
            event.preventDefault()
            return choose(exact)
          }
          // No choice made: restore before the form submits, so the value it
          // carries is the one the field visibly shows.
          restoreSelected()
          close()
        }
      })

      this.combobox = {
        setItems(next) { items = next },
        display(item) { showSelected(item) },
        sync() { restoreSelected() },
        destroy() {
          if (blurTimer) clearTimeout(blurTimer)
          if (observer) observer.disconnect()
          labels.forEach((label) => {
            if (label.htmlFor === inputId) label.htmlFor = select.id
          })
          wrap.replaceWith(select)
          select.style.display = originalDisplay
          select.required = originalRequired
        }
      }
    }

    notify() {
      this.syncId()
      const value = this.value
      // A DOM event too, for hosts that listen rather than pass callbacks
      // (a Stimulus action: `make-model-dropdown:change->vehicle#picked`).
      const View = this.makeSelect.ownerDocument.defaultView
      if (View && View.CustomEvent) {
        this.makeSelect.dispatchEvent(new View.CustomEvent("make-model-dropdown:change", {
          bubbles: true, detail: Object.assign({}, value, { id: this.currentId() || null })
        }))
      }
      if (typeof this.config.onChange !== "function") return

      try {
        this.config.onChange(value)
      } catch (error) {
        // A consumer bug is not an API failure: onError promises errors with
        // .status/.code, and handlers switching on those would misroute this.
        // Log it whole (stack included) without interrupting the widget.
        console.error("[VehiclesDropdown] onChange callback failed", error)
      }
    }

    // The canonical id of the selected model ("" for none, Other, or a kept
    // value: an unresolved string has no id, and guessing one would store a
    // wrong answer).
    currentId() {
      const model = this.selectedModel()
      if (!model) return ""
      return model.kept ? model.id : modelId(this.modelsMake, model)
    }

    syncId() {
      if (!this.idInput) return
      const id = this.currentId()
      if (this.idInput.value === id) return
      this.idInput.value = id
      // Hosts that watch the field (validation, autosave) hear the change.
      this.idInput.dispatchEvent(new Event("input", { bubbles: true }))
      this.idInput.dispatchEvent(new Event("change", { bubbles: true }))
    }

    fail(error) {
      if (typeof this.config.onError === "function") {
        try {
          this.config.onError(error)
        } catch (callbackError) {
          console.warn("[VehiclesDropdown] onError callback failed", callbackError)
        }
      } else console.warn("[VehiclesDropdown]", error.message)
    }

    get value() {
      const value = {
        make: this.makeSelect.value || null,
        model: this.modelSelect ? (this.modelSelect.value || null) : null
      }
      // `year` exists only when a year select does: {make, model} consumers
      // keep the exact shape they were written against. A year is a number;
      // the escape hatch reports otherValue like make and model do.
      if (this.yearSelect) {
        const year = this.yearSelect.value
        value.year = !year ? null : year === this.config.otherValue ? year : Number(year)
      }
      // `id` likewise exists only when an idInput does.
      if (this.idInput) value.id = this.currentId() || null
      return value
    }

    destroy() {
      if (this.destroyed) return
      this.destroyed = true
      this.makeSelect.removeEventListener("change", this.handleMakeChange)
      if (this.modelSelect) this.modelSelect.removeEventListener("change", this.handleModelChange)
      if (this.yearSelect) {
        this.yearSelect.removeEventListener("change", this.handleYearChange)
        this.disableYear(false)
      }
      this.form?.removeEventListener("reset", this.handleFormReset)
      if (this.combobox) this.combobox.destroy()
      if (this.attributionEl) this.attributionEl.remove()
      this.objectUrls.forEach((url) => URL.revokeObjectURL(url))
      this.objectUrls.clear()
      this.logoUrls.clear()
    }
  }

  return {
    attach(options) { return new Instance(options) },
    // The contract's matching, for hosts that build their own typeahead or
    // need to map a stored value to a record the same way the widget does.
    norm,
    findMake,
    findModel,
    version: "0.4.0"
  }
})
