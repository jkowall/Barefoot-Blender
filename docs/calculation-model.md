# Calculation Model

This document details the formulas and decision logic that power Barefoot Blender. New installs default to GERG-2008 real-gas corrected pressures for Standard Blend and Top-Off O2/N2/He fills. Existing users keep their saved gas-model preference, and ideal partial-pressure behavior remains available for training and comparison. Calculations operate in PSI internally unless otherwise noted.

## 1. Standard Blend Planner

Module: `src/utils/calculations.ts` (`calculateStandardBlend`)

Inputs:
- Start mix (O₂ %, He %, pressure)
- Target mix (O₂ %, He %, pressure)
- Top-off gas composition

Steps:
1. Convert displayed pressures into PSI when the user is working in bar.
2. Compute net oxygen, helium, and nitrogen partial pressure deltas between start and target states.
3. Validate fractions (0 ≤ gas ≤ 100 and O₂ + He ≤ 100). Validation runs before the bleed-down check, so an invalid mix reports its error even when the start pressure is above the target pressure.
4. Solve the linear system:
   - ΔO₂ = O₂_added + O₂_top
   - ΔHe = He_added + He_top
   - ΔN₂ = N₂_top

   where top-gas fractions distribute across the added top-off pressure.
5. If the solution requires negative additions or cannot satisfy the target composition, solve a **bleed-down**:
   - Find the range of start pressures to keep in closed form. Every amount the solver checks (ΔO₂, ΔHe, ΔN₂, and the helium, oxygen, and top-off additions) is linear in the kept pressure, so the workable kept pressures form one range. An amount that shrinks as more start gas is kept caps the range. An amount that grows sets a floor: oxygen does when the top gas is richer in O₂ than the target (an EAN32 bank for a 25% target), because keeping too little start gas leaves the top-off too rich. A nitrogen-free top gas (Oxygen, Helium, or heliox) cannot add nitrogen, so the kept gas must hold exactly the nitrogen the target needs, which pins the range to one pressure.
   - Bleed to the top of that range, capped at the start and target pressures, so the plan keeps as much start gas as possible. Re-run the solver there to confirm the plan. The addition that limits the range is zero at its top, so it drops out of the plan. When the start already holds the target mix, the plan is the bleed to the target pressure alone.
   - If no kept pressure works, fall back to draining the tank completely when an empty-tank fill works.
   - Omit additions of 0.01 PSI or less from the bleed plan. Targets that nearly put two limits on the same bleed pressure (for example a He% rounded to 4 decimals) leave thousandths of a PSI that no one can meter.
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
- `src/utils/realGasMultiGas.ts` (Multi-Gas, section 3)

Scope:
- Applies to Standard Blend, Top-Off, and Multi-Gas when the user selects the GERG-2008 gas model.
- Is selected by default for new installs; changing the setting persists the user's choice.
- Covers scuba-relevant O2, N2, and He mixtures.
- Uses the O2/N2/He subset of the NIST AGA8 GERG-2008 implementation. It does not include hydrocarbon or contaminant components from the full natural-gas model.
- In Standard Blend, the corrected stops become the primary plan when GERG-2008 solves the fill. The ideal partial-pressure plan stays available for Training Mode, the reverse solvers, and as a labeled fallback when GERG-2008 cannot solve the fill.

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
   V_water_L = tank_cu_ft * 28.316846592 * 14.6959488 / rated_pressure_PSI
   ```
   This uses the same gauge-pressure ratio as the ideal tank conversion (section 5): tank size is the free gas between 0 PSI gauge and rated pressure. An aluminum 80 (80 cu ft at 3000 PSI) infers 11.10 L.
4. Use GERG-2008 density solving to convert start and target states into total moles:
   ```
   n_total = D_mol_per_L * V_water_L
   ```
   The start state always uses absolute pressure. An empty cylinder at 0 PSI gauge still holds 1 atm absolute of the start mix, so when the exact target is reachable, 0 PSI and a small residual such as 0.01 PSI give continuous stops. For a 21/35 fill to 3000 PSI in an 80 cu ft tank at 70 F with an air top-off, the helium stop is 987.0 PSI from 0 PSI.
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
- From 0 PSI, the 1 atm residual of the start mix counts toward the target. When that residual makes the exact target unreachable (for example heliox or 100% O2 over an air residual, or a bank top-off that matches the target over a different residual), bleed-down cannot help, so GERG-2008 still plans the fill: it splits the gases as if the cylinder were empty, scales the additions so the settled pressure lands on the target, and warns with the mix the plan actually reaches (100% O2 over 1 atm of air ends near 99.6% O2). Hypoxic and high-O2 flags follow that reached mix. Purge the cylinder and set the start mix to the purge gas to reach the target exactly. Above 0 PSI, the same cases still ask for bleed-down or a different top-off gas.

Top-Off GERG handling:
1. Start pressure and goal pressure are interpreted at Start Temp. This intentionally assumes Settle Temp equals Start Temp for the Top-Off workflow.
2. Convert the starting cylinder state into O2, He, and N2 moles using Start Temp, absolute start pressure, start mix, and tank water volume. A 0 PSI start keeps 1 atm of the start mix, so a full bleed in the Bleed-Down What-If still carries that residual into the result mix.
3. Solve top-off gas moles with GERG pressure-from-density iteration until the cylinder reaches the entered goal pressure at Start Temp.
4. Compute the final O2, He, and N2 fractions from the final component moles.
5. Recalculate the displayed result pressure from the same final moles at Result Temp.
6. Editing Result Temp changes only the displayed pressure target. It does not change top-off moles or the final mix.
7. Fill-cost volume uses the solved top-off moles at Start Temp (see Fill-cost volume below), so changing Result Temp does not alter the cost estimate.
8. The Bleed-Down What-If slider re-runs the active gas model from the adjusted start pressure. In GERG-2008 mode, ideal-only reverse O2/He pressure formulas are not shown as corrected calculations.
9. The Result card shows the stop Z at Result Temp, the start Z at Start Temp, and, when Result Temp differs from Start Temp, the goal Z at Start Temp.

Fill-cost volume:
1. In GERG-2008 mode, Standard Blend and Top-Off price the solved gas moles instead of a pressure ratio. Each added gas uses its own solved moles, so for one addition at a single temperature:
   ```
   n_added = V_water / (R * T) * (P2_abs / Z2 - P1_abs / Z1)
   ```
   where Z1 and Z2 are the compressibility of the whole cylinder mix before and after the addition, not the compressibility of the added gas.
2. Moles convert to free gas at 1 atm and 70 F (the US compressed-gas reference):
   ```
   free_gas_L = n_added * R * T_ref / P_atm
   cu_ft = free_gas_L / 28.316846592
   ```
   At 70 F this reduces to `cu_ft = tank_cu_ft * (P2_abs / Z2 - P1_abs / Z1) / rated_pressure_PSI`.
3. Standard Blend moles depend only on the start state (Initial Temp) and target state (Settled Temp). Stage temperatures move corrected stop pressures, not the gas quantity, so a hot fill does not change the cost.
4. Tank size is treated as nominal capacity: the free gas between 0 PSI gauge and rated pressure, the same inference used for the GERG cylinder volume (11.10 L for 80 cu ft at 3000 PSI). Filling that cylinder with air from 0 PSI at 70 F adds about 77.4 cu ft, matching the 77.4 cu ft real-gas label of an 11.1 L aluminum 80. Entering a real-gas label such as 77.4 instead reads about 3.3% low.
5. Moles scale linearly with cylinder volume while stop pressures do not, so editing tank size rescales the GERG-2008 volumes without recalculating stops.
6. Real-gas volumes can be lower or higher than ideal. Helium-rich trimix reads lower because the mix Z is well above 1 (21/35 at 3000 PSI and 70 F has Z 1.1064, above pure helium at 1.0979). Mixes richer than about EAN50, such as EAN80 and pure oxygen, read higher because their Z is below 1 at fill pressure (EAN80 at 3000 PSI and 70 F has Z 0.9658).
7. Standard Blend: when the ideal plan succeeds but GERG-2008 has no solution for the fill (for example, bleed-down is required first), Fill Cost falls back to the ideal pressure ratio and labels the fallback. Top-Off: when the GERG-2008 top-off has no solution, the Result card shows the error and Fill Cost shows no estimate.
8. The solver starts an empty (0 PSI) cylinder from 1 atm of the start gas, so when the exact target is reachable, corrected stops and fill-cost volumes are both continuous between a 0 PSI and a slightly positive start. When that residual blocks the exact target, only an exactly empty start gets the residual-adjusted plan described above, which prices the gas it actually adds; a slightly positive start in the same case returns the bleed-down or top-off-gas error, and bleeding to 0 PSI and recalculating gives the adjusted plan.
9. With Z equal to 1, the total added GERG-2008 volume (and the single Top-Off line) reduces exactly to the ideal pressure ratio for every start state, because the cylinder volume inference and the ideal ratio both use gauge rated pressure and an empty start holds 1 atm. In exact plans, individual Standard Blend lines can still differ slightly, because GERG-2008 splits the gases by absolute partial pressure while the ideal plan uses gauge partial pressure; each line shifts by about tank_cu_ft * (target_fraction - start_fraction) * 14.6959488 / rated_pressure_PSI before the top-off split. Residual-adjusted empty-start plans split the target as if the cylinder were empty and scale every line by the same factor, so with Z equal to 1 each of their lines equals the ideal line.

Reference implementation:
- GERG constants and equations are based on the NIST public AGA8 GERG-2008 source: <https://github.com/usnistgov/AGA8>.
- Regression tests compare the TypeScript O2/N2/He implementation against NIST C++ reference values for air, trimix, and heliox states.
- This source relationship does not mean NIST certifies Barefoot Blender or its use for scuba blending. Corrected stops remain estimates, and the finished mix must be analyzed before use.

### Source Gas Composition

- The built-in Air source is 21.00% O2, 0% He, and 79.00% N2, treated as dry. The argon in real air (about 0.93%) is counted as nitrogen, because the GERG-2008 implementation carries only O2, N2, and He.
- Dry air is about 20.946% O2 ([NASA Earth Fact Sheet](https://nssdc.gsfc.nasa.gov/planetary/factsheet/earthfact.html)). Using 21.00 overstates the predicted O2 by the Air share of the final gas times 0.054 points:

  | Fill | Air share of final gas | O2 overstatement |
  | --- | --- | --- |
  | Straight air fill | 100% | 0.054 points |
  | EAN32 from Oxygen, then Air | 86% | 0.047 points |
  | 15.7/55 to 15/55 top-up (section 3) | 5% | 0.003 points |

- Modeling argon separately would change Z by about -0.1% on a 3000 PSI air fill and the mix by under 0.001 points.
- All of these are below a 0.1-resolution analyzer and below calibration effects. Calibrating to 20.9 on room air at 25 C and 50% relative humidity makes a dry 15.0% mix read about 15.2.
- For analyzed air, add it as a custom bank gas (for example 20.9/0) and select it instead of Air. Gas pickers show fractions to two decimals, so the bank reads as analyzed.
- The 0.79 in EAD, END, and the Best Mix helium limit (section 4) is air's N2 fraction used as the narcosis reference, not the source-gas composition.

## 3. Multi-Gas Blend Optimizer

Modules:
- `src/utils/calculations.ts` (`solveNGasBlend`, ideal)
- `src/utils/realGasMultiGas.ts` (`calculateRealGasMultiGasBlend`, GERG-2008)

The Multi-Gas tab takes a start cylinder, a target mix and pressure, and 1 to 6 source gases (Air, Oxygen, Helium, custom banked gases, trimix presets, or a custom mix), each with an optional bank limit. It follows the Gas model setting.

### Ideal optimizer

1. Compute the composition the added gas must have:
   ```
   P_added = P_target - P_start
   O2_needed = (P_target * O2_target - P_start * O2_start) / P_added
   He_needed = (P_target * He_target - P_start * He_start) / P_added
   ```
2. Try every subset of 1, 2, and 3 enabled sources:
   - One source matches when it is within 0.5 points of the needed O2 and He.
   - Two sources solve the 2x2 O2/He system and must sum to the added pressure within 0.5 PSI (nitrox pairs use the one-axis Pearson balance). Helium-bearing pairs with the same O2:He ratio, such as 10/25 and 20/50, solve the total with whichever fraction differs more and must meet the other balance within 0.5 PSI.
   - Three sources solve the 3x3 system `[1 1 1; O2; He] * amounts = P_added * [1; O2_needed; He_needed]`, which is unique when it exists.
   - Negative amounts and amounts above a source's bank limit are rejected.
3. Rank the options by fill cost (section 5) and show up to five.
4. If none works, search for the smallest bleed-down (see N-Gas Bleed-Down Search below); if that fails, search for the closest blend within +/-1% O2 and +/-5% He.

With four or more sources there can be many valid fills. The optimizer lists the cheapest subset solutions; it does not search fills that take partial amounts from more than three sources.

### N-Gas Bleed-Down Search

Module: `solveNGasBlend`

When no 1-, 2-, or 3-source plan reaches the target from the current start pressure, the solver looks for the highest start pressure (smallest bleed) that works:
- Bank caps (`maxPressurePsi`) can make the workable start range a set of intervals that excludes 0, and a window can be only a few PSI wide. Draining too far leaves more to add than a capped bank can supply. So the search does not assume that draining further always stays feasible.
- Every check the 1-, 2-, and 3-source solvers make (needed-mix bounds, single-source match, source amounts, bank caps, and the 2-source 0.5 PSI pressure or balance residual) is linear in the start pressure, so the solver computes every start pressure where one of them changes sign. Feasibility cannot change between two neighboring breakpoints.
- Walk those segments from the current pressure down to 0, testing each segment's midpoint and then its lower breakpoint. The first segment that works is bisected up toward its upper breakpoint to 0.001 PSI; a lone workable breakpoint is used as is. This finds the smallest possible bleed, however narrow the window.
- The plan gets a leading `Bleed Tank` step, a `Bleed to ...` cost line, and the "Bleed-down required to achieve target mix." warning.

### GERG-2008 Multi-Gas

Mixing is linear in moles, so the ideal optimizer's linear algebra also solves the real-gas fill once the start and target states are in moles:

1. Convert the start state (start pressure, Start Temp, start mix; 0 PSI holds 1 atm of the start mix) and the target state (target pressure, Settled Temp, target mix) to moles with GERG-2008 density solving, as in section 2.
2. Write moles as ideal-equivalent PSI at the 70 F free-gas reference:
   ```
   P_eq = n * R * T_ref / V_water
   ```
   and run the ideal subset search on those values. Because the tank conversion and the water-volume inference use the same rated-pressure ratio, `pressureToCuFt(P_eq)` equals the real-gas free-gas volume of `n` moles, so the ideal cost ranking prices real moles exactly as Standard Blend's GERG fill cost does.
3. Refine each option with a common scale so the final mix's GERG density at the target pressure and Settled Temp matches the cylinder contents. Exact options need almost no change; the step absorbs the subset search's small tolerances.
4. Order the additions. Auto uses the recommended order (helium, then oxygen, then higher-helium and higher-oxygen mixes, with Air last). My order follows the source list from top to bottom. Amounts never depend on order.
5. Walk the ordered additions through GERG-2008 to get each stop pressure, Z, and pressure rise at that stage's temperature. A stage temperature belongs to its source row; an unedited stage inherits the previous stage's temperature, then Start Temp.
6. Check bank limits as each source's real pressure rise at its stage temperature in the fill order shown. A limit can therefore pass in one order and fail in another. Limits are judged on the refined plan; a quick check that skips clear misses first projects each rise to the refined scale.
7. Exact plans must reach the target within 0.01 percentage points. A single source that only nearly matches is not listed as exact. Hypoxic and high-O2 flags cover both the target and the O2 each plan actually reaches, so a plan at 17.995% O2 for an 18% target is still flagged.
8. Every plan must settle within 0.05 PSI of the target pressure at Settled Temp, and must add or bleed at least one meterable amount (0.05 PSI); a start of the target mix within that of the target pressure already matches it. A target that holds fewer moles than the 1 atm left in an empty cylinder (start mix at Start Temp) cannot be reached by any plan and is reported as an input error.

When no exact plan exists:
- **Bleed-down** (start above 0 PSI): find the highest drain-to pressure that still allows an exact plan. The search scans the uncapped range from the top down and bisects up to 0.01 PSI; with bank limits it then scans that range more finely, because limits can leave a feasible window that excludes both the start pressure and 0 PSI. Each subset of one to three sources is also solved directly from the linear mole balance, because a scan can step over narrow answers:
  - When the subset's sources cannot make the start mix, at most one drain-to pressure works (air to EAN32 with only an EAN36 bank drains to 763.6 PSI at 70 F).
  - When the subset's sources can make the start mix themselves (two nitrox sources over a nitrox start, two sources sharing the start's helium or nitrogen fraction, or any three independent sources), the subset works over a range of kept start gas in which each source's amount changes linearly. Each bank-limited source's real-gas rise is measured at both ends of the range: a rise that grows with the kept gas caps the range from above. This uses the rise, not the moles, because a fixed helium amount still rises more over a denser residual. The search bisects for the highest kept amount under every upper cap, then checks the other limits there. The range is first split wherever a source's amount crosses the smallest meterable addition (0.05 PSI): its stage drops out there and the next stage inherits a different temperature, so rises can jump. The pieces are searched from the top down. If GERG-2008 cannot evaluate an end of a piece (for example a stage inheriting a hotter temperature that passes 400 bar), the search moves that end inward to the nearest point it can evaluate. Two limits binding in opposite directions can leave a window only a few PSI wide (2500 PSI of EAN10 to EAN32 with Oxygen and Air limited to 600 and 935 PSI drains to about 1466.5 PSI).
  - Every solved point is verified with a full GERG-2008 pass. The scan still covers sources that are not independent of each other (three that only span two balances), and the smallest verified bleed wins.
  - Excess start gas that already has the target mix is simply drained, to the pressure at which the kept gas matches the target at Settled Temp. The drain step is shown at Start Temp.
- **Residual-adjusted plan**: when even 0 PSI cannot work because of the 1 atm left in the cylinder, plan the gases as if the cylinder were empty and scale them so the settled pressure lands on the target, as Standard Blend does (section 2). Only options whose gases alone make the target qualify, so a source that only nearly matches (EAN31.6 for EAN32) goes to the closest blend instead. A start above 0 PSI first drains to 0. The plan warns with the mix it actually reaches.
- **Closest blend**: the same +/-1% O2 and +/-5% He search as ideal mode, in mole space, with the settled pressure held on the target. Each trial mix is sized for the moles that mix holds at the target pressure, not the target mix's, so a small top-up toward a lighter or heavier mix is still found. It searches from the current start first, and drains to 0 PSI only when no nearby mix is reachable from the current start. When bank limits rejected exact, bleed, or residual options along the way, the closest blend also says that more available pressure in a limited bank may allow the exact mix.

If GERG-2008 cannot evaluate the inputs (failure `gerg`: Start or Settled Temp below 250 K, no tank volume, pressure above 400 bar absolute at the target, or a stage temperature or hot stage that every option needs and GERG-2008 cannot evaluate), the tab shows the ideal plan labeled as a fallback. A stage temperature only matters to options that use that stage, so an out-of-range value on a source no plan needs does not block the corrected plan. This includes a fill where some options break a bank limit and every other option breaks the envelope. An option that fails the envelope still counts as a bank-limit miss when a stage it completed went over its limit, or when its planned amount is clearly over a limit. That includes the bleed search's probes that ignore limits, so a fill that only bank limits rule out stays "no valid blend". A GERG-2008 "no valid blend" result, where bank limits rule out every option, is shown as is, so a bank limit is never hidden behind an ideal plan.

For a fill from 0 PSI with Helium, Oxygen, and Air, GERG-2008 Multi-Gas reproduces Standard Blend's corrected stops and moles (21/35 to 3000 PSI in an 80 cu ft tank at 70 F: 987.0, 1267.9, and 3000 PSI).

A logged top-up is pinned as a field example. Start: 2577 PSI of 15.7/55 at 73.5 F. My order adds Air, a 15.2/56 bank, and Helium, to 3300 PSI of 15/55.
- Corrected stops at 73.5 F: 2752.5, 3074.5, and 3300.0 PSI.
- With stage temps of 76.5, 84.5, and 60 F: 2769.3, 3143.3, and 3209.9 PSI. The gas added is the same, and the stops do not depend on tank size.
- Chaining GERG-2008 Top-Off at the 73.5 F stops returns 15.00/55.00. Re-entering each intermediate mix at two decimals drifts to 15.01/55.01.
- The ideal optimizer plans 2739.3 and 3109.9 PSI for the same order.
- The fill analyzed 14.9/54.8 on a 0.1-resolution analyzer.

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
F_air = 0.79 (N₂ only), or 1.0 when "Oxygen is narcotic" is enabled
F_narcotic,max = (Max END / depth_per_atm + 1) · F_air / Ambient
He% = 100 - O₂% - F_narcotic,max · 100   (N₂ only)
He% = 100 - F_narcotic,max · 100          (oxygen narcotic)
```
- He% is clamped to 0 through 100 - O₂%. With oxygen narcotic, O₂ alone can exceed the narcotic limit (PPO₂ above Max END / depth_per_atm + 1). The rest is then helium, `maxEndMet` is false, and Utilities warns with the END the mix actually reaches.
- When helium is needed and Max END can be met, `calculateEND` of the result equals Max END in either mode (60 m, PPO₂ 1.4, Max END 30 m: 20/34.9 N₂ only, 20/42.9 with oxygen narcotic).

### Equivalent Narcotic Depth (END)
```
F_N₂ = max(0, 1 - F_O₂ - F_He)
F_narcotic = F_N₂ (+ F_O₂ when "Oxygen is narcotic" is enabled)
F_air = 0.79 (N₂ only), or 1.0 when "Oxygen is narcotic" is enabled
Ambient = Depth / depth_per_atm + 1
END = (Ambient · F_narcotic / F_air - 1) · depth_per_atm
```
- With oxygen narcotic this is `(Depth + depth_per_atm) · (1 - F_He) - depth_per_atm`, so air and any nitrox have an END equal to the depth (21/35 at 100 ft: 53.5 ft).

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

Ideal mode, Utilities Tank Conversion, and the GERG-2008 fallback use the rated free gas volume and rated pressure. GERG-2008 Standard Blend, Top-Off, and Multi-Gas fill costs use solved real-gas moles instead (see Fill-cost volume in section 2 and section 3):

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
- Multi-Gas Blend shows visual formula cards for the needed added gas worksheet, a visual Pearson-square style guide for two-source nitrox cases, and pressure-percent source checks for more complex mixes. In GERG-2008 mode the hand check uses the ideal option that adds the same source gases as the selected corrected plan, and notes that its pressures differ from the corrected stops.
- Utilities show formula substitutions for MOD, EAD, Best Mix, END, gas density, and tank pressure/volume conversion.
- GERG-2008 Training Mode content stays high level: it explains that corrected stops are estimated from absolute pressure, temperature, cylinder volume, component moles, and mixture compressibility, without exposing every intermediate solver value.

Training Mode is suitable as a store-listing educational feature, but it does not certify training or replace final gas analysis.

## 8. Validation & Error Handling

- Impossible mixes raise descriptive errors (e.g., target exceeds top-off capability, negative gas addition).
- The UI surfaces warnings/non-critical alerts separately from blocking errors.

For implementation details, review `src/utils/calculations.ts` alongside each component module that consumes the helper functions.
