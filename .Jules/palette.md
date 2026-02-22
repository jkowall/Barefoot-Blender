## 2026-02-19 - Standardized Number Inputs
**Learning:** Found repetitive `div.field > label + input` pattern lacking programmatic label association (`htmlFor` / `id`). This reduces screen reader accessibility. Also, `selectOnFocus` behavior was manually implemented everywhere.
**Action:** Use the new `NumberInput` component which handles `useId`, label association, and `selectOnFocus` behavior consistently.

## 2026-02-21 - Custom Input Accessibility
**Learning:** Even one-off inputs (like `UnitConverter`) need explicit `useId`, `htmlFor`, and `aria-label` to be accessible. Recreating `NumberInput` behavior manually is error-prone.
**Action:** Always verify custom inputs against `NumberInput` standards (select-on-focus, label association) or refactor to use the shared component if possible.

## 2026-02-24 - Standardized Select Inputs
**Learning:** `select` elements were often manually labeled without `htmlFor`/`id` association, hurting accessibility. Also, interactive elements (like remove buttons) inside labels are invalid HTML.
**Action:** Use the new `SelectInput` component which handles label association via `useId` and provides a `labelAction` prop for adjacent controls (like remove buttons) to keep the DOM valid and accessible.
