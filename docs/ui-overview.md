# UI Overview

This quick-reference outlines the visual flow and interaction model for Barefoot Blender.

## Layout

- **First-Run Safety Acknowledgement** – Blocks first use until the user acknowledges the app is for trained divers/fill operators and final gas must be analyzed.
- **Header** – Displays application title and a primary "Settings" button.
- **Tab Bar** – Four main tabs: `Standard Blend`, `Top-Off What-If`, `Multi-Gas Blend`, `Utilities`. The active tab is highlighted.
- **Content Area** – Stacked cards for inputs and results. Each tab renders its own component under `src/components/`.
- **Settings Panel** – Modal-like overlay triggered from the header. Contains global configuration grouped by sections.
- **Footer** – Shows version, a persistent `Training Mode` toggle, release notes, GitHub, privacy, terms, and support links.

## Native Mobile Access

- Browser/PWA usage opens after the first-run safety acknowledgement.
- Native iOS and Android builds check the RevenueCat `pro` entitlement before showing calculator tabs.
- Local debug native builds created with `npm run build:mobile:debug` bypass the subscription gate for simulator/device testing.
- The native paywall shows the annual price, auto-renewal language, functional privacy and EULA links, restore purchases, and manage subscription actions.

## Tab Details

### Standard Blend

Order of content:
1. **Start Tank** card – Inputs for starting mix and pressure (unit-aware). Blur events clamp values into valid ranges.
2. **Tank Context** card – Per-fill tank volume, rated pressure, derived PSI/cu ft, and free gas liters.
3. **Target Blend** card – Desired mix and pressure inputs.
4. **Top-Off Gas** card – Selector for Air/O₂/He plus custom banked gases; includes the `Calculate` button.
5. **Blend Plan** card – Appears after calculation. Shows ordered steps, bleed instructions, warnings, errors, and fill cost by PSI, cu ft, and free gas liters. When `GERG-2008` is selected, the corrected stops become the primary visible fill plan and include initial, settled, and per-stage temperature inputs for measured cylinder temperatures. Stage temperatures default to the initial temperature and propagate to following unedited stops when changed. When `Training Mode` is on, it shows the hand-fill worksheet: pressure-percent points, helium first, oxygen add, top-off, and the pressure check.

### Top-Off What-If

1. **Start Tank** card – Current mix and pressure.
2. **Tank Context** card – Per-fill tank volume and rated pressure for cost and volume conversion.
3. **Top-Off Goal** card – Final pressure.
4. **Top-Off Gas** card – Selected top-off source.
5. **Top-Off Outcome** card – Final mix, added pressure, added volume, and estimated fill cost. When `Training Mode` is on, it explains the pressure-percent hand check for O2, He, and N2 with visual formula cards.
6. **Bleed-Down What-If** and **Top-Off Sensitivity** cards – Optional projections for drain scenarios and alternate starts.

### Multi-Gas Blend

1. **Start Tank** card – Starting mix and pressure for partial fills.
2. **Tank Context** card – Per-fill tank volume and rated pressure.
3. **Source Gases** card – Selectors with optional custom source gases and bank pressure limits.
4. **Target Blend** card – Oxygen, helium, and final pressure fields.
5. **Blend Options** card – Ranked alternatives, fill order, added PSI, cu ft, free gas liters, and estimated cost. When `Training Mode` is on, it shows visual formula cards for the needed added gas worksheet and a Pearson-square style check for two-source nitrox cases, falling back to pressure-percent source checks for more complex mixes.

### Utilities

Cards pair input controls with calculated output:
- Maximum Operating Depth (shows working & contingency values).
- Equivalent Air Depth.
- Best Mix.
- Equivalent Narcotic Depth (notes narcotic oxygen policy).
- Gas Density.
- Tank Conversion for PSI, cu ft, and free gas liters based on tank volume and rated pressure.
- Unit Converter for depth and pressure units.

When `Training Mode` is on, the utility cards show the formulas and current substitutions for MOD, EAD, Best Mix, END, gas density, and tank conversion.

## Settings Panel

Sections:
1. **Units** – Pressure (PSI/bar) and depth (ft/m).
2. **Defaults** – Max and contingency PPO₂.
3. **Equivalent Narcotic Gas** – Toggle for oxygen narcotic behavior.
4. **Custom Banked Gases** – Editable list with name, O₂ %, He %, and delete/add controls.
5. **Pricing** – Gas prices and tank defaults used to initialize per-fill tank context.
6. **About** – Safety warning and native subscription summary.

Actions are persisted immediately through the Zustand store; closing the panel hides the overlay without resetting values.

## Interaction Patterns

- Inputs predominantly use native number fields with step sizes tuned for PSI vs. bar and feet vs. meters.
- Error, warning, and success messages display inline within their respective cards.
- Charts and lists render only when state is meaningful, keeping the UI compact for mobile.
- Training Mode is off by default, persists through settings storage, and adds explanatory panels only under existing results.

Designer/developer notes:
- Global styles live in `src/index.css`. Cards use consistent spacing and a dark theme suitable for a fill station environment.
- Buttons and inputs are intentionally large to improve touch accuracy.
