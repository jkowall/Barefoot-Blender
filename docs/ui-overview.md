# UI Overview

This quick-reference outlines the visual flow and interaction model for Barefoot Blender.

## Layout

- **Header** – Displays application title and a primary "Settings" button.
- **Tab Bar** – Three main tabs: `Standard Blend`, `Multi-Gas Blend`, `Utilities`. The active tab is highlighted.
- **Content Area** – Stacked cards for inputs and results. Each tab renders its own component under `src/components/`.
- **Settings Panel** – Modal-like overlay triggered from the header. Contains global configuration grouped by sections.

## Tab Details

### Standard Blend

Order of content:
1. **Start Tank** card – Inputs for starting mix and pressure (unit-aware). Blur events clamp values into valid ranges.
2. **Target Blend** card – Desired mix and pressure inputs.
3. **Top-Off Gas** card – Selector for Air/O₂/He plus custom banked gases; includes the `Calculate` button.
4. **Blend Plan** card – Appears after calculation. Shows ordered steps, bleed instructions, warnings, or errors.
5. **Top-Off Chart** card – Appears when a top-off is calculated without bleed-down; tabular view of alternate start pressures.

### Multi-Gas Blend

1. **Source Gases** card – Two selectors with optional custom oxygen inputs when "Custom" is chosen.
2. **Target Blend** card – Oxygen percentage and final pressure fields plus the `Calculate` button.
3. **Fill Plan** card – Ordered list of gas additions or an error message.

### Utilities

Five cards, each pairing input controls with calculated output:
- Maximum Operating Depth (shows working & contingency values).
- Equivalent Air Depth.
- Best Mix.
- Equivalent Narcotic Depth (notes narcotic oxygen policy).
- Gas Density.

## Settings Panel

Sections:
1. **Units** – Pressure (PSI/bar) and depth (ft/m).
2. **Defaults** – Max and contingency PPO₂.
3. **Equivalent Narcotic Gas** – Toggle for oxygen narcotic behavior.
4. **Custom Banked Gases** – Editable list with name, O₂ %, He %, and delete/add controls.

Actions are persisted immediately through the Zustand store; closing the panel hides the overlay without resetting values.

## Interaction Patterns

- Inputs predominantly use native number fields with step sizes tuned for PSI vs. bar and feet vs. meters.
- Error, warning, and success messages display inline within their respective cards.
- Charts and lists render only when state is meaningful, keeping the UI compact for mobile.

Designer/developer notes:
- Global styles live in `src/index.css`. Cards use consistent spacing and a dark theme suitable for a fill station environment.
- Buttons and inputs are intentionally large to improve touch accuracy.
