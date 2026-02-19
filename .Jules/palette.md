## 2026-02-17 - Numeric Input Precision & Accessibility
**Learning:** Calculation-heavy interfaces require consistent input behavior (auto-select on focus) to reduce user friction. This app had this pattern duplicated manually across all components, but often missed accessibility basics like label association.
**Action:** Centralize input behavior early in such apps to enforce both usability (focus handling) and accessibility (label/id association) consistently.

## 2026-02-19 - Standardized Number Inputs
**Learning:** Found repetitive `div.field > label + input` pattern lacking programmatic label association (`htmlFor` / `id`). This reduces screen reader accessibility. Also, `selectOnFocus` behavior was manually implemented everywhere.
**Action:** Use the new `NumberInput` component which handles `useId`, label association, and `selectOnFocus` behavior consistently.
