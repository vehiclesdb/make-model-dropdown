/*!
 * VehiclesDropdown — the car make and model dropdown.
 * https://vehiclesdb.com/make-and-model-dropdown
 *
 * A dependent make → model picker for any web page, powered by the VehiclesDB
 * API: 14,000+ models across 850+ makes (cars, motorcycles, mopeds, vans,
 * trucks, buses), reconciled from official national vehicle registers. An
 * optional third step picks the model year.
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
    apiBase: "https://vehiclesdb.com/api/v1",
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
    logos: false,          // render make logos (combobox mode only)
    search: false,         // searchable combobox instead of a plain <select>
    attribution: true,     // "Vehicle data by VehiclesDB" line (CC-BY credit)
    placeholderMake: "Make",
    placeholderModel: "Model",
    placeholderYear: "Year",
    requiredMessage: "Please select a vehicle make.", // validity message on a required make field
    onChange: null,        // ({ make, model }) => {} — plus `year` when a year select is attached
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

  function resolveEl(elOrSelector, name) {
    const el = typeof elOrSelector === "string" ? document.querySelector(elOrSelector) : elOrSelector
    if (!el) throw new Error(`VehiclesDropdown: ${name} element not found`)
    if (el.tagName !== "SELECT" || el.multiple) {
      throw new Error(`VehiclesDropdown: ${name} must be a single-select <select> element`)
    }
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

  function fillSelect(select, placeholder, items, config, selected) {
    const previous = selected !== undefined ? selected : select.value
    select.replaceChildren(new Option(placeholder, "", previous === "", previous === ""))
    for (const item of items) {
      const value = optionValue(config, item)
      select.add(new Option(item.name, value, value === previous, value === previous))
    }
  }

  function appendOther(select) {
    select.add(new Option("Other / not listed", "other"))
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
      if (typeof this.config.key !== "string" || !this.config.key.trim()) {
        throw new Error("VehiclesDropdown: pass your publishable API key as `key` (get one free at https://vehiclesdb.com)")
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

      this.loadMakes()
    }

    get api() { return this.config.apiBase.replace(/\/$/, "") }

    async loadMakes() {
      try {
        const data = await fetchJSON(`${this.api}/makes${query(this.config)}`, this.config.key, "makes")
        if (this.destroyed) return
        this.makes = data.makes
        const preselected = this.makeSelect.value
        fillSelect(this.makeSelect, this.config.placeholderMake, data.makes, this.config)
        if (this.config.includeOther) appendOther(this.makeSelect)
        if (this.combobox) this.combobox.setItems(data.makes)

        // The preselected make (slug or name, forgiving): set the form value
        // and let the combobox show the name and the badge.
        if (this.config.initialMake && !this.makeSelect.value) {
          const wanted = this.config.initialMake
          const item = data.makes.find((m) => m.slug === wanted || m.name === wanted)
          if (item) {
            this.makeSelect.value = optionValue(this.config, item)
            Array.from(this.makeSelect.options).forEach((option) => {
              option.defaultSelected = option.value === this.makeSelect.value
            })
            this.combobox?.display(item)
          }
        }

        this.combobox?.sync()

        if (this.makeSelect.value) this.makeChanged()
        else if (preselected && preselected !== "other") {
          // A server-rendered selection that the fetched list does not carry
          // (filtered out by kind/country/topMakes, or simply unknown) has
          // just been dropped. Say so: the consumer's own state still holds
          // the old value, and a silent empty submit is the worst outcome.
          console.warn(`[VehiclesDropdown] preselected make ${JSON.stringify(preselected)} is not in the fetched list; selection cleared`)
          this.notify()
        }
      } catch (error) {
        if (!this.destroyed) this.fail(error)
      }
    }

    async makeChanged() {
      // CLEAR THE MODEL BEFORE ANNOUNCING. The old model belongs to the old
      // make, so reporting {make: "suzuki", model: "golf"} for the moment
      // between the change and the fetch is not a lag, it is a wrong answer —
      // and onChange consumers write it straight into their form state.
      // The year belongs to the old model, so it goes with it.
      this.models = null
      if (this.modelSelect) {
        fillSelect(this.modelSelect, this.config.placeholderModel, [], this.config, "")
      }
      if (this.yearSelect) this.fillYears()
      this.notify()
      if (this.destroyed) return
      if (!this.modelSelect) return

      const makeValue = this.makeSelect.value
      if (!makeValue || makeValue === "other") {
        if (makeValue === "other" && this.config.includeOther) appendOther(this.modelSelect)
        return
      }

      // `values: "name"` still needs the slug for the URL — look it up.
      const make = this.makes?.find((m) => optionValue(this.config, m) === makeValue)
      const slug = make ? make.slug : makeValue

      try {
        const params = new URLSearchParams()
        if (this.config.kind) params.set("kind", this.config.kind)
        if (this.config.country) params.set("country", this.config.country)
        if (this.config.order === "popular") params.set("order", "popular")
        const url = `${this.api}/makes/${encodeURIComponent(slug)}/models?${params}`
        const data = await fetchJSON(url, this.config.key, "models")
        if (this.destroyed || this.makeSelect.value !== makeValue) return
        // The list and the select it fills are swapped TOGETHER, past the
        // stale-response guard: the year step reads its spans from this list,
        // so it can only ever describe the models actually on screen.
        this.models = data.models
        fillSelect(this.modelSelect, this.config.placeholderModel, data.models, this.config, "")
        if (this.config.includeOther) appendOther(this.modelSelect)

        // The preselected model, applied exactly once — after that the person
        // is driving, and a make change must reset the model like always.
        const intendedInitialMake = !this.config.initialMake ||
          make?.slug === this.config.initialMake || make?.name === this.config.initialMake
        if (this.config.initialModel && !this.initialModelApplied && intendedInitialMake) {
          this.initialModelApplied = true
          const wanted = this.config.initialModel
          const match = data.models.find((m) => m.slug === wanted || m.name === wanted)
          if (match) {
            this.modelSelect.value = optionValue(this.config, match)
            Array.from(this.modelSelect.options).forEach((option) => {
              option.defaultSelected = option.value === this.modelSelect.value
            })
            this.modelChanged()
          }
        }
      } catch (error) {
        if (!this.destroyed && this.makeSelect.value === makeValue) this.fail(error)
      }
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

      // "Other / not listed" has no span by definition; it takes the
      // fallback like any other model the registers cannot date.
      const model = modelValue === "other"
        ? null
        : this.models?.find((m) => optionValue(this.config, m) === modelValue)
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
      if (this.config.includeOther) appendOther(select)

      // The preselected year, applied exactly once and only to its intended
      // make and model — after that the person is driving.
      const make = this.makes?.find((m) => optionValue(this.config, m) === this.makeSelect.value)
      const wantedMake = this.config.initialMake
      const wantedModel = this.config.initialModel
      const intendedInitialMake = !wantedMake || make?.slug === wantedMake || make?.name === wantedMake
      const intendedInitialModel = !wantedModel || modelValue === wantedModel ||
        model?.slug === wantedModel || model?.name === wantedModel
      if (this.config.initialYear && !this.initialYearApplied && intendedInitialMake && intendedInitialModel) {
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
        if (wanted === "other") appendOther(select)
        else if (/^\d+$/.test(wanted)) {
          const before = Array.from(select.options).find((option) =>
            option.value === "other" || (option.value && Number(option.value) < Number(wanted)))
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
        // The escape-hatch row carries its own fixed value ("other");
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
        const needle = (filter || "").trim().toLowerCase()
        const matches = needle
          ? items.filter((m) => m.name.toLowerCase().includes(needle))
          : items
        shown = matches.slice(0, 50)
        // The escape hatch rides along unfiltered: a picker should never
        // dead-end, least of all for the person whose make is not listed.
        if (self.config.includeOther) shown = shown.concat({ name: "Other / not listed", value: "other" })
        active = -1
        input.removeAttribute("aria-activedescendant")
        list.replaceChildren(...shown.map(row))
        shown.length ? openList() : close()
      }

      function selectedItem() {
        if (select.value === "other" && self.config.includeOther) {
          return { name: "Other / not listed", value: "other" }
        }
        return items.find((item) => optionValue(self.config, item) === select.value)
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

          const needle = input.value.trim().toLowerCase()
          const exact = needle && items.find((item) => item.name.toLowerCase() === needle)
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
      if (typeof this.config.onChange !== "function") return

      try {
        this.config.onChange(this.value)
      } catch (error) {
        // A consumer bug is not an API failure: onError promises errors with
        // .status/.code, and handlers switching on those would misroute this.
        // Log it whole (stack included) without interrupting the widget.
        console.error("[VehiclesDropdown] onChange callback failed", error)
      }
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
      // the escape hatch reports "other" like make and model do.
      if (this.yearSelect) {
        const year = this.yearSelect.value
        value.year = !year ? null : year === "other" ? "other" : Number(year)
      }
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
    version: "0.2.0"
  }
})
