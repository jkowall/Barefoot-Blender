# Barefoot Blender Copilot Code Review Instructions

## Purpose

Use these instructions when reviewing pull requests in this repository. Focus on defects, safety regressions, release risk, and missing validation.

## Domain And Safety

- Treat gas blending math as safety-sensitive. Flag calculation changes that lack regression coverage or clear unit handling.
- Internal pressure math must use PSI. Convert display pressure only at UI and utility boundaries.
- Internal gas fractions must use `0-1` values. UI input and output may use percentages.
- Calculation changes should keep pure logic in `src/utils/calculations.ts`, with structured `success`, `warnings`, and `errors` outputs where applicable.
- Check known vectors when calculation logic changes: fresh 32% Nitrox at 3000 PSI needs about 460 PSI O2, 32% MOD at PPO2 1.4 is about 111 ft, 32% EAD at 100 ft is about 82 ft, and start He above target He needs bleed-down handling.

## React And State

- Prefer strict TypeScript, explicit exported types for public helper shapes, nullish coalescing, and optional chaining.
- Keep React components focused on UI. Move reusable business logic and calculations into `src/utils/`.
- Preserve Zustand persistence semantics in `src/state/settings.ts` and `src/state/session.ts`.
- Flag changes that make persisted settings incompatible without a migration or a safe default.

## Offline, Native, And Subscription Boundaries

- Keep browser and PWA usage ungated unless the PR explicitly changes that requirement.
- Keep native subscription behavior behind `src/services/subscription.ts`.
- Flag any path where `VITE_DEBUG_SUBSCRIPTION_BYPASS=true` could affect TestFlight, Google Play, or production builds.
- Treat PWA cache strategy, `vite-plugin-pwa` config, Cloudflare deployment config, native signing, and core gas bank defaults as protected areas unless the PR explicitly scopes them.

## Tests And CI

- UI, state, styling, or app wiring changes should preserve `npm run lint`, `npm run test`, and `npm run build`.
- Calculation changes should preserve `npm run lint`, `npm run verify:calc`, and `npm run build`, with updated regression vectors when behavior changes.
- Native wiring changes should consider `npm run build:mobile`, `npx cap doctor`, Android Gradle smoke checks, and iOS simulator builds without signing.
- Do not suggest GitHub Actions as the source of truth for signed native release artifacts. Local signing material and store-console state are required.

## Documentation And Release Review

- Check README or docs updates when user-visible features, commands, project structure, configuration, mobile release flow, legal links, or subscription behavior change.
- Do not require version or CHANGELOG updates for every local fix PR. Require them for release PRs, tagged releases, or merges to `main` intended for deployment.
- For PRs that affect production behavior, verify the validation plan accounts for the web PWA and Capacitor native projects separately.

## Review Style

- Lead with actionable bugs, regressions, missing tests, and release risks.
- Prefer concise comments tied to exact changed lines.
- Explain why a recommendation matters technically, especially for safety, offline behavior, or native release risk.
