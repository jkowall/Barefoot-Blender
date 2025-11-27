# Changelog

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
