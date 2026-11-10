# Car, motorcycle and truck make and model dropdown

> **Get your free key, the integration guide and the credit snippet at [vehiclesdb.com](https://vehiclesdb.com/users/sign_up?for=picker&cta=readme_make_model_dropdown)**

**The make/model picker you stopped hand-maintaining.** `make-model-dropdown` turns two `<select>` elements into a dependent make → model dropdown, populated live from the [VehiclesDB API](https://vehiclesdb.com/api) or, with no API key at all, from the open VehiclesDB dataset: **every make and model in the dataset** (live counts on [vehiclesdb.com/makes](https://vehiclesdb.com/makes)), six vehicle kinds — cars, motorcycles (motorbikes), mopeds, vans, trucks and buses — reconciled from official national vehicle registers and refreshed monthly. One `kind` option turns the same widget into a car picker, a motorcycle picker or a truck picker.

Zero dependencies. No build step. Works with plain HTML forms, React, Vue, Rails (importmap + Stimulus included), anything that renders a `<select>`.

**[Live demo and docs →](https://vehiclesdb.com/make-and-model-dropdown)**

## Quick start

Get a free publishable API key at [vehiclesdb.com](https://vehiclesdb.com/settings/api-keys) (it is safe to ship in page source; lock it to your domain in Settings), then:

```html
<select id="make"></select>
<select id="model"></select>

<script src="https://cdn.jsdelivr.net/npm/make-model-dropdown@0.4.1"></script>
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

### npm

```bash
npm install make-model-dropdown
```

```js
import VehiclesDropdown from "make-model-dropdown"

VehiclesDropdown.attach({ key: "vdb_pk_your_key", make: "#make", model: "#model" })
```

`import` loads `make-model-dropdown.mjs`, a self-contained ES module (no imports of its own); `require` and `<script>` load the UMD file `make-model-dropdown.js`.

### Rails (importmap + Stimulus)

```bash
bin/importmap pin make-model-dropdown
```

or pin the ES module from the CDN in `config/importmap.rb`:

```ruby
pin "make-model-dropdown", to: "https://cdn.jsdelivr.net/npm/make-model-dropdown@0.4.1/make-model-dropdown.mjs"
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
  yearFallback: "range",   // a model with no register span: "range" (default) or "none"
  values: "slug",          // option values: "slug" (default) or "name"
  includeOther: true,      // append "Other / not listed" — pickers should never dead-end (Other make → Other model)
  otherLabel: "Other / not listed", // its text, to translate
  otherValue: "other",     // its value (default "other"), e.g. the word your app stores
  keepUnknown: true,       // keep a stored value the list does not carry (default), see below

  search: true,            // searchable combobox instead of a plain select
  logos: true,             // make logos in the list (search mode; free key feature)

  locale: "en",            // "en" (default) or "es": default wording for the strings below
  placeholderMake: "Make",
  placeholderModel: "Model",
  placeholderYear: "Year",
  attribution: true,       // the CC-BY credit line (keep it on — see below)
  attributionText: null,   // its wording, e.g. "Datos: {source} ({license})" (see Attribution)

  onChange: ({ make, model, year, id }) => {}, // `year`/`id` only with a year select/idInput
  onError: (error) => {}
})
```

`attach` returns an instance with `.value` (`{ make, model }`, plus `year` with a year select and `id` with an idInput), `.setValue({ make, model, year, id })` (puts stored values on the selects by the rules below; returns a promise) and `.destroy()`. Every change also dispatches a bubbling `make-model-dropdown:change` event on the make select whose `detail` is `{ make, model, id }` (plus `year`), so a Stimulus action can listen for it.

### Model year

Booking and quote forms ask for the year, so the widget can fill a third `<select>`:

```js
VehiclesDropdown.attach({ key: "vdb_pk_your_key", make: "#make", model: "#model", year: "#year" })
```

Picking a model fills the year select from that model's span, newest first (most bookings are for recent cars); changing the make clears model and year together. `onChange` then reports `{ make, model, year }`, where `year` is a number, `null` when nothing is picked, or `"other"` for the `includeOther` escape hatch, exactly like make and model. Without `year`, nothing changes: the payload stays `{ make, model }`.

The years are register years, not production years: the span runs from the first to the latest year the official registers have the model on record, which can differ from the factory's own dates.

About one model in eight has no span on record (and an "Other / not listed" model never has one). `yearFallback` decides what those models get:

- `"range"` (default): the current year back to 40 years ago. The year field never dead-ends, so a customer whose model the registers cannot date can still book.
- `"none"`: no years, for forms that would rather not offer years the registers cannot back up. With `includeOther` the select stays enabled with the placeholder and Other, so that choice can still be made; without it there is nothing to choose, so the select is disabled. The widget only ever undoes its own disabling and never overrides a `disabled` your page sets.

A year the host supplies (`initialYear`, or a server-rendered selected option in an edit form) is never dropped: if it falls outside the model's span it is added to the list in its place, selected, and logged once with `console.warn`.

No extra request is made: the spans come with the model list the widget already loads.

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

With `logos: true` (in search mode) each make renders its badge next to its name in the list, and the selected make's badge sits inside the input, the way a phone input wears its country flag. Coverage is partial by design and any marque can be withdrawn at any time, so the library always falls back to an initial-letter chip — build nothing that assumes a logo exists. Logos are third-party trademarks served for referential display; no license is granted with them.

The combobox input inherits your `<select>`'s CSS classes, so it dresses like the rest of your form with no extra styling.

### Popularity, availability, kinds

The data is the point. Every model carries a global popularity decile from real registration counts (`order: "popular"` puts the Golf first, not the 412), a per-country availability record (`country: "de"` drops what Germany has never registered), and a kind: `kind: "motorcycle"` gives you a motorbike picker with displacement-level names ("CBR600RR", not "CBR"), because that is how riders and registers both speak; `kind: "truck"` or `kind: "van"` gives fleet and logistics forms the commercial-vehicle picker they never had; `kind: "bus"` and `kind: "moped"` round out the six.

## Related

- [RESOLUTION.md](https://github.com/vehiclesdb/vehiclesdb/blob/main/RESOLUTION.md): the matching contract this widget, the Ruby gem, the API and the SDKs share. The kind-collision rule (§3a) arrived in vehiclesdb/vehiclesdb#397.
- JS SDK [`@vehiclesdb/client`](https://github.com/vehiclesdb/vehiclesdb-js) (vehiclesdb/vehiclesdb-js#1) and [Python SDK](https://github.com/vehiclesdb/vehiclesdb-python) (vehiclesdb/vehiclesdb-python#1): the same rule server-side.

## Attribution

The vehicle identity data is [CC-BY 4.0](https://vehiclesdb.com/attribution) — free for anything, with visible credit. The widget renders the credit line for you; leave `attribution: true` and you are compliant without reading a license. Paid plans can waive display attribution.

The line reads "Vehicle data by VehiclesDB (CC-BY 4.0)", with links to vehiclesdb.com and the licence. `locale: "es"` switches it, and the widget's own strings, to Spanish:

| | `"en"` (default) | `"es"` |
|---|---|---|
| credit line | Vehicle data by VehiclesDB (CC-BY 4.0) | Datos de vehículos de VehiclesDB (CC-BY 4.0) |
| `placeholderMake` / `placeholderModel` / `placeholderYear` | Make / Model / Year | Marca / Modelo / Año |
| `otherLabel` | Other / not listed | Otro / no está en la lista |
| `requiredMessage` | Please select a vehicle make. | Selecciona la marca del vehículo. |

Region tags work (`"es-ES"` is `"es"`); an unknown locale falls back to English with a warning. Any option you pass yourself wins over the locale's default.

For other wording, `attributionText` is a template with two required slots: `{source}` (the VehiclesDB link) and `{license}` (the CC-BY 4.0 link), e.g. `"Fuente de datos: {source}, licencia {license}"`. The template is plain text, never HTML. One that drops either slot is ignored, with a warning, and the locale's line is shown instead: the credit can be translated but not removed.

## The API underneath

The widget speaks the documented Dropdown Data endpoints: [`GET /api/v1/makes`](https://vehiclesdb.com/api), `GET /api/v1/makes/{slug}/models`, and make logos. (`GET /api/v1/search` is part of the same free surface if you build your own typeahead.) They cost 0 credits and accept publishable keys, so the dropdown never spends your quota. Public keys are deliberately refused everywhere else. Use a private `vdb_sk_…` key from your backend for the rest of the [VehiclesDB API](https://vehiclesdb.com/api): resolving free-text vehicle strings, full records, imagery, and license-plate validation.

## Development

```bash
npm ci
npm test
```

The test suite runs the published UMD artifact in a real DOM implementation and covers dependent loading, the year step and its fallbacks, credential-scoped caches, combobox keyboard/blur behavior, labels, callback isolation, object-URL cleanup, dataset mode, stored-value preservation, the id field and the ES module build.

`make-model-dropdown.mjs` is generated from `make-model-dropdown.js` (the UMD source): after editing the source, run `npm run build:esm`. CI and `npm publish` refuse a stale copy.

RESOLUTION conformance runs the dataset's `conformance/resolve.json` through the widget (CI does this against a pinned release):

```bash
VDB_CONFORMANCE=../vehiclesdb/conformance/resolve.json VDB_DATA=../vehiclesdb/dist/vehicles.json node --test test/conformance.test.js
```

## License

MIT for this library. Data: identity layer CC-BY 4.0, enrichment proprietary — see [vehiclesdb.com/attribution](https://vehiclesdb.com/attribution).

## Releasing (maintainers)

1. Bump `version` in `package.json` AND the `version:` string in `make-model-dropdown.js`, keep them equal, then `npm run build:esm`. Update the `@x.y.z` pins in this README.
2. Re-vendor the dist into the website and verify the two files are byte-for-byte identical. The website's system test drives that copy against the real API, so a broken dist fails its CI.
3. `npm publish` (owner ritual, like gem releases).
