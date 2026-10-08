# Changelog

## [Unreleased]

### Changed

- **Gas Picker Fractions**: The Multi-Gas source picker now shows each gas's O2 and He fractions, as Top-Off and Standard Blend do ("Air (21% O2 / 0% He)"). All three pickers show two decimals where needed, so an analyzed 20.95% O2 bank no longer reads as 21%. The Multi-Gas picker keeps room for the fractions on phones: full width on narrow screens, with Enabled beside it once the row is wide enough.

### Fixed

- **Standard Blend Reverse Solvers**: "Max Target Without Helium" and "Required Start Pressure (no helium)" now return results instead of always reporting that the target needs helium. Max Target's search treated both "needs a bleed" and "needs helium" as failures, so it never landed on the single He% that needs neither. Required Start's first check always failed because it asked the planner to blend from the target pressure. Both now solve the helium-free fill exactly: 1000 psi of 21/35 with Air reaches 32/11.7 at 3000 psi, and 32/10 needs 857 psi of 21/35. When the start must be bled anyway (for example 2900 psi of 21/35, bled to 2582 psi for 32/30.1), Max Target shows the bleed pressure.
- **END With Oxygen Narcotic**: With "Oxygen is narcotic?" set to Yes, END now compares against air's full narcotic fraction (1.0) instead of its nitrogen fraction (0.79). Air and nitrox now show an END equal to the depth, and trimix follows (D + 33)(1 - He) - 33. END values drop for this setting: air at 30 m reads 30 m instead of 40.6 m, and 21/35 at 100 ft reads 53.5 ft instead of 76.4 ft. The default N2-only END is unchanged.
- **Best Mix With Oxygen Narcotic**: Best Mix now follows the "Oxygen is narcotic?" setting. It previously always planned helium for an N2-only END, which left too little helium when oxygen counts as narcotic (60 m, PPO2 1.4, Max END 30 m: 20/42.9 instead of 20/34.9, whose END is 35.6 m with oxygen narcotic). The result shows which setting it used, warns when oxygen alone is over the Max END limit, and the default N2-only result is unchanged.
- **Top-Off Copy Precision**: Copy Result to Start Tank still shows the copied O2 and He at 2 decimals, but Top-Off now calculates from the unrounded result mix until either field is edited. Re-entering each intermediate mix at 2 decimals had compounded across chained top-offs: a GERG-2008 fill of 2577 psi of 15.7/55 at 73.5 F with Air to 2752.5 psi, a 15.2/56 bank to 3074.5 psi, and Helium to 3300 psi ended at 15.01/55.01 instead of 15.00/55.00.
- **Clearable Temperature Fields**: Start Temp (Initial Temp in Standard Blend) and Settled Temp in Standard Blend and Multi-Gas no longer refill with their default while being cleared, so negative temperatures such as -5 C can be typed. A cleared field keeps its saved temperature until it is left empty, which restores the default. Celsius temperature inputs now round to 0.01 degrees instead of showing conversion noise such as 12.000000000000002.
- **Standard Blend Plan Stops**: Fill plan stop pressures now stay tied to the start pressure the plan was calculated from, so editing Start Pressure after Calculate no longer shifts the stops while the step amounts stay the same. When GERG-2008 supplies the plan because the ideal fill has no pressure change, the stops now use each stage's solved pressure. Adding up per-stage pressure changes drifted when stage temperatures differed (124 psi low at the final stop for a 21/35 fill with 70, 110, and 130 F stages).
- **Empty Fields While Editing**: While a pressure or mix field is empty mid-edit, Standard Blend and Top-Off use the defaults their calculations already apply instead of passing the empty value into display math as NaN. Max Target Without Helium labels the 32% O2 it solved for instead of 0% while Target O2 is empty, and Top-Off's Final O2/He reverse-solve no longer sets the bleed to NaN while Start O2, Start He, or Final Pressure is empty. Completed inputs are unaffected.
- **Empty Target Pressure in Bar**: While Standard Blend's Target Pressure or Top-Off's Final Pressure is empty mid-edit, bar mode now assumes the same 3000 psi fill as psi mode (about 206.8 bar) instead of 3000 bar (about 43,500 psi). Standard Blend's GERG-2008 corrected stops, Fill Sensitivity, and Reverse Solvers, and Top-Off's result, bleed preview, and Final O2/He reverse-solve all use that value, so the Top-Off reverse-solve no longer clamps the bleed to 0 against a 3000 bar goal. PSI mode and typed pressures are unchanged.

## [1.2.0] - 2026-10-06

### Added

- **GERG-2008 Multi-Gas**: Multi-Gas now follows the Gas model setting. In GERG-2008 mode it plans fills from any mix of sources in real-gas moles and shows corrected stops with the pressure rise, Z, and real-gas volume of each addition. A three-source fill such as Air, a trimix bank, and Helium into a 12/76 residual is solved in one pass instead of by repeated Top-Off and Standard Blend trials. With Helium, Oxygen, and Air it matches Standard Blend's corrected stops. If GERG-2008 cannot evaluate a fill (for example a hot stage above 400 bar), the tab shows the ideal plan labeled as a fallback.
- **Multi-Gas Temperatures**: GERG-2008 mode adds Start Temp, Settled Temp, and a Stage Temp input on each stop row. Stage temps default to Start Temp and carry forward to later unedited stops. A Reset stage temps button clears them, and saved stage temps stay editable even when an edit leaves no corrected plan.
- **Multi-Gas Fill Order**: A Fill Order control keeps the recommended order (helium, oxygen, richer mixes, then Air) or switches to "My order", where up/down buttons on each source row set the order. Amounts stay the same in any order; only the stop pressures change.
- **Multi-Gas Bleed and Residual Plans**: GERG-2008 Multi-Gas finds the smallest bleed-down that still allows an exact fill, plans over the 1 atm left in an empty cylinder like Standard Blend, drains to the target pressure when the start already has the target mix, and falls back to the closest blend within +/-1% O2 and +/-5% He. Bank limits that leave only a narrow bleed window are solved exactly.

### Changed

- **Multi-Gas Sources**: Up to 6 source gases (was 4).
- **Multi-Gas Real-Gas Cost**: In GERG-2008 mode, Multi-Gas cost and volumes come from solved real-gas moles at 1 atm and 70 F, and bank limits apply to each source's real-gas pressure rise at its stage temperature and fill position. Ideal mode is unchanged.
- **Stricter Content Security Policy**: The production Content-Security-Policy header now sets `style-src 'self'` without `'unsafe-inline'`. The privacy, terms, and support pages load their shared styles from `public/legal.css` instead of inline `<style>` blocks. The iOS and Android apps, which only see the CSP meta tag in `index.html`, now get the same policy as the website with no inline scripts or styles. Only the local dev server relaxes it.
- **Dependencies**: Upgraded React, React DOM, and their type packages to 19.3.0, vite-plugin-pwa from 1.3.0 to 2.0.0 (major version), and Capacitor core, CLI, iOS, and Android to 8.5.2.

### Fixed

- **iOS Capacitor Runtime**: Native iOS builds now pin `capacitor-swift-pm` 8.5.2 to match `@capacitor/ios` 8.5.2. Earlier builds still linked 8.4.1, which is affected by GHSA-rvm3-566m-v7fv.
- **Multi-Gas Bleed-Down With Bank Limits**: Ideal Multi-Gas now finds the bleed-down when a capped bank means the tank can be drained too far as well as not far enough. It previously returned "No valid blend found" (2000 psi of 10/70 into 21/35 at 3000 psi with Air capped at 1300 psi now bleeds to 1500 psi). The search now checks every start pressure where a bank cap or mix limit can change the result, from the current pressure down, and keeps the smallest workable bleed, even when capped banks leave a window narrower than 10 psi. Bleed-downs that already worked are unchanged, except a few where the old search drained more than needed. Those now bleed less.
- **Multi-Gas Trimix Banks With the Same O2:He Ratio**: Ideal Multi-Gas now plans fills from two helium mixes with the same O2:He ratio, such as 10/25 and 20/50 into 15/37.5. It previously returned "No valid blend found". The new GERG-2008 Multi-Gas handles these pairs too.
- **Calculation Docs**: The Multi-Gas section of the calculation model described a legacy two-gas nitrox solver; it now documents the optimizer the tab uses.

## [1.1.2] - 2026-10-05

### Fixed

- **GERG Empty-Cylinder Plans**: When the 1 atm left in an empty (0 PSI) cylinder makes the exact target unreachable, GERG-2008 now gives a corrected plan and states the mix it actually reaches instead of returning an error (1.1.1 regression). Examples are heliox or pure oxygen over an air residual (pure oxygen ends near 99.6% O2) and a bank top-off that matches the target over a different residual. Hypoxic and high-O2 warnings on these plans follow the mix actually reached, not the unreachable target. Purge the cylinder and set the start mix to the purge gas to reach the target exactly.
- **GERG Bleed-Down Guidance**: Standard Blend no longer shows "needs valid temp" stop rows or a temperature-correction note when GERG-2008 correction stops for a required bleed-down or another pre-solve input error. Only the GERG error is shown, and stage temperature rows remain for stage temperature envelope failures.

## [1.1.1] - 2026-10-05

Released to the web only; the native apps go from 1.1.0 to 1.1.2.

### Fixed

- **GERG Empty-Cylinder Start**: A 0 PSI start is now treated as 1 atm of the start gas already in the cylinder instead of a vacuum, so corrected stop pressures no longer jump between a 0 PSI and a slightly positive start (21/35 into an 80 cu ft tank: helium stop 987 PSI instead of 970). Cylinder volume is now inferred from gauge rated pressure, so GERG-2008 fill volumes match the ideal pressure ratio when Z is 1 and read about 0.5% higher than in 1.1.0 (21/35 helium: 25.4 cu ft). Targets that 1 atm of the start gas makes unreachable, such as heliox or pure oxygen into an empty cylinder with an air start mix, now show an error asking you to set the start mix to the gas left in the cylinder or purge it.

## [1.1.0] - 2026-10-05

### Changed

- **Real-Gas Fill Volumes**: In GERG-2008 mode, Standard Blend and Top-Off fill-cost gas volumes now come from the solved real-gas moles (the cylinder mix's `P2/Z2 - P1/Z1`, at 1 atm and 70 F) instead of the ideal pressure ratio. Helium-rich trimix reads lower (21/35 into an 80 cu ft tank: helium 25.3 cu ft instead of 28.0), and mixes richer than about EAN50, such as EAN80 and pure oxygen, read higher. Ideal mode is unchanged, and Standard Blend labels an ideal fallback when GERG-2008 cannot solve the fill.

### Added

- **Top-Off Z Factors**: The GERG-2008 Top-Off result shows Z at the stop, the start Z, and the goal Z when Result Temp differs from Start Temp. The Standard Blend corrected-stop reference line now shows the starting Z.

### Fixed

- **GERG-Only Fill Cost Basis**: When the GERG-2008 plan replaces an ideal no-op plan, Fill Cost now prices real-gas moles instead of converting corrected stop pressures with the ideal ratio.

## [1.0.0] - 2026-08-19

### Added

- **Independent GERG Regression Coverage**: Added pinned NIST AGA8 reference vectors, full Trimix blend reconstruction, pressure-density round trips, derivative checks, unit equivalence, tank scaling, temperature-path invariants, and supported-envelope boundaries.

### Changed

- **Real-Gas Default**: New installs now use GERG-2008 temperature-aware O2/N2/He calculations for Standard Blend and Top-Off. Existing saved preferences remain unchanged, and ideal partial-pressure math remains available for training and comparison.
- **GERG Bleed Preview**: Bleed-Down What-If now follows the selected gas model and uses the same GERG Top-Off solver when real-gas mode is active. The alternate-start sensitivity table remains explicitly ideal-only.

### Fixed

- **Real-Gas Input Safety**: Rejected negative or nonfinite densities, pressures, and cylinder context; preserved hypoxic and high-O2 warnings; and accepted valid 400-bar round trips despite floating-point noise.

## [0.12.10] - 2026-08-14

### Fixed

- **iOS Viewport Stability**: Allowed footer actions to wrap on narrow screens and kept form controls at an iOS-safe text size so the app no longer expands beyond the physical viewport or becomes stuck after focusing an input.

## [0.12.9] - 2026-06-25

### Changed

- **Top-Off Result Precision**: Displayed Top-Off result O2, He, and N2 values with two decimal places for finer mix evaluation.

### Fixed

- **Top-Off Multi-Stage Workflow**: Added a Result action that copies the calculated mix, goal pressure, and GERG goal temperature back into the Start Tank inputs with visible confirmation.

## [0.12.8] - 2026-06-24

### Added

- **Top-Off GERG Temperature Corrections**: Added GERG-2008 corrected Top-Off results with Start Temp and Result Temp controls. Result Temp changes the displayed stop pressure while keeping the calculated mix fixed.

### Changed

- **Top-Off Flow**: Simplified Top-Off into Start, Top-Off, Result, and Fill Cost sections, with tank context kept next to the cost breakdown.
- **Release Policy**: Documented that app version bumps also require the native mobile release validation path unless explicitly excluded.

## [0.12.7] - 2026-06-17

### Changed

- **Standard Blend Cost Layout**: Moved editable tank context into the Cost Calculation section so mix and pressure inputs stay focused on blending instructions while fill-cost estimates keep their tank basis nearby.

### Fixed

- **GERG Stage Temperature Editing**: Kept cleared measured stage temperatures editable during GERG recalculation failures and preserved later planned temperature rows when only part of a corrected stop plan can be displayed.

## [0.12.6] - 2026-06-16

### Fixed

- **GERG Stage Temperature Corrections**: Fixed measured stage pressure deltas so gas additions are calculated against the before-add cylinder state at the same measured stage temperature, cleared stale GERG-derived primary results when inline temperature recalculation fails, preserved legacy fill temperatures when saved blends or history entries are upgraded, kept untouched earlier stage temperatures inherited from Initial Temp, kept inline GERG recalculations on the current tank context, and aligned the Initial reference readout with the first before-add stage state.

## [0.12.5] - 2026-06-16

### Added

- **Measured GERG Stage Temperatures**: Moved GERG-2008 temperature correction into the Blend Plan with inline initial, settled, and per-stage temperature inputs. Stage temperatures default to the initial temperature and propagate to following unedited stops for quick measured-fill refinement.

## [0.12.4] - 2026-06-15

### Fixed

- **Multi-Gas Training Mode**: Added a helium-aware trimix balance worksheet so Training Mode shows O2, He, and N2 pressure-point work for Multi-Gas blends with helium.
- **Gas Model Visibility**: Added a footer indicator for the selected gas blending model and clarified that Multi-Gas Training Mode uses ideal pressure-point balance.

## [0.12.3] - 2026-06-15

### Fixed

- **Multi-Gas Default State**: Hid the helium-source warning for nitrox-only Multi-Gas blends where the target helium is already 0%.

## [0.12.2] - 2026-06-15

### Changed

- **Training Mode Work Sheets**: Expanded Standard Blend, Top-Off, Bleed Pressure, and Multi-Gas Training Mode explanations with reference-style variable substitutions for the classroom nitrox formulas.

### Fixed

- **Pearson Square Rendering**: Replaced the Training Mode Pearson-square pseudo-element lines with explicit SVG strokes so the visual guide remains visible in production builds.

## [0.12.1] - 2026-06-15

### Changed

- **Training Mode Hand Math**: Reworked Training Mode explanations to use cheat-sheet style visual formula cards, including pressure-percent points, helium-first/O2/top-off Standard Blend steps, Top-Off hand checks, and a visual Pearson-square style Multi-Gas guide where applicable.

## [0.12.0] - 2026-06-15

### Added

- **Training Mode**: Added a persistent footer toggle that shows class-friendly formulas, substitutions, and intermediate values for Standard Blend, Top-Off, Multi-Gas, and Utilities results ([#157](https://github.com/jkowall/Barefoot-Blender/issues/157)).
- **Store Listing Guidance**: Documented Training Mode as an educational feature for App Store and Google Play release copy.

### Fixed

- **Multi-Gas Closest Match**: Restored within-tolerance fallback suggestions in the N-gas optimizer when an exact target blend cannot be made with the selected banks, while keeping suggested fill totals at the requested target pressure.

## [0.11.0] - 2026-06-15

### Added

- **GERG-2008 Fill Corrections**: Added an optional Standard Blend gas model that calculates O2/N2/He molar real-gas corrected stop pressures with fill and settled temperature inputs ([#155](https://github.com/jkowall/Barefoot-Blender/issues/155)).

## [0.10.0] - 2026-06-11

### Added

- **In-App Bug Reporting**: Added email-based bug reports from the footer, Settings/About, and crash UI with optional sanitized diagnostics and a copy fallback.
- **iOS Store Copy Guard**: Added a build-time iOS asset check that fails native syncs when App Store-visible assets include Android or Google platform references.

### Fixed

- **Subscription Legal Links**: Added functional Privacy Policy and Terms of Use links directly inside the native subscription paywall for App Review compliance.
- **iOS Export Compliance**: Declared the app does not use non-exempt encryption in the iOS Info.plist so future TestFlight uploads can avoid the repeated manual compliance prompt.
- **App Store Review Copy**: Removed third-party platform references from native subscription, support, privacy, and terms copy for App Store review readiness.
- **Native Release Versioning**: Aligned iOS and Android native release metadata with app version `0.10.0`.

## [0.9.1] - 2026-06-11

### Fixed

- **Web App Startup**: Aligned React and React DOM package versions to prevent a runtime renderer mismatch that could leave the production page blank.

## [0.9.0] - 2026-06-11

### Added

- **iPad App Store Screenshots**: Added 13-inch iPad screenshot assets for App Store submission.
- **Mobile Release Parity Checklist**: Documented native validation expectations before treating web production as release-ready.

### Fixed

- **iOS Safe Area Header**: Adjusted native header spacing so iOS safe areas do not crowd the app chrome.
- **Native Tab Highlight**: Fixed active tab styling in native builds.
- **iOS Release Assets**: Removed duplicate unassigned splash images from the iOS asset catalog.

## [0.8.0] - 2026-05-25

### Added

- **Native Mobile Shells**: Added Capacitor configuration for iOS and Android using app ID `com.trimixblender.barefootblender`.
- **Subscription Access**: Added RevenueCat-backed native subscription gating for the `pro` entitlement with annual product support.
- **Debug Mobile Builds**: Added a local-only subscription bypass build script for simulator and device debugging before store products are configured.
- **Android Debug Runner**: Added a one-command Android emulator debug runner that starts an AVD, builds the debug bundle, installs it, and launches the app.
- **Android Release Signing**: Added ignored local upload-key signing support for Play App Signing release bundles.
- **Safety Acknowledgement**: Added first-run safety acknowledgement and Settings/About safety messaging for trained diver and fill station use.
- **Legal Pages**: Added privacy, terms, and support pages for app store listings.
- **Mobile Release Docs**: Added account setup, signing, store listing, subscription, validation, and rollback guidance.

### Fixed

- **iOS Release Assets**: Removed unassigned splash image files from the iOS asset catalog to clear Xcode release-build warnings.

## [0.7.0] - 2026-05-25

### Added

- **Tank Context**: Added per-fill tank volume and rated pressure controls for Standard Blend, Top-Off What-If, and Multi-Gas Blend.
- **Tank Conversion**: Added a Utilities converter for PSI, cubic feet, and free gas liters, with explicit free gas liter labeling.
- **Fill Cost Detail**: Added PSI, cubic feet, free gas liters, unit price, and total cost details to fill cost outputs.

### Changed

- **Cost Model**: Refactored fill cost calculations to use shared tank conversion helpers for PSI per cubic foot, pressure to cubic feet, cubic feet to pressure, and cubic feet to liters.

## [0.6.19] - 2026-03-28

### Changed

- **Performance Optimization**: Optimized the gas blend alternatives deduplication logic in `src/utils/calculations.ts` by replacing high-overhead `map().sort().join()` with an efficient manual sorting and string construction loop. This achieved a ~17% performance improvement in benchmarks while maintaining order-independent deduplication.

## [0.6.18] - 2026-03-28

### Fixed

- **Security**: Replaced insecure `Date.now()` with `crypto.randomUUID()` for custom gas ID generation in Settings to ensure unique, cryptographically strong identifiers.

## [0.6.17] - 2026-03-21

### Added

- **Testing**: Added comprehensive unit tests for the `calculateEAD` (Equivalent Air Depth) function to ensure accuracy across metric/imperial units and proper handling of edge cases (100% O2, 0% O2, surface, and negative depth).

## [0.6.16] - 2026-03-21

### Fixed

- **Security**: Replaced insecure `Math.random()` with `crypto.randomUUID()` for blend history ID generation to ensure cryptographic strength and avoid predictability.

### Added

- **Testing**: Added comprehensive unit tests for `formatNumber`, `formatPercentage`, and `formatDepth` in `src/utils/format.ts` to increase reliability and coverage.

### Changed

- **Code Health**: Removed unused `ChangeEvent` import from `NumberInput.tsx` by inlining the `onChange` handler to allow TypeScript type inference.

## [0.6.15] - 2026-03-14

### Changed

- **Performance Optimization**: Replaced O(N) `Array.find()` lookups with a direct reference to the memoized `selectedTopGas` object in the `TopOffTab` component's `onChange` handlers, reducing execution time by ~98% for those lookups.

## [0.6.14] - 2026-03-14

### Added

- **Benchmarking**: Added a standalone `benchmark.js` script to compare direct cached access versus repeated `Array.find()` lookups for top-off gas selection.

### Changed

- **Benchmark Type Safety**: Updated `src/benchmarks/measure_options_alloc.ts` to use the explicit `GasSourceInput` type, including the required `enabled` field in mock inputs.
- **Benchmark Performance**: Optimized the benchmark's baseline gas-option lookup with a cached `Set` of IDs instead of repeated nested scans.

## [0.6.13] - 2026-03-13

### Added

- **Testing**: Added comprehensive unit tests for the `calculateEND` (Equivalent Narcotic Depth) function to ensure accuracy across metric/imperial units and different oxygen narcotic settings.

## [0.6.12] - 2026-03-13

### Added

- **Bank-Aware Optimization**: Multi-Gas sources now support per-bank available pressure limits. The optimizer respects these limits when generating blend options and reports when targets are blocked by bank availability.
- **Blend History + Recreate**: Standard Blend now saves successful plans to persistent history with one-tap recreate, per-entry remove, and clear-all controls.

### Changed

- **Fill Cost Calculator**: Expanded cost modeling to include top-off gas pricing. Added `Top-Off Gas Price` in Pricing settings and updated Standard Blend cost breakdown to show per-line gas pricing and total.
- **Optimizer Cost Model**: Multi-Gas alternative ranking now accounts for O₂, He, and N₂ fractions when pricing mixed source gases.

## [0.6.10] - 2026-02-25

### Fixed

- **Calculation Logic**: Fixed a bug in the bleed-down solver (`findBleedSolution`) where it could fail to find a valid solution when a complete tank drain was required or when the optimal bleed pressure was very low.
- **Testing**: Added comprehensive unit tests for `calculateStandardBlend` to ensure correctness of standard nitrox, trimix, and bleed scenarios.
- **Security**: Added Content Security Policy (CSP) meta tag to `index.html` to improve security against XSS and injection attacks.
- **Security**: Removed `server: { host: true }` from Vite configuration to restrict the development server to localhost by default. This prevents unintended exposure to the local network.
- **Code Health**: Refactored signed pressure formatting logic into a shared utility (`formatSignedPressure`) and applied it across Standard Blend, Multi-Gas, and Top-Off tabs for consistency.

## [0.6.9] - 2026-02-24

### Changed

- **UX/Accessibility**: Standardized inputs in the `SettingsPanel` component using `NumberInput` and `SelectInput`. This ensures consistent label association, better accessibility for screen readers, and improved UX with auto-select-on-focus for numeric fields.

## [0.6.8] - 2026-02-21

### Changed

- **UX/Accessibility**: Improved the `UnitConverter` component in the Utilities tab. Inputs now have accessible labels (`htmlFor`, `id`), select their content on focus for easier editing, and unit dropdowns have proper ARIA labels.

## [0.6.7] - 2026-02-19

### Changed

- **UX/Accessibility**: Standardized all numeric input fields using a new `NumberInput` component. This ensures consistent label association (for screen readers) and auto-select-on-focus behavior across the application.
- **Multi-Gas Tab**: Improved the "Custom Mix" input layout to use standard labeled inputs instead of a custom dual-input widget, improving accessibility and consistency.

## [0.6.6] - 2026-02-14

### Changed

- **Performance Optimization**: Reduced iteration counts for iterative solvers in `calculations.ts` (bleed-down and reverse solvers) from 40/50 to 25. This provides significant performance gains while maintaining precision far beyond physical measurement limits (~0.001 PSI).

## [0.6.5] - 2026-01-06

### Changed

- **Fill Instructions**: Reordered step directions to show the target pressure first, followed by the addition amount in parentheses. This allows blenders to focus on the next reading on their pressure gauge.
- **Dependencies**: Upgraded React and React DOM to version 19.x to ensure architectural alignment and resolve CI version mismatches.

### Fixed

- **Multi-Gas Blending**: Optimized bleed-down logic to suggest partial bleeds instead of always emptying the tank. This significantly reduces gas waste and cost when the target mix is reachable from a partial drain.

## [0.6.4] - 2026-01-06

### Changed

- **Settings UI**: Moved Tank Size and Rated Pressure settings from the General tab to the Pricing tab for better context.

## [0.6.3] - 2026-01-06

### Fixed

- **Input Behavior**: Resolved issue where clearing number inputs resulted in '0' causing editing friction. Inputs can now be fully cleared.

## [0.6.2] - 2026-01-06

### Changed

- **Settings UI**: Complete redesign of the Settings panel using a tabbed interface (General, Gases, Pricing) for better organization.
- **Calculate Button**: Updated "Calculate" buttons to be full-width for improved mobile usability.
- **UI Layout**: Added pinned headers and footers to the Settings panel to keep navigation and actions always visible.

## [0.6.1] - 2026-01-06

### Fixed

- **Persistent Crash**: Fixed "white screen" crash in Multi-Gas tab caused by invalid saved state (missing gas sources). Added a defensive check and a friendly Error Boundary.
- **Input Editing**: Improved number input behavior. Fields can now be cleared completely (allowing empty state) and no longer "fight" the user by reverting to 0 or aggressively clamping values while typing.

## [0.6.0] - 2026-01-06

### Added

- **Dynamic Multi-Gas Blending**: Support for 1-4 gas sources with add/remove buttons
- **N-Gas Solver**: 2-gas and 3-gas blend calculations using linear algebra (Cramer's rule)
- **Cost Optimization**: Alternatives ranked by estimated cost based on O₂/He prices
- **Bleed-Down Support**: Automatically suggests draining tank when target He% < start He%
- **Fill Order Recommendations**: Gases sorted by He content (highest first) for proper blending sequence
- **Alternative Selection**: Interactive UI to choose between multiple valid blend options

### Changed

- Multi-Gas tab completely rewritten for dynamic source management
- Blend Options accordion now always expanded for better visibility
- State structure updated: `MultiGasInput` now uses `gasSources[]` array (breaking change for stored sessions)

### Fixed

- Duplicate blend alternatives are now deduplicated based on gas combination and amounts

## [0.5.2] - 2026-01-05

### Fixed

- Multi-Gas tab no longer allows specifying a Target He % when no helium sources are available. The input is now disabled with an explanatory message when neither the start tank nor selected source gases contain helium.

## [0.5.1] - 2026-01-05

### Fixed

- Multi-Gas tab fill plan now correctly accounts for starting pressure when calculating cumulative fill totals. Previously, the "Tank @" pressures were off by the start pressure amount.

## v0.5.0

- **Feature:** Multi-Bank Blending: Added "Start Tank" input to Multi-Gas Match tab.
- **UI:** Refactored all tabs (Standard, Multi-Gas, Top-Off, Utilities) to use collapsible Accordion sections for better usability.
- **UI:** Improved organization of Utilities tab metrics.
- **Fix:** Corrected linting errors and improved type safety.

## [0.4.3] - 2026-01-04

### Added

- Manual input fields in "Top-Off What-If" tab to calculate bleed-down from a target final mix.

## [0.4.2] - 2026-01-04

### Fixed

- Resolved lint errors in `UtilitiesTab.tsx` and `main.tsx`.

## [0.4.1] - 2026-01-04

### Changed

- Reordered Utilities tab metrics: "Best Mix" grouped with "MOD", "EAD" grouped with "END".

## [0.4.0] - 2026-01-04

### Added

- Unit Converter utility for Depth (m/ft) and Pressure (bar/psi)
- "Max END" input to Best Mix calculator for Helium suggestions

### Changed

- Utilities tab now uses a collapsible Accordion UI layout
- Best Mix calculator now suggests Helium/Oxygen trimix blends instead of just O2%

### Fixed

- Metric calculation errors in MOD and END (removed double-conversion bugs)

All notable changes to this project will be documented here. This file follows reverse chronological order, with the newest release at the top.

## [0.3.0] - 2025-11-27

- Added a bleed-down slider to the Top-Off What-If tab so divers can preview mixes after simulated drains without altering their base inputs.
- Clarified the Standard Blend top-off selector with guidance about the non-O₂/He supply to help new users pick the right bank.
- Multi-Gas planner now offers a closest-match suggestion (±1% O₂ / ±5% He) when the exact blend cannot be produced with the chosen sources.

## [0.2.0] - 2025-11-18

- Added an in-app footer that surfaces the current version alongside a quick link to the release notes.
- Standard Blend tab now includes an interactive start-pressure sensitivity slider with ±50 PSI deltas and live recalculation.
- Added reverse solvers to Standard Blend for "required start pressure (no helium)" and "max target without helium" scenarios.
- Expanded Multi-Gas planner with Trimix presets, custom O₂/He mixes, target helium support, and resulting mix validation.
- Restored the bleed/down sensitivity chart inside the Top-Off What-If workflow alongside the final mix summary.
- Improved numeric inputs across the app so values auto-select on focus for faster mobile edits.

## [0.1.0] - 2025-11-05

- Introduced the Top-Off What-If tab for quick mix projections without defining a target blend.
- Refreshed app branding with the Barefoot Blender crest and updated PWA icons/favicons.
- Documented manual Wrangler-based deployments and removed the legacy GitHub Actions workflow.

## [0.0.1] - 2025-11-04

- Added a Wrangler configuration to support direct Cloudflare deployments from local builds.
