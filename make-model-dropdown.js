/*!
 * VehiclesDropdown — the car make and model dropdown.
 * https://vehiclesdb.com/make-and-model-dropdown
 *
 * A dependent make → model picker for any web page, powered by the VehiclesDB
 * API: 14,000+ models across 850+ makes (cars, motorcycles, mopeds, vans,
 * trucks, buses), reconciled from official registers of 14 countries.
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
    values: "slug",        // what option values hold: "slug" | "name"
    includeOther: false,   // append an "Other / not listed" escape hatch
    logos: false,          // render make logos (combobox mode only)
    search: false,         // searchable combobox instead of a plain <select>
    attribution: true,     // "Vehicle data by VehiclesDB" line (CC-BY credit)
    placeholderMake: "Make",
    placeholderModel: "Model",
    onChange: null,        // ({ make, model }) => {}
    onError: null          // (error) => {}
  }

  // In-page caches — the dataset is immutable per release, so one fetch per
  // URL per pageview is the right amount of network.
  const jsonCache = new Map()
  const logoCache = new Map()

  function resolveEl(elOrSelector, name) {
    const el = typeof elOrSelector === "string" ? document.querySelector(elOrSelector) : elOrSelector
    if (!el) throw new Error(`VehiclesDropdown: ${name} element not found`)
    return el
  }

  async function fetchJSON(url, key) {
    if (jsonCache.has(url)) return jsonCache.get(url)
    const promise = fetch(url, { headers: { Authorization: `Bearer ${key}` } }).then(async (response) => {
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        const error = new Error(body.message || `VehiclesDB API answered ${response.status}`)
        error.status = response.status
        error.code = body.error
        throw error
      }
      return response.json()
    })
    jsonCache.set(url, promise)
    promise.catch(() => jsonCache.delete(url))
    return promise
  }

  // Logos need the Authorization header, and an <img src> cannot send one —
  // so fetch to a blob URL, once per make per pageview. A 404 is a normal
  // answer (partial coverage by design): cache the miss and render the chip.
  async function fetchLogo(apiBase, key, slug) {
    if (logoCache.has(slug)) return logoCache.get(slug)
    const promise = fetch(`${apiBase}/makes/${encodeURIComponent(slug)}/logo?variant=emblem`, {
      headers: { Authorization: `Bearer ${key}` }
    }).then(async (response) => {
      if (!response.ok) return null
      return URL.createObjectURL(await response.blob())
    }).catch(() => null)
    logoCache.set(slug, promise)
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
    select.replaceChildren(new Option(placeholder, ""))
    for (const item of items) {
      const value = optionValue(config, item)
      select.add(new Option(item.name, value, false, value === previous))
    }
  }

  function appendOther(select) {
    select.add(new Option("Other / not listed", "other"))
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
      if (!this.config.key) throw new Error("VehiclesDropdown: pass your publishable API key as `key` (get one free at https://vehiclesdb.com)")

      this.makeSelect = resolveEl(this.config.make, "make")
      this.modelSelect = this.config.model ? resolveEl(this.config.model, "model") : null
      this.destroyed = false

      this.handleMakeChange = () => { this.makeChanged() }
      this.handleModelChange = () => { this.notify() }
      this.makeSelect.addEventListener("change", this.handleMakeChange)
      if (this.modelSelect) this.modelSelect.addEventListener("change", this.handleModelChange)

      if (this.config.search || this.config.logos) this.enhance()
      if (this.config.attribution) {
        const anchor = (this.modelSelect || this.makeSelect).parentElement || this.makeSelect
        this.attributionEl = attributionLine(anchor)
      }

      this.loadMakes()
    }

    get api() { return this.config.apiBase.replace(/\/$/, "") }

    async loadMakes() {
      try {
        const data = await fetchJSON(`${this.api}/makes${query(this.config)}`, this.config.key)
        if (this.destroyed) return
        this.makes = data.makes
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
            this.combobox?.display(item)
          }
        }

        if (this.makeSelect.value) this.makeChanged()
      } catch (error) {
        this.fail(error)
      }
    }

    async makeChanged() {
      this.notify()
      if (!this.modelSelect) return

      const makeValue = this.makeSelect.value
      if (!makeValue || makeValue === "other") {
        fillSelect(this.modelSelect, this.config.placeholderModel, [], this.config, "")
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
        const data = await fetchJSON(url, this.config.key)
        if (this.destroyed || this.makeSelect.value !== makeValue) return
        fillSelect(this.modelSelect, this.config.placeholderModel, data.models, this.config, "")
        if (this.config.includeOther) appendOther(this.modelSelect)

        // The preselected model, applied exactly once — after that the person
        // is driving, and a make change must reset the model like always.
        if (this.config.initialModel && !this.initialModelApplied) {
          this.initialModelApplied = true
          const wanted = this.config.initialModel
          const match = data.models.find((m) => m.slug === wanted || m.name === wanted)
          if (match) {
            this.modelSelect.value = optionValue(this.config, match)
            this.notify()
          }
        }
      } catch (error) {
        this.fail(error)
      }
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
      // Inherit the host select's classes, so the combobox wears whatever the
      // page's forms wear — Tailwind, Bootstrap, hand-rolled CSS, anything.
      input.className = `vdb-combobox-input ${select.className}`.trim()

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

      function showSelected(item) {
        input.value = item.name
        if (!adornment) return
        adornment.style.display = "inline-flex"
        input.style.paddingLeft = "2.75rem"
        adornment.replaceChildren(chip(item.name))
        if (item.value) return // the escape-hatch row has no logo to fetch
        fetchLogo(self.api, self.config.key, item.slug).then((url) => {
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
          fetchLogo(self.api, self.config.key, item.slug).then((url) => {
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

      input.addEventListener("input", () => render(input.value))
      input.addEventListener("focus", () => render(input.value))
      input.addEventListener("blur", () => setTimeout(close, 100))
      input.addEventListener("keydown", (event) => {
        if (event.key === "Escape") return close()
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault()
          if (!open) return render(input.value)
          const delta = event.key === "ArrowDown" ? 1 : -1
          return setActive((active + delta + shown.length) % shown.length)
        }
        if (event.key === "Enter" && open && active >= 0) {
          event.preventDefault()
          choose(shown[active])
        }
      })

      this.combobox = {
        setItems(next) { items = next },
        display(item) { showSelected(item) },
        destroy() { wrap.replaceWith(select); select.style.display = "" }
      }
    }

    notify() {
      if (typeof this.config.onChange === "function") this.config.onChange(this.value)
    }

    fail(error) {
      if (typeof this.config.onError === "function") this.config.onError(error)
      else console.warn("[VehiclesDropdown]", error.message)
    }

    get value() {
      return {
        make: this.makeSelect.value || null,
        model: this.modelSelect ? (this.modelSelect.value || null) : null
      }
    }

    destroy() {
      this.destroyed = true
      this.makeSelect.removeEventListener("change", this.handleMakeChange)
      if (this.modelSelect) this.modelSelect.removeEventListener("change", this.handleModelChange)
      if (this.combobox) this.combobox.destroy()
      if (this.attributionEl) this.attributionEl.remove()
    }
  }

  return {
    attach(options) { return new Instance(options) },
    version: "0.1.0"
  }
})
