# Calculation Model

This document details the formulas and decision logic that power Barefoot Blender. The default Standard Blend planner uses ideal gas behavior (partial pressure blending) and operates in PSI internally unless otherwise noted. Standard Blend and Top-Off can optionally show GERG-2008 real-gas corrected pressures for O2/N2/He fills.

## 1. Standard Blend Planner

Module: `src/utils/calculations.ts` (`calculateStandardBlend`)

Inputs:
- Start mix (O₂ %, He %, pressure)
- Target mix (O₂ %, He %, pressure)
- Top-off gas composition

Steps:
1. Convert displayed pressures into PSI when the user is working in bar.
2. Compute net oxygen, helium, and nitrogen partial pressure deltas between start and target states.
3. Validate fractions (0 ≤ gas ≤ 100 and O₂ + He ≤ 100).
4. Solve the linear system:
   - ΔO₂ = O₂_added + O₂_top
   - ΔHe = He_added + He_top
   - ΔN₂ = N₂_top

   where top-gas fractions distribute across the added top-off pressure.
5. If the solution requires negative additions or cannot satisfy the target composition, trigger **bleed-down** search:
   - Perform a binary search on a lower start pressure.
   - Re-run the solver until a feasible plan is found.
   - Output an explicit bleed instruction (`BLEED tank down to ...`).
6. Emit warnings for hypoxic (<18% O₂) and high-oxygen (>40% O₂) mixes.

### Top-Off Efficiency Chart

Module: `projectTopOffChart`

- Re-simulates the same blend at start pressures reduced by 100/200/300 PSI (or 10/20/30 bar).
- Marks scenarios as "Drain" when infeasible or negative.
- Returns PSI values; UI reconverts to the user's unit selection.

### Top-Off What-If

Module: `src/utils/calculations.ts` (`calculateTopOffBlend`)

The ideal Top-Off path uses pressure-percent balance:

```
P_added = P_goal - P_start
F_final = (P_start * F_start + P_added * F_topoff) / P_goal
```

The same equation runs independently for O2, He, and N2, with N2 inferred as `1 - O2 - He`.

## 2. Advanced GERG-2008 Real-Gas Mode

Modules:
- `src/utils/gerg2008.ts`
- `src/utils/realGasBlend.ts`

Scope:
- Applies to Standard Blend and Top-Off when the user selects the GERG-2008 gas model.
- Covers scuba-relevant O2, N2, and He mixtures.
- Uses the O2/N2/He subset of the NIST AGA8 GERG-2008 implementation. It does not include hydrocarbon or contaminant components from the full natural-gas model.
- Keeps the ideal partial-pressure plan visible as the base workflow, then adds corrected stop pressures where applicable.

Inputs added by the UI:
- Initial gas temperature
- Settled cylinder temperature
- Optional measured stage temperatures for each corrected stop
- Tank free-gas size and rated pressure, used to infer cylinder water volume

Pressure and temperature handling:
1. Convert gauge pressure to absolute pressure:
   ```
   P_abs = (P_gauge + 14.6959488) * 6.894757293168
   ```
   where pressure is converted from PSI to kPa.
2. Convert Fahrenheit inputs to Kelvin.
3. Infer cylinder water volume from rated free gas volume:
   ```
   V_water_L = tank_cu_ft * 28.316846592 * 14.6959488 / (rated_pressure_PSI + 14.6959488)
   ```
4. Use GERG-2008 density solving to convert start and target states into total moles:
   ```
   n_total = D_mol_per_L * V_water_L
   ```
5. Convert start and target O2/He/N2 fractions into component mole counts.
6. Solve the same fill order in mole space:
   - Helium moles from the He component delta
   - Oxygen moles from the O2 component delta after top-off gas contribution
   - Top-off moles from the N2 component delta when the top-off gas contains nitrogen
7. After each gas addition, recalculate pressure from component moles, cylinder volume, and that stage's measured temperature.
8. Display corrected stop pressures. Stage temperatures default to the initial gas temperature and can be edited inline during the fill. When one stage temperature is changed, following unedited stages inherit it.
9. The target pressure remains the settled cylinder pressure at the settled temperature.

Supported envelope:
- Temperature must be at least 250 K.
- Pressure must not exceed 400 bar absolute.
- Direct fills are corrected. If the ideal plan requires bleed-down, complete the bleed step first and recalculate from the post-bleed state.

Top-Off GERG handling:
1. Start pressure and goal pressure are interpreted at Start Temp. This intentionally assumes Settle Temp equals Start Temp for the Top-Off workflow.
2. Convert the starting cylinder state into O2, He, and N2 moles using Start Temp, start pressure, start mix, and tank water volume.
3. Solve top-off gas moles with GERG pressure-from-density iteration until the cylinder reaches the entered goal pressure at Start Temp.
4. Compute the final O2, He, and N2 fractions from the final component moles.
5. Recalculate the displayed result pressure from the same final moles at Result Temp.
6. Editing Result Temp changes only the displayed pressure target. It does not change top-off moles or the final mix.
7. Fill-cost volume uses the start-temperature goal pressure delta, so changing Result Temp does not alter the cost estimate.

Reference implementation:
- GERG constants and equations are based on the NIST public AGA8 GERG-2008 source: <https://github.com/usnistgov/AGA8>.
- Regression tests compare the TypeScript O2/N2/He implementation against NIST C++ reference values for air, trimix, and heliox states.

## 3. Multi-Gas Nitrox Solver

Module: `calculateMultiGasBlend`

Assumptions:
- Empty cylinder (0 PSI start).
- Mixing two source gases with known oxygen fractions.

System:
```
P₁ + P₂ = P_target
P₁·O₂₁ + P₂·O₂₂ = P_target·O₂_target
```

- If O₂_target lies outside the min/max of O₂₁ and O₂₂, blending is impossible.
- Requires the source gases to have different O₂% values (denominator non-zero).
- Returns volumes to add from each source.

## 4. Utility Calculators

### Maximum Operating Depth (MOD)
```
MOD = (PPO₂_target / FO₂ - 1) · depth_per_atm
Contingency = (PPO₂_contingency / FO₂ - 1) · depth_per_atm
```
- `depth_per_atm` is 33 ft or 10 m depending on units.

### Equivalent Air Depth (EAD)
```
Ambient = Depth / depth_per_atm + 1
F_N₂ = 1 - F_O₂
EAD = (Ambient · F_N₂ / 0.79 - 1) · depth_per_atm
```

### Best Mix
```
Ambient = Depth / depth_per_atm + 1
Best Mix O₂% = PPO₂_target / Ambient · 100
```

### Equivalent Narcotic Depth (END)
```
F_N₂ = max(0, 1 - F_O₂ - F_He)
F_narcotic = F_N₂ (+ F_O₂ when "Oxygen is narcotic" is enabled)
Ambient = Depth / depth_per_atm + 1
END = (Ambient · F_narcotic / 0.79 - 1) · depth_per_atm
```

### Gas Density
```
Density_surface = F_O₂·1.429 + F_N₂·1.2506 + F_He·0.1785 (g/L)
Ambient = Depth / depth_per_atm + 1
Density_depth = Density_surface · Ambient
```

## 5. Units & Conversion

- Pressure: conversions between PSI and bar use 1 bar = 14.5037738 PSI.
- Depth: conversions between feet and meters use 1 m = 3.2808399 ft.
- All calculations run in base units and only convert for display.

### Tank Volume and Cost

Tank volume calculations use the rated free gas volume and rated pressure:

```
PSI_per_cu_ft = rated_pressure_PSI / rated_volume_cu_ft
added_cu_ft = added_pressure_PSI / PSI_per_cu_ft
added_pressure_PSI = added_cu_ft * PSI_per_cu_ft
free_gas_liters = cu_ft * 28.316846592
cu_ft = free_gas_liters / 28.316846592
```

Fill cost uses the same tank conversion path:

```
unit_price = O2_fraction * O2_price + He_fraction * He_price + N2_fraction * top_off_price
line_cost = added_cu_ft * unit_price
total_cost = sum(line_cost)
```

Liters are free gas liters at surface pressure. They are not metric cylinder water capacity liters.

## 6. Persistence

- Global settings persist via Zustand + `localStorage` (`SettingsStore`).
- Per-tab inputs persist in `SessionStore`, including per-fill tank context, allowing quick recalculations after reloads or offline usage.
- Training Mode persists as a global setting and controls explanatory UI only. It does not change calculator inputs, solver behavior, safety warnings, or persisted session values.

## 7. Training Mode

Training Mode is an educational display layer for classroom and self-study use.

- Standard Blend shows cheat-sheet style formula cards for the hand-fill worksheet used for partial-pressure fills: pressure-percent points, helium first, oxygen add with top-off credit, and final top-off.
- Bleed-down plans explain that the math is solved from the post-bleed starting pressure.
- Top-Off What-If shows visual formula cards for the pressure-percent hand check for final O2, He, and N2.
- Multi-Gas Blend shows visual formula cards for the needed added gas worksheet, a visual Pearson-square style guide for two-source nitrox cases, and pressure-percent source checks for more complex mixes.
- Utilities show formula substitutions for MOD, EAD, Best Mix, END, gas density, and tank pressure/volume conversion.
- GERG-2008 Training Mode content stays high level: it explains that corrected stops are estimated from absolute pressure, temperature, cylinder volume, component moles, and mixture compressibility, without exposing every intermediate solver value.

Training Mode is suitable as a store-listing educational feature, but it does not certify training or replace final gas analysis.

## 8. Validation & Error Handling

- Impossible mixes raise descriptive errors (e.g., target exceeds top-off capability, negative gas addition).
- The UI surfaces warnings/non-critical alerts separately from blocking errors.

For implementation details, review `src/utils/calculations.ts` alongside each component module that consumes the helper functions.
