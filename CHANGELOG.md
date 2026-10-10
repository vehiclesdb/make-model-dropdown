# Changelog

## 0.2.0

- **Model year step.** A new optional `year` select is filled from the chosen model's `years_on_record` span, newest first. Changing the make clears model and year before `onChange` fires, and changing the model refills the year before `onChange` fires. The spans come with the models list already loaded, so the year step makes no request of its own.
- New options: `year`, `placeholderYear` (default `"Year"`), `initialYear` (a server-rendered selected year works too, and form reset restores it), and `yearFallback` for models with no span: `"range"` (default, the current year back 40 years, so the field never dead-ends) or `"none"` (placeholder only, select disabled).
- `onChange` and `.value` gain `year` (a number, `null`, or `"other"` with `includeOther`) only when a year select is attached. Widgets without `year` behave exactly as in 0.1.4.
- Older API responses without `years_on_record`, and spans outside 1886 to next year, are handled the same as `null`.
- A host-supplied year outside the model's span is kept (inserted in order and selected, with one `console.warn`), never dropped.
- The widget disables the year select only for `yearFallback: "none"` with nothing to choose (with `includeOther`, Other stays choosable), and only ever undoes its own disabling.
- New option `otherLabel` (default `"Other / not listed"`): the text of the `includeOther` row on make, model and year, for pages in other languages. The option value stays `"other"`.
