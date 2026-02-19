## 2026-02-19 - Standardized Number Inputs
**Learning:** Found repetitive `div.field > label + input` pattern lacking programmatic label association (`htmlFor` / `id`). This reduces screen reader accessibility. Also, `selectOnFocus` behavior was manually implemented everywhere.
**Action:** Use the new `NumberInput` component which handles `useId`, label association, and `selectOnFocus` behavior consistently.
