# Changelog

## 0.6.0

- **Generation step** (optional, API mode). `generation: "#generation"` (or `data-generation` on a one-tag picker, `data-name-generation` for its field name, default `generation`) adds a select filled, after a model is picked, from `GET /makes/{make}/models/{model}/generations` with the same key, cache and stale-response guard as the model list, passing `kind` when the picker or the chosen model has one. Options read `"{name} ({start}–{end})"`; an open end is `"{start}–"`, an ended generation with no sourced last year `"{start}–?"`, and unknown years are left out. Values are generation ids, or names with `values: "name"`.
- Generations are part of the full records some plans include, and most models have none yet, so the step is **hidden and disabled** (the `hidden` attribute on the select, its `<label for>`, a wrapping `<label>` and an element marked `data-vdb-field="generation"`) until the chosen model has generations the key may see: never for no model, Other, a kept model, an empty list, a 403, a 404, a network error or dataset mode. A hidden step is never required and is not submitted. A `403 plan_required` logs one `console.info` per page with the response's `upgrade_url`; nothing is shown to visitors and `onError` is not called.
- With a year step too: picking the year first preselects the one generation whose span contains it (changeable); picking a generation never touches the year.
- `.value`, `onChange` and `make-model-dropdown:change` carry `generation` (`{id, name, years}` or `null`) when a generation select is attached; `initialGeneration`, `setValue({generation})` and a server-rendered option restore it (by id or name; an unknown one is kept as given). The `idInput` id is unchanged.
- Package metadata: the npm description and the README's opening line now lead with "Year, make and model dropdown", and `keywords` add `year-make-model`, `year make model`, `ymm`, `vehicle-selector`, `car-make-model`, `make-model-year`, `vehicle-dropdown` and `car-dropdown`. No behaviour change.
- `placeholderGeneration` in all eight locales: Generation, Generación, Generation, Génération, Generazione, Geração, Generacja, Generatie. Built fields' wrappers now carry `data-vdb-field="make"` (`model`, `year`, `generation`).

## 0.5.1

- **Old-data notice.** In dataset mode, a pinned release (`version: "2026.08.1"`, or a `datasetUrl` at `@v2026.08.1`) more than two months older than today logs one `console.info` per page with its age and how to stay current (omit `version`, or use `@latest`). Releases are named `YYYY.MM.PATCH`, so no request is made; nothing is shown to visitors; `latest`, no version and embedded `data` never log it.
- **Dataset-mode years.** The year step reads the release file's `registration_years` (dataset 2026.11.3+) exactly as API mode reads `years_on_record`; models without it (and older releases) keep `yearFallback`. Before, keyless pickers always offered the last 40 years.
- **Six more locales:** `de`, `fr`, `it`, `pt`, `pl`, `nl` for the placeholders and labels, the Other row, the required-make message and the credit line (`VehiclesDB` and `CC-BY 4.0` stay as they are). Region tags normalise as before (`"de-AT"` is `"de"`).
- **Minified build** `make-model-dropdown.min.js`, built from the source with terser (a devDependency; the package still has no runtime dependencies). CI and `prepublishOnly` refuse a stale copy. The default CDN URL still serves `make-model-dropdown.js`.
- **Theming hooks.** The search list's background, text colour, border, highlight, max-height and z-index, and the credit line's size and colour, read CSS custom properties (`--vdb-list-bg`, …, `--vdb-credit-color`) with the previous values as fallbacks, so nothing changes by default. Still no injected stylesheet.

## 0.5.0

- **One tag: install with no inline script.** The `<script>` build now mounts a picker in every element with `data-vehiclesdb-picker`, once when it runs and again on `DOMContentLoaded` if the page is still parsing. Options come from `data-*` attributes on the element, then on the script tag: `data-key`, `data-source`, `data-kind`, `data-country`, `data-order`, `data-top-makes`, `data-year`, `data-search`, `data-logos`, `data-locale`, `data-values`, `data-include-other`, `data-other-label`, `data-placeholder-make`/`-model`/`-year`, `data-name-make`/`-model`/`-year`, `data-id-name`, `data-required`, and `data-attribution="false"` (the existing `attribution: false`, paid plans only). Each maps to the `attach()` option of the same meaning; nothing new is configurable.
- An empty element gets labelled native selects (`<label for>`, ids unique per picker, labelled with the placeholders) wrapped in `.vdb-field`, the element gets `.vdb-picker`, and the credit line goes under the last field. No stylesheet is injected. Selects already in the element marked `data-make` / `data-model` / `data-year` (and an input marked `data-id`) are used instead.
- With no key and no `data-source`, a picker reads the open dataset (`source: "dataset"`). `attach()` is unchanged: without a key it still requires `source: "dataset"`.
- New `VehiclesDropdown.autoInit(root?)` for pickers added after load; it never mounts an element twice and returns the new instances. `destroy()` removes what auto-init built. A container that cannot mount (say `data-source="api"` with no key) is skipped with a warning.
- The ES module build and `require()` never auto-mount; they export `autoInit`. Pages that only call `attach()` see no change.

## 0.4.2

- **Logos only for makes that have one.** The API's make list carries `logo_url` (null when no logo is served); with `logos: true` the widget now requests a logo only for makes whose `logo_url` is set and shows the letter chip for the rest, with no request. A make list without the field (older API, a custom `apiBase`) is handled as before: every visible make is asked once. The logo is still fetched as the emblem variant, with the key in the Authorization header.
- **The credit line's VehiclesDB link** now points at the picker's page, `https://vehiclesdb.com/make-and-model-dropdown?utm_source=widget&utm_medium=credit`, so visits from the credit can be counted. Nothing about the embedding site or its visitors is added. The wording, the licence link, `attribution: false` and `attributionText` are unchanged.

## 0.4.1

- **A server-rendered slice as `data`.** The Ruby gem's `Vehicles.dataset_slice(kind:, country:)` (vehicles 0.9.2) writes one scope of the release (Spain's cars: ~300 KB, ~50 KB gzipped) in the `dist/vehicles.json` shape; passed as `data`, the widget makes no request and resolves stored values, forms, aliases and former ids against it as it would against the release. README: a Rails recipe that embeds it in the page. A test runs a gem-produced slice (`test/fixtures/gem-slice-car-ie.json`) through the widget.
- **Localized credit line.** `locale: "es"` renders "Datos de vehículos de VehiclesDB (CC-BY 4.0)" and sets Spanish defaults for the placeholders, the Other label and the required-make message (`"en"` is the default; `"es-ES"` reads as `"es"`; options you pass win). `attributionText` takes your own wording as a template with `{source}` and `{license}`; both are required, so the VehiclesDB credit and the licence link cannot be dropped (a template without them falls back to the locale's line, with a warning). The template is text, not HTML.
- The credit line now links "CC-BY 4.0" to the licence (it was plain text).
- An option passed as `undefined` now counts as not passed, so it keeps its default instead of overwriting it.

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
