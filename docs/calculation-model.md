# Calculation Model

This document details the formulas and decision logic that power Barefoot Blender. All calculations assume ideal gas behavior (partial pressure blending) and operate in PSI internally unless otherwise noted.

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

## 2. Multi-Gas Nitrox Solver

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

## 3. Utility Calculators

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

## 4. Units & Conversion

- Pressure: conversions between PSI and bar use 1 bar = 14.5037738 PSI.
- Depth: conversions between feet and meters use 1 m = 3.2808399 ft.
- All calculations run in base units and only convert for display.

## 5. Persistence

- Global settings persist via Zustand + `localStorage` (`SettingsStore`).
- Per-tab inputs persist in `SessionStore`, allowing quick recalculations after reloads or offline usage.

## 6. Validation & Error Handling

- Impossible mixes raise descriptive errors (e.g., target exceeds top-off capability, negative gas addition).
- The UI surfaces warnings/non-critical alerts separately from blocking errors.

For implementation details, review `src/utils/calculations.ts` alongside each component module that consumes the helper functions.
