# Changelog

## 0.2.0

- **Model year step.** A new optional `year` select is filled from the chosen model's `years_on_record` span, newest first. Changing the make clears model and year before `onChange` fires, and changing the model refills the year before `onChange` fires. The spans come with the models list already loaded, so the year step makes no request of its own.
- New options: `year`, `placeholderYear` (default `"Year"`), `initialYear` (a server-rendered selected year works too, and form reset restores it), and `yearFallback` for models with no span: `"range"` (default, the current year back 40 years, so the field never dead-ends) or `"none"` (placeholder only, select disabled).
- `onChange` and `.value` gain `year` (a number, `null`, or `"other"` with `includeOther`) only when a year select is attached. Widgets without `year` behave exactly as in 0.1.4.
- Older API responses without `years_on_record` are handled the same as `null`.
