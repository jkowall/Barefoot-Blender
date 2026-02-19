## 2026-02-18 - [Manual Label Association]
**Learning:** React components often use `div.field` wrappers where `<label>` and `<input>` are siblings, breaking accessibility unless `htmlFor` and `id` are explicitly linked.
**Action:** Use `React.useId()` to generate unique IDs for all inputs and associate them with labels, encapsulated in a reusable component like `<NumberInput />`.
