# Changelog

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
