# Car, motorcycle and truck make and model dropdown

**The make/model picker you stopped hand-maintaining.** `make-model-dropdown` turns two `<select>` elements into a dependent make → model dropdown, populated live from the [VehiclesDB API](https://vehiclesdb.com/api): **14,000+ models across 850+ makes**, six vehicle kinds — cars, motorcycles (motorbikes), mopeds, vans, trucks and buses — reconciled from the official vehicle registers of 15 countries and refreshed monthly. One `kind` option turns the same widget into a car picker, a motorcycle picker or a truck picker.

Zero dependencies. No build step. Works with plain HTML forms, React, Vue, Rails, anything that renders a `<select>`.

**[Live demo and docs →](https://vehiclesdb.com/make-and-model-dropdown)**

## Quick start

Get a free publishable API key at [vehiclesdb.com](https://vehiclesdb.com/settings/api-keys) (it is safe to ship in page source; lock it to your domain in Settings), then:

```html
<select id="make"></select>
<select id="model"></select>

<script src="https://cdn.jsdelivr.net/npm/make-model-dropdown@0.1.4"></script>
<script>
  VehiclesDropdown.attach({
    key: "vdb_pk_your_key",
    make: "#make",
    model: "#model"
  })
</script>
```

That is the whole integration. The make list loads once (~8 KB gzipped), the model list loads when a make is picked, and both selects submit with your form like any other field.

### npm

```bash
npm install make-model-dropdown
```

```js
import VehiclesDropdown from "make-model-dropdown"

VehiclesDropdown.attach({ key: "vdb_pk_your_key", make: "#make", model: "#model" })
```

## Options

```js
VehiclesDropdown.attach({
  key: "vdb_pk_…",        // required — your publishable key
  make: "#make",           // required — <select> element or selector
  model: "#model",         // optional — the dependent model <select>

  kind: "car",             // only one kind: car, motorcycle, moped, van, truck, bus
  country: "de",           // only vehicles evidenced in a register country
  order: "popular",        // models by real-world registrations (default) or "alphabetical"
  topMakes: 40,            // only the N most-registered makes, best first (default: all)
  initialMake: "audi",     // preselect a make on load (slug or name)
  initialModel: "a3",      // preselect a model once its make's models load
  values: "slug",          // option values: "slug" (default) or "name"
  includeOther: true,      // append "Other / not listed" — pickers should never dead-end

  search: true,            // searchable combobox instead of a plain select
  logos: true,             // make logos in the list (search mode; free key feature)

  placeholderMake: "Make",
  placeholderModel: "Model",
  attribution: true,       // the CC-BY credit line (keep it on — see below)

  onChange: ({ make, model }) => {},
  onError: (error) => {}
})
```

`attach` returns an instance with `.value` (`{ make, model }`) and `.destroy()`.

### Logos

With `logos: true` (in search mode) each make renders its badge next to its name in the list, and the selected make's badge sits inside the input, the way a phone input wears its country flag. Coverage is partial by design and any marque can be withdrawn at any time, so the library always falls back to an initial-letter chip — build nothing that assumes a logo exists. Logos are third-party trademarks served for referential display; no license is granted with them.

The combobox input inherits your `<select>`'s CSS classes, so it dresses like the rest of your form with no extra styling.

### Popularity, availability, kinds

The data is the point. Every model carries a global popularity decile from real registration counts (`order: "popular"` puts the Golf first, not the 412), a per-country availability record (`country: "de"` drops what Germany has never registered), and a kind: `kind: "motorcycle"` gives you a motorbike picker with displacement-level names ("CBR600RR", not "CBR"), because that is how riders and registers both speak; `kind: "truck"` or `kind: "van"` gives fleet and logistics forms the commercial-vehicle picker they never had; `kind: "bus"` and `kind: "moped"` round out the six.

## Attribution

The vehicle identity data is [CC-BY 4.0](https://vehiclesdb.com/attribution) — free for anything, with visible credit. The widget renders the credit line for you; leave `attribution: true` and you are compliant without reading a license. Paid plans can waive display attribution.

## The API underneath

The widget speaks the documented Dropdown Data endpoints: [`GET /api/v1/makes`](https://vehiclesdb.com/api), `GET /api/v1/makes/{slug}/models`, and make logos. (`GET /api/v1/search` is part of the same free surface if you build your own typeahead.) They cost 0 credits and accept publishable keys, so the dropdown never spends your quota. Public keys are deliberately refused everywhere else. Use a private `vdb_sk_…` key from your backend for the rest of the [VehiclesDB API](https://vehiclesdb.com/api): resolving free-text vehicle strings, full records, imagery, and license-plate validation.

## Development

```bash
npm ci
npm test
```

The test suite runs the published UMD artifact in a real DOM implementation and covers dependent loading, credential-scoped caches, combobox keyboard/blur behavior, labels, callback isolation, and object-URL cleanup.

## License

MIT for this library. Data: identity layer CC-BY 4.0, enrichment proprietary — see [vehiclesdb.com/attribution](https://vehiclesdb.com/attribution).

## Releasing (maintainers)

1. Bump `version` in `package.json` AND the `version:` string in `make-model-dropdown.js`, keep them equal.
2. Re-vendor the dist into the website and verify the two files are byte-for-byte identical. The website's system test drives that copy against the real API, so a broken dist fails its CI.
3. `npm publish` (owner ritual, like gem releases).
