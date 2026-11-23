# Car, motorcycle and truck make and model dropdown

> **Get your free key, the integration guide and the credit snippet at [vehiclesdb.com](https://vehiclesdb.com/users/sign_up?for=picker&cta=readme_make_model_dropdown)**

**The make/model picker you stopped hand-maintaining.** `make-model-dropdown` turns two `<select>` elements into a dependent make → model dropdown, populated live from the [VehiclesDB API](https://vehiclesdb.com/api) or, with no API key at all, from the open VehiclesDB dataset: **every make and model in the dataset** (live counts on [vehiclesdb.com/makes](https://vehiclesdb.com/makes)), six vehicle kinds — cars, motorcycles (motorbikes), mopeds, vans, trucks and buses — reconciled from official national vehicle registers and refreshed monthly. One `kind` option turns the same widget into a car picker, a motorcycle picker or a truck picker.

Zero dependencies. No build step. Works with plain HTML forms, React, Vue, Rails (importmap + Stimulus included), anything that renders a `<select>`.

**[Car make and model dropdown: live demo and docs →](https://vehiclesdb.com/make-and-model-dropdown)**

## One tag

Paste this where the picker should appear. No account, no key, no script of your own:

```html
<div data-vehiclesdb-picker data-kind="car"></div>
<script src="https://cdn.jsdelivr.net/npm/make-model-dropdown@0.6.0" defer></script>
```

The script finds every element with `data-vehiclesdb-picker`, builds a labelled make `<select>` and model `<select>` inside it (named `make` and `model`, so they submit with the surrounding form), and fills them from the open dataset (one request of about 0.6 MB compressed, shared by every picker on the page). The credit line goes under the last field.

With a free key from [vehiclesdb.com](https://vehiclesdb.com/users/sign_up?for=picker&cta=readme_make_model_dropdown) the same block reads the API instead: a make list of about 8 KB gzipped instead of the dataset file, make logos, the most-registered makes first (`data-top-makes`), and your picker's traffic on your dashboard.

```html
<div data-vehiclesdb-picker data-key="vdb_pk_your_key" data-kind="car" data-country="es"
     data-year data-search data-logos data-id-name="vehiclesdb_id"></div>
<script src="https://cdn.jsdelivr.net/npm/make-model-dropdown@0.6.0" defer></script>
```

Each attribute is the `attach()` option of the same meaning (see [Options](#options)). An attribute missing on the element is read from the `<script>` tag, so `<script src=… data-key="vdb_pk_…">` configures every picker on the page.

| Attribute | Option | Notes |
|---|---|---|
| `data-key` | `key` | your publishable key |
| `data-source` | `source` | `api` or `dataset`; with no key and no source, `dataset` |
| `data-kind` | `kind` | `car`, `motorcycle`, `moped`, `van`, `truck`, `bus` |
| `data-country` | `country` | two-letter code |
| `data-order` | `order` | `popular` (default) or `alphabetical` |
| `data-top-makes` | `topMakes` | API only |
| `data-year` | `year` | present: add the model-year step |
| `data-generation` | `generation` | present: add the generation step (API key on a plan with full records; hidden otherwise, see [Generation](#generation)) |
| `data-search` | `search` | present: searchable combobox |
| `data-logos` | `logos` | present: make logos (search mode, needs a key) |
| `data-locale` | `locale` | `en`, `es`, `de`, `fr`, `it`, `pt`, `pl` or `nl`: default labels, placeholders and the credit line |
| `data-values` | `values` | `slug` (default) or `name` |
| `data-include-other` | `includeOther` | present: the "Other / not listed" row |
| `data-other-label` | `otherLabel` | its text |
| `data-placeholder-make`, `data-placeholder-model`, `data-placeholder-year`, `data-placeholder-generation` | `placeholderMake`, … | also the built fields' labels |
| `data-name-make`, `data-name-model`, `data-name-year`, `data-name-generation` | | the fields' `name`s (default `make`, `model`, `year`, `generation`) |
| `data-id-name` | `idInput` | adds a hidden input with this name, kept filled with `kind/make/model` |
| `data-required` | | marks the built fields `required` |
| `data-attribution="false"` | `attribution: false` | paid plans only, as with `attach()`; free use keeps the credit line |

A boolean attribute is on when present and off when it is absent or `"false"`.

**Your own fields.** If the element already holds selects marked `data-make`, `data-model` and (optionally) `data-year` and `data-generation`, and an input marked `data-id`, the widget uses those instead of building its own, so your labels, classes and server-rendered values stay as they are:

```html
<div data-vehiclesdb-picker data-kind="car">
  <label for="car_make">Make</label>  <select id="car_make" name="car[make]" data-make></select>
  <label for="car_model">Model</label> <select id="car_model" name="car[model]" data-model></select>
</div>
```

**Styling.** The element gets the class `vdb-picker` and each built field (label and select) is wrapped in `<div class="vdb-field" data-vdb-field="make">` (`model`, `year`, `generation`); no stylesheet is injected, so your page's CSS styles them (the search list and the credit line also read a few CSS custom properties, see [Theming](#theming)). Ids are unique per picker, so several pickers can share a page.

**Pages that add pickers later** (single-page apps, Turbo): call `VehiclesDropdown.autoInit(root)` after inserting the element; it mounts what is new under `root` (default: the document) and never mounts an element twice. It returns the new instances; `instance.destroy()` removes what the widget built, after which the element can be mounted again. The ES module build (`import`) never mounts on import: call `autoInit()` yourself. Only the `<script>` build mounts by itself.

## Quick start

Get a free publishable API key at [vehiclesdb.com](https://vehiclesdb.com/settings/api-keys) (it is safe to ship in page source; lock it to your domain in Settings), then:

```html
<select id="make"></select>
<select id="model"></select>

<script src="https://cdn.jsdelivr.net/npm/make-model-dropdown@0.6.0"></script>
<script>
  VehiclesDropdown.attach({
    key: "vdb_pk_your_key",
    make: "#make",
    model: "#model"
  })
</script>
```

That is the whole integration. The make list loads once (~8 KB gzipped), the model list loads when a make is picked, and both selects submit with your form like any other field.

### No API key: the open dataset

```js
VehiclesDropdown.attach({ source: "dataset", make: "#make", model: "#model", kind: "car", country: "es" })
```

`source: "dataset"` reads the open VehiclesDB release file, [`dist/vehicles.json`](https://github.com/vehiclesdb/vehiclesdb) (CC-BY 4.0), from jsDelivr: the same file the Ruby gem and the SDKs read. It is one request per page (about 0.6 MB compressed, shared by every widget on the page), and makes and models are then filtered in the browser, with no request per make. Pin a release with `version: "2026.11.2"` (default `"latest"`), serve your own copy with `datasetUrl`, or pass the parsed file (or a subset of it in the same shape, such as your server's list of one country's cars) as `data`, which makes no request at all. The Ruby gem writes that subset for you: `Vehicles.dataset_slice(kind: :car, country: :es)` (vehicles 0.9.2+) is Spain's cars in the file's shape, about 300 KB of JSON and 50 KB gzipped (see the Rails recipe below). Logos need an API key, so keyless pages show the letter chip. `topMakes` is API-only.

#### Keeping the data current

The default, `version: "latest"`, follows the newest release, so new models and fixes reach your page the month they ship. A pinned release (`version: "2026.10.3"`, or a `datasetUrl` at `@v2026.10.3`) never changes. Releases are named `YYYY.MM.PATCH`, so when a pinned release is more than two months old the widget logs one `console.info` per page saying how old it is (no request is made for it, and visitors see nothing). Drop `version` (or point `datasetUrl` at `@latest`) to stay current; pin only when you re-test each upgrade yourself.

### npm

```bash
npm install make-model-dropdown
```

```js
import VehiclesDropdown from "make-model-dropdown"

VehiclesDropdown.attach({ key: "vdb_pk_your_key", make: "#make", model: "#model" })
```

`import` loads `make-model-dropdown.mjs`, a self-contained ES module (no imports of its own); `require` and `<script>` load the UMD file `make-model-dropdown.js`.

A minified copy of the `<script>` build, `make-model-dropdown.min.js` (same code and behaviour), is published next to it:

```html
<script src="https://cdn.jsdelivr.net/npm/make-model-dropdown@0.6.0/make-model-dropdown.min.js" defer></script>
```

The plain URL (`…/make-model-dropdown@0.6.0`) still serves the readable `make-model-dropdown.js`.

### Rails (importmap + Stimulus)

```bash
bin/importmap pin make-model-dropdown
```

or pin the ES module from the CDN in `config/importmap.rb`:

```ruby
pin "make-model-dropdown", to: "https://cdn.jsdelivr.net/npm/make-model-dropdown@0.6.0/make-model-dropdown.mjs"
```

```js
// app/javascript/controllers/vehicle_picker_controller.js
import { Controller } from "@hotwired/stimulus"
import VehiclesDropdown from "make-model-dropdown"

export default class extends Controller {
  static targets = ["make", "model", "id"]

  connect() {
    this.dropdown = VehiclesDropdown.attach({
      source: "dataset", kind: "car", country: "es",
      make: this.makeTarget, model: this.modelTarget, idInput: this.idTarget,
      values: "name", placeholderMake: "Marca", placeholderModel: "Modelo",
      includeOther: true, otherLabel: "Otro", otherValue: "Otro"
    })
  }

  disconnect() { this.dropdown.destroy() }
}
```

```erb
<div data-controller="vehicle-picker">
  <%= form.select :make, [vehicle.make].compact, {}, data: { vehicle_picker_target: "make" } %>
  <%= form.select :model, [vehicle.model].compact, {}, data: { vehicle_picker_target: "model" } %>
  <%= form.hidden_field :vehiclesdb_id, data: { vehicle_picker_target: "id" } %>
</div>
```

#### Embedding the data from the server (no CDN request)

With the [`vehicles` gem](https://github.com/vehiclesdb/vehicles) (0.9.2+), render your scope into the page and hand it to the widget as `data`: the page then makes no request for vehicle data at all, and the list is the exact release your server runs.

```ruby
# app/helpers/vehicles_helper.rb
def vehicles_dataset_json(**scope)
  Rails.cache.fetch(["vehicles/dataset_slice", Vehicles.data_version, scope]) do
    Vehicles.dataset_slice(**scope).to_json
  end
end
```

```erb
<script type="application/json" id="vehicles-data"><%= json_escape(vehicles_dataset_json(kind: :car, country: :es)).html_safe %></script>
```

```js
connect() {
  const data = JSON.parse(document.getElementById("vehicles-data").textContent)
  this.dropdown = VehiclesDropdown.attach({
    data, kind: "car", country: "es", locale: "es",
    make: this.makeTarget, model: this.modelTarget, idInput: this.idTarget
  })
}
```

Pass the same `kind`/`country` you sliced by. Parse it once per page: widgets given the same `data` object share one preparation.

Render the stored values as the selects' selected options and the widget does the rest: it fills the lists, selects the canonical record for what was stored, keeps anything it cannot resolve, and keeps the hidden field holding the canonical id (see below). With `values: "name"` the columns keep storing names; store the id next to them, because it is what stays stable when a name is respelled.

## Options

```js
VehiclesDropdown.attach({
  key: "vdb_pk_…",        // your publishable key (required unless source is "dataset")
  make: "#make",           // required — <select> element or selector
  model: "#model",         // optional — the dependent model <select>
  year: "#year",           // optional — the model-year <select> (needs `model`)
  generation: "#generation", // optional — the generation <select> (needs `model`; API key with full records)
  idInput: "#vehicle_id",  // optional — an <input> kept filled with the canonical id (needs `model`)

  source: "api",           // "api" (default, needs `key`) or "dataset" (the open file, no key)
  version: "latest",       // dataset: the release to read, e.g. "2026.11.2"
  datasetUrl: null,        // dataset: your own copy of dist/vehicles.json
  data: null,              // dataset: the parsed file, or a subset in its shape (no request)

  kind: "car",             // only one kind: car, motorcycle, moped, van, truck, bus
  country: "de",           // only vehicles evidenced in a register country
  order: "popular",        // models by real-world registrations (default) or "alphabetical"
  topMakes: 40,            // only the N most-registered makes, best first (default: all)
  initialMake: "audi",     // preselect a make on load (slug, name or alias: "VW", "citroen")
  initialModel: "a3",      // preselect a model once its make's models load (see "Matching")
  initialYear: 2019,       // preselect a year once its model's years fill
  initialGeneration: "a3-8v", // preselect a generation (id or name) once its model's generations load
  yearFallback: "range",   // a model with no register span: "range" (default) or "none"
  values: "slug",          // option values: "slug" (default) or "name"
  includeOther: true,      // append "Other / not listed" — pickers should never dead-end (Other make → Other model)
  otherLabel: "Other / not listed", // its text, to translate
  otherValue: "other",     // its value (default "other"), e.g. the word your app stores
  keepUnknown: true,       // keep a stored value the list does not carry (default), see below

  search: true,            // searchable combobox instead of a plain select
  logos: true,             // make logos in the list (search mode; free key feature)

  locale: "en",            // "en" (default), "es", "de", "fr", "it", "pt", "pl", "nl": default wording for the strings below
  placeholderMake: "Make",
  placeholderModel: "Model",
  placeholderYear: "Year",
  placeholderGeneration: "Generation",
  attribution: true,       // the CC-BY credit line (keep it on — see below)
  attributionText: null,   // its wording, e.g. "Datos: {source} ({license})" (see Attribution)

  onChange: ({ make, model, year, generation, id }) => {}, // `year`/`generation`/`id` only with those fields
  onError: (error) => {}
})
```

`attach` returns an instance with `.value` (`{ make, model }`, plus `year` with a year select, `generation` with a generation select and `id` with an idInput), `.setValue({ make, model, year, generation, id })` (puts stored values on the selects by the rules below; returns a promise) and `.destroy()`. Every change also dispatches a bubbling `make-model-dropdown:change` event on the make select whose `detail` is `{ make, model, id }` (plus `year` and `generation`), so a Stimulus action can listen for it.

### Model year

Booking and quote forms ask for the year, so the widget can fill a third `<select>`:

```js
VehiclesDropdown.attach({ key: "vdb_pk_your_key", make: "#make", model: "#model", year: "#year" })
```

Picking a model fills the year select from that model's span, newest first (most bookings are for recent cars); changing the make clears model and year together. `onChange` then reports `{ make, model, year }`, where `year` is a number, `null` when nothing is picked, or `"other"` for the `includeOther` escape hatch, exactly like make and model. Without `year`, nothing changes: the payload stays `{ make, model }`.

The years are register years, not production years: the span runs from the first to the latest year the official registers have the model on record, which can differ from the factory's own dates. In dataset mode the span is the release file's `registration_years` (releases 2026.11.3 and later), handled exactly like the API's `years_on_record`; a model without it, or an older release, takes `yearFallback`.

About one model in eight has no span on record (and an "Other / not listed" model never has one). `yearFallback` decides what those models get:

- `"range"` (default): the current year back to 40 years ago. The year field never dead-ends, so a customer whose model the registers cannot date can still book.
- `"none"`: no years, for forms that would rather not offer years the registers cannot back up. With `includeOther` the select stays enabled with the placeholder and Other, so that choice can still be made; without it there is nothing to choose, so the select is disabled. The widget only ever undoes its own disabling and never overrides a `disabled` your page sets.

A year the host supplies (`initialYear`, or a server-rendered selected option in an edit form) is never dropped: if it falls outside the model's span it is added to the list in its place, selected, and logged once with `console.warn`.

No extra request is made: the spans come with the model list the widget already loads.

### Generation

Generations ("Golf" → "Mk7 (2012–2020)") are part of the full records some VehiclesDB plans include, so this step needs an API key whose plan has them. Add a fourth `<select>`:

```html
<label for="generation">Generation</label>
<select id="generation" name="generation"></select>
```

```js
VehiclesDropdown.attach({ key: "vdb_pk_your_key", make: "#make", model: "#model", year: "#year", generation: "#generation" })
```

or `data-generation` on a one-tag picker. After a model is picked, the widget asks `GET /makes/{make}/models/{model}/generations` (with your key, and `kind` when the picker or the chosen model has one) and fills the select with the model's generations, oldest first, each labelled `"{name} ({start}–{end})"`: `"8Y (2020–)"` is still in production, `"4L (2005–?)"` has ended without a sourced last year, and a year that is not on record is left out rather than guessed. Option values are generation ids (`values: "name"` uses the names).

**The step shows only when there is something to pick.** Most models have no generations on record yet, and keys without full records are not sent them, so the step is hidden until the chosen model has generations your key may see. It stays hidden for no model, Other or a stored model the list does not carry, an empty list, a `403 plan_required`, a `404`, a network error, and in dataset mode (the open dataset has no generations; no request is made). Hidden means the `hidden` attribute on the select, on its `<label for>`, on a `<label>` wrapped around it, and on an element you mark `data-vdb-field="generation"` (the one-tag picker marks its own field wrapper), plus `disabled` on the select: a hidden step is never required and is not submitted, so your form submits as before. The widget restores `required` as your page set it when the step shows, never un-hides or enables what your page hid or disabled itself, and nothing is shown to visitors. On a `403 plan_required` it logs one `console.info` per page naming the plan requirement and the response's `upgrade_url`, and asks no more for that key on that page. While the next model's list loads, a step already on screen stays visible and disabled, so the form does not jump.

**Year and generation are independent selects.** If the visitor picks the year first, the widget preselects the generation whose span contains that year when exactly one does (a generation with an unknown bound that might contain it counts, so overlapping or uncertain spans preselect nothing); the visitor can change it, and a later year pick moves only a generation the widget chose. Picking a generation never changes the year.

`.value`, `onChange` and the change event carry `generation`: `{ id, name, years: { start, end } }` (an unknown year is `null`), or `null`. `initialGeneration`, `setValue({ …, generation })` and a server-rendered selected option restore it by id or name; one the list does not carry is kept as given, like a stored model. The `idInput` keeps the model's `kind/make/model` id unchanged: store the generation id in its own column.

### Matching typed and stored names

The widget matches text the way every VehiclesDB surface does (the Ruby gem, the API, the SDKs): one contract, so a stored value picks the same record everywhere. Names are compared after the same normalization (accents dropped, case and punctuation ignored, so `citroen` is Citroën and `mercedes benz` is Mercedes-Benz), and spacing is ignored when that still lands on one name (`XCeed` is the X Ceed).

- **Search box** (`search: true`): a make shows up when its name or one of its published aliases contains what was typed. `vw` lists Volkswagen. Exact answers come first, then name matches, then alias-only matches.
- **`initialMake`**: the make's slug, name or a published alias.
- **`initialModel`**: the model's slug or name (BMW's Spanish `Serie 3` is the 3 Series), then a published alias (`Vette` is the Corvette), then a curated form: a spelling registries and people write for that model, such as `Focus C-Max` for the C-Max. So a free-text model saved by an older form usually preselects the right row.

When the data says a value could mean two records, none of them is preselected (the value is kept as given, see below); one nameplate in several kinds is not two records (see "Kind collisions"). Typos are never corrected here: a picker that quietly fills in a guess writes a wrong answer into someone's form. (Resolve messy strings server-side with the API's `/resolve`, which reports how sure it is.)

The same functions are exported for your own typeahead or for mapping stored values: `VehiclesDropdown.norm(text)`, `VehiclesDropdown.findMake(makes, text)` and `VehiclesDropdown.findModel(models, text)`, where `makes` and `models` are the lists the API returns. Each returns the matching item or `null`.

### Stored values are never blanked

An edit form renders what the record holds, and that is not always an option in today's list: a legacy free-text model, a make outside your `kind` or `country`, a name that has been respelled. The widget treats the selects' server-rendered values (and `initialMake`/`initialModel`, and `setValue`) as stored values:

1. If the data resolves the value (by the rules above, within the scoped list), the canonical option is selected: a stored `Seat` / `Leon Sportstourer` becomes SEAT / León.
2. Otherwise the value is kept as one extra option, right under the placeholder, selected, so the form submits it unchanged until someone picks something else. That includes a value the data says could be two records: the widget does not guess. `keepUnknown: false` restores the 0.3 behaviour (cleared, with a `console.warn`).

If the model list cannot load, the stored model (and its id) are kept as they were.

### The canonical id

`idInput` names an `<input>` (a hidden field is the usual choice) that the widget keeps filled with the selected model's canonical id, `kind/make_slug/model_slug` (`car/seat/leon`), the identifier VehiclesDB records are addressed by. It is emptied when there is no model, for Other, and for a kept value that did not resolve. Changes dispatch `input` and `change` events on it. Its server-rendered value counts as a stored id: an id, or an id the record has since replaced (`former_ids`), selects that exact record, ahead of the model's name.

### Kind collisions

Some nameplates exist in several kinds (Iveco's Daily is a bus, a truck and a van). Without a `kind`, a stored "Daily" picks one record by the rule every VehiclesDB surface shares (RESOLUTION.md §3a): the lowest `mass_decile`, then van, car, bus, truck, moped, motorcycle, then the id. Only records in the widget's scope compete. Pass `kind` when you know it.

### Logos

With `logos: true` (in search mode) each make renders its badge next to its name in the list, and the selected make's badge sits inside the input, the way a phone input wears its country flag. Coverage is partial by design and any marque can be withdrawn at any time, so the library always falls back to an initial-letter chip — build nothing that assumes a logo exists. The make list says which makes have a logo (`logo_url`, `null` for none), and the widget requests logos only for those. Logos are third-party trademarks served for referential display; no license is granted with them.

The combobox input inherits your `<select>`'s CSS classes, so it dresses like the rest of your form with no extra styling.

### Theming

No stylesheet is injected. The few inline styles the widget sets read a CSS custom property first, with today's look as the fallback, so nothing changes unless you set one (on the picker, or on `:root`):

| Property | Default | Styles |
|---|---|---|
| `--vdb-list-bg` | `#fff` | the search list's background |
| `--vdb-list-color` | `inherit` | its text colour |
| `--vdb-list-border` | `1px solid #e5e7eb` | its border |
| `--vdb-list-highlight-bg` | `#f3f4f6` | the active row |
| `--vdb-list-max-height` | `16rem` | its height before it scrolls |
| `--vdb-list-z-index` | `20` | its stacking order |
| `--vdb-credit-font-size` | `.75rem` | the credit line's size |
| `--vdb-credit-color` | `#6b7280` | the credit line's colour (its links inherit it) |

```css
.vdb-picker { --vdb-list-bg: #111827; --vdb-list-color: #f9fafb; --vdb-list-highlight-bg: #374151; }
```

### Popularity, availability, kinds

The data is the point. Every model carries a global popularity decile from real registration counts (`order: "popular"` puts the Golf first, not the 412), a per-country availability record (`country: "de"` drops what Germany has never registered), and a kind: `kind: "motorcycle"` gives you a motorbike picker with displacement-level names ("CBR600RR", not "CBR"), because that is how riders and registers both speak; `kind: "truck"` or `kind: "van"` gives fleet and logistics forms the commercial-vehicle picker they never had; `kind: "bus"` and `kind: "moped"` round out the six.

## Related

- [RESOLUTION.md](https://github.com/vehiclesdb/vehiclesdb/blob/main/RESOLUTION.md): the matching contract this widget, the Ruby gem, the API and the SDKs share. The kind-collision rule (§3a) arrived in vehiclesdb/vehiclesdb#397.
- JS SDK [`@vehiclesdb/client`](https://github.com/vehiclesdb/vehiclesdb-js) (vehiclesdb/vehiclesdb-js#1) and [Python SDK](https://github.com/vehiclesdb/vehiclesdb-python) (vehiclesdb/vehiclesdb-python#1): the same rule server-side.

## Attribution

The vehicle identity data is [CC-BY 4.0](https://vehiclesdb.com/attribution) — free for anything, with visible credit. The widget renders the credit line for you; leave `attribution: true` and you are compliant without reading a license. Paid plans can waive display attribution.

The line reads "Vehicle data by VehiclesDB (CC-BY 4.0)", with links to the picker's page on vehiclesdb.com (`https://vehiclesdb.com/make-and-model-dropdown?utm_source=widget&utm_medium=credit`, tagged so we can count visits from the credit; nothing about your site or your visitors is sent) and to the licence. `locale` switches it, and the widget's own strings, to another language:

| `locale` | credit line | `placeholderMake` / `placeholderModel` / `placeholderYear` | `otherLabel` | `requiredMessage` |
|---|---|---|---|---|
| `"en"` (default) | Vehicle data by VehiclesDB (CC-BY 4.0) | Make / Model / Year | Other / not listed | Please select a vehicle make. |
| `"es"` | Datos de vehículos de VehiclesDB (CC-BY 4.0) | Marca / Modelo / Año | Otro / no está en la lista | Selecciona la marca del vehículo. |
| `"de"` | Fahrzeugdaten von VehiclesDB (CC-BY 4.0) | Marke / Modell / Baujahr | Andere / nicht aufgeführt | Bitte wählen Sie die Fahrzeugmarke aus. |
| `"fr"` | Données véhicules fournies par VehiclesDB (CC-BY 4.0) | Marque / Modèle / Année | Autre / non répertorié | Veuillez sélectionner la marque du véhicule. |
| `"it"` | Dati sui veicoli forniti da VehiclesDB (CC-BY 4.0) | Marca / Modello / Anno | Altro / non in elenco | Selezionare la marca del veicolo. |
| `"pt"` | Dados de veículos fornecidos por VehiclesDB (CC-BY 4.0) | Marca / Modelo / Ano | Outro / não listado | Selecione a marca do veículo. |
| `"pl"` | Dane o pojazdach: VehiclesDB (CC-BY 4.0) | Marka / Model / Rok | Inne / brak na liście | Proszę wybrać markę pojazdu. |
| `"nl"` | Voertuiggegevens van VehiclesDB (CC-BY 4.0) | Merk / Model / Bouwjaar | Anders / niet vermeld | Selecteer het merk van het voertuig. |

Region tags work (`"es-ES"` is `"es"`, `"de-AT"` is `"de"`, `"pt-BR"` is `"pt"`); an unknown locale falls back to English with a warning. Any option you pass yourself wins over the locale's default.

For other wording, `attributionText` is a template with two required slots: `{source}` (the VehiclesDB link) and `{license}` (the CC-BY 4.0 link), e.g. `"Fuente de datos: {source}, licencia {license}"`. The template is plain text, never HTML. One that drops either slot is ignored, with a warning, and the locale's line is shown instead: the credit can be translated but not removed.

## The API underneath

The widget speaks the documented Dropdown Data endpoints: [`GET /api/v1/makes`](https://vehiclesdb.com/api), `GET /api/v1/makes/{slug}/models`, and make logos. (`GET /api/v1/search` is part of the same free surface if you build your own typeahead.) They cost 0 credits and accept publishable keys, so the dropdown never spends your quota. Public keys are deliberately refused everywhere else. Use a private `vdb_sk_…` key from your backend for the rest of the [VehiclesDB API](https://vehiclesdb.com/api): resolving free-text vehicle strings, full records, imagery, and license-plate validation.

## Development

```bash
npm ci
npm test
```

The test suite runs the published UMD artifact in a real DOM implementation and covers the one-tag install (attributes, built and existing fields, several pickers, the script tag), dependent loading, the year step and its fallbacks, the generation step (every hidden case, the plan notice, year-first preselection), credential-scoped caches, combobox keyboard/blur behavior, labels, callback isolation, object-URL cleanup, dataset mode, stored-value preservation, the id field and the ES module build.

`make-model-dropdown.mjs` (the ES module) and `make-model-dropdown.min.js` (minified with terser, a devDependency only) are generated from `make-model-dropdown.js` (the UMD source): after editing the source, run `npm run build`. CI and `npm publish` refuse a stale copy of either.

RESOLUTION conformance runs the dataset's `conformance/resolve.json` through the widget (CI does this against a pinned release):

```bash
VDB_CONFORMANCE=../vehiclesdb/conformance/resolve.json VDB_DATA=../vehiclesdb/dist/vehicles.json node --test test/conformance.test.js
```

## License

MIT for this library. Data: identity layer CC-BY 4.0, enrichment proprietary — see [vehiclesdb.com/attribution](https://vehiclesdb.com/attribution).

## Releasing (maintainers)

1. Bump `version` in `package.json` AND the `version:` string in `make-model-dropdown.js`, keep them equal, then `npm run build`. Update the `@x.y.z` pins in this README.
2. Re-vendor the dist into the website and verify the two files are byte-for-byte identical. The website's system test drives that copy against the real API, so a broken dist fails its CI.
3. `npm publish` (owner ritual, like gem releases).
