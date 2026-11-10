# Changelog

## 0.4.0

- **No API key needed: dataset mode.** `source: "dataset"` reads the open VehiclesDB release file (`dist/vehicles.json` on jsDelivr, the same file the gem and the SDKs read) once per page and filters makes and models in the browser. `version` pins a release (default `"latest"`), `datasetUrl` points at a self-hosted copy, and `data` takes the parsed file, or a subset in its shape, with no request at all. API mode is unchanged.
- **`country` in dataset mode** keeps models whose `availability` includes the country, and makes with at least one such model, like the API does. `order: "popular"` follows the country's own registration rank, then the global decile, as the API does.
- **Stored values are never blanked** (`keepUnknown`, default on). A server-rendered make or model, `initialMake`/`initialModel`, or a `setValue` call is resolved to the canonical option when the data can (name, alias, form; makes by alias), and otherwise kept as one extra selected option, so the form re-submits it unchanged. Ambiguous values are kept, not guessed. `keepUnknown: false` restores the 0.3.0 behaviour. If the model list cannot load, the stored model and id are kept.
- **`idInput`**: an `<input>` kept filled with the selected model's canonical id (`kind/make_slug/model_slug`), emptied for no model, Other or a kept value; it dispatches `input`/`change`. Its server-rendered value is read as a stored id: an id or a published former id selects that exact record first. `.value` and `onChange` carry `id` when an idInput is attached.
- **Kind collisions follow RESOLUTION.md §3a**: one nameplate in several kinds (Iveco Daily: bus, truck, van) picks the lowest `mass_decile`, then van, car, bus, truck, moped, motorcycle, then the id, among the widget's scoped list only. The old car-first preference is gone. The selected option (not its value) decides the id, so the three Daily rows stay distinct.
- **ES module build** `make-model-dropdown.mjs`: one self-contained file that browsers, Rails importmap (`bin/importmap pin make-model-dropdown`) and jspm can load. `import "make-model-dropdown"` now resolves to it; `index.mjs` re-exports it. The UMD file still serves `<script>` and `require`. README: a Rails importmap + Stimulus recipe.
- **Picking the Other make now chooses the Other model** (with `includeOther`): it is the only model there is, so a required model field is satisfied. In 0.3.0 the model stayed empty.
- New: `instance.setValue({make, model, year, id})`; a bubbling `make-model-dropdown:change` DOM event with `{make, model, id}` (plus `year`); `otherValue` (the Other row's value, default `"other"`); the searchable combobox follows its select's `disabled` after attach and shows a kept make.
- README pins `@0.4.0` (the `@0.2.0` pin was never published).
- Tests: dataset mode, country scope, kept values, canonical reselection, the tie-break, the id field, the ES module; the dataset's `conformance/resolve.json` strict pair cases run through the widget in CI.

## 0.3.0

- **Matching follows the VehiclesDB resolution contract**, the rules the gem, the API and the SDKs share, so a stored value picks the same record on every surface.
- The search box compares normalized text (`citroen` finds Citroën, `mercedes benz` finds Mercedes-Benz), ignores spacing (`mercedesbenz`), and also matches published make aliases (`vw` finds Volkswagen). Exact answers rank first, alias-only matches last. It used to match a lowercase substring of the name only.
- `initialMake` accepts a slug, name or published alias by the same rules. `initialModel` accepts a slug or name (spacing-blind, `Serie 3` for the 3 Series), a published alias, or a curated form (`Focus C-Max` preselects the C-Max). When the data says a value could be two records, nothing is preselected. Typos are never corrected.
- Enter on text that names one make outright (alias included) commits it.
- New exports: `VehiclesDropdown.norm`, `VehiclesDropdown.findMake` and `VehiclesDropdown.findModel`.
- Uses the `aliases` (makes and models) and `forms` (models) fields the API returns since November 2026; with older responses it matches names and slugs only, as before.

## 0.2.0

- **Model year step.** A new optional `year` select is filled from the chosen model's `years_on_record` span, newest first. Changing the make clears model and year before `onChange` fires, and changing the model refills the year before `onChange` fires. The spans come with the models list already loaded, so the year step makes no request of its own.
- New options: `year`, `placeholderYear` (default `"Year"`), `initialYear` (a server-rendered selected year works too, and form reset restores it), and `yearFallback` for models with no span: `"range"` (default, the current year back 40 years, so the field never dead-ends) or `"none"` (placeholder only, select disabled).
- `onChange` and `.value` gain `year` (a number, `null`, or `"other"` with `includeOther`) only when a year select is attached. Widgets without `year` behave exactly as in 0.1.4.
- Older API responses without `years_on_record`, and spans outside 1886 to next year, are handled the same as `null`.
- A host-supplied year outside the model's span is kept (inserted in order and selected, with one `console.warn`), never dropped.
- The widget disables the year select only for `yearFallback: "none"` with nothing to choose (with `includeOther`, Other stays choosable), and only ever undoes its own disabling.
- New option `otherLabel` (default `"Other / not listed"`): the text of the `includeOther` row on make, model and year, for pages in other languages. The option value stays `"other"`.
