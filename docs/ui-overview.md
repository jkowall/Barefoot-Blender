# UI Overview

This quick-reference outlines the visual flow and interaction model for Barefoot Blender.

## Layout

- **Header** – Displays application title and a primary "Settings" button.
- **Tab Bar** – Four main tabs: `Standard Blend`, `Top-Off What-If`, `Multi-Gas Blend`, `Utilities`. The active tab is highlighted.
- **Content Area** – Stacked cards for inputs and results. Each tab renders its own component under `src/components/`.
- **Settings Panel** – Modal-like overlay triggered from the header. Contains global configuration grouped by sections.

## Tab Details

### Standard Blend

Order of content:
1. **Start Tank** card – Inputs for starting mix and pressure (unit-aware). Blur events clamp values into valid ranges.
2. **Tank Context** card – Per-fill tank volume, rated pressure, derived PSI/cu ft, and free gas liters.
3. **Target Blend** card – Desired mix and pressure inputs.
4. **Top-Off Gas** card – Selector for Air/O₂/He plus custom banked gases; includes the `Calculate` button.
5. **Blend Plan** card – Appears after calculation. Shows ordered steps, bleed instructions, warnings, errors, and fill cost by PSI, cu ft, and free gas liters.

### Top-Off What-If

1. **Start Tank** card – Current mix and pressure.
2. **Tank Context** card – Per-fill tank volume and rated pressure for cost and volume conversion.
3. **Top-Off Goal** card – Final pressure.
4. **Top-Off Gas** card – Selected top-off source.
5. **Top-Off Outcome** card – Final mix, added pressure, added volume, and estimated fill cost.
6. **Bleed-Down What-If** and **Top-Off Sensitivity** cards – Optional projections for drain scenarios and alternate starts.

### Multi-Gas Blend

1. **Start Tank** card – Starting mix and pressure for partial fills.
2. **Tank Context** card – Per-fill tank volume and rated pressure.
3. **Source Gases** card – Selectors with optional custom source gases and bank pressure limits.
4. **Target Blend** card – Oxygen, helium, and final pressure fields.
5. **Blend Options** card – Ranked alternatives, fill order, added PSI, cu ft, free gas liters, and estimated cost.

### Utilities

Cards pair input controls with calculated output:
- Maximum Operating Depth (shows working & contingency values).
- Equivalent Air Depth.
- Best Mix.
- Equivalent Narcotic Depth (notes narcotic oxygen policy).
- Gas Density.
- Tank Conversion for PSI, cu ft, and free gas liters based on tank volume and rated pressure.
- Unit Converter for depth and pressure units.

## Settings Panel

Sections:
1. **Units** – Pressure (PSI/bar) and depth (ft/m).
2. **Defaults** – Max and contingency PPO₂.
3. **Equivalent Narcotic Gas** – Toggle for oxygen narcotic behavior.
4. **Custom Banked Gases** – Editable list with name, O₂ %, He %, and delete/add controls.
5. **Pricing** – Gas prices and tank defaults used to initialize per-fill tank context.

Actions are persisted immediately through the Zustand store; closing the panel hides the overlay without resetting values.

## Interaction Patterns

- Inputs predominantly use native number fields with step sizes tuned for PSI vs. bar and feet vs. meters.
- Error, warning, and success messages display inline within their respective cards.
- Charts and lists render only when state is meaningful, keeping the UI compact for mobile.

Designer/developer notes:
- Global styles live in `src/index.css`. Cards use consistent spacing and a dark theme suitable for a fill station environment.
- Buttons and inputs are intentionally large to improve touch accuracy.
