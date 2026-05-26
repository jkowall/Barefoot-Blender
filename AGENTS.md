# AGENTS.md - LLM Development Guide

This document provides guidance for AI/LLM assistants working on the Barefoot Blender codebase.

## Mandatory First Step

Before planning or editing, read this file from disk, not only from pasted context.
Every implementation plan must explicitly cover:

- Code changes
- Tests or regression coverage
- Documentation impact
- Version and CHANGELOG decision
- Validation commands
- Commit and deployment policy

## Project Overview

Barefoot Blender is an offline-first Progressive Web App (PWA) and Capacitor-based native mobile app for scuba gas blending and dive planning. It calculates Nitrox/Trimix blends using partial pressure methods and provides dive planning utilities (MOD, EAD, END, density).

## Tech Stack

- **Framework**: React 19 with TypeScript
- **Build Tool**: Vite 7.x with `vite-plugin-pwa`
- **Native Mobile**: Capacitor iOS/Android projects under `ios/` and `android/`
- **Subscriptions**: RevenueCat for native iOS/Android entitlement checks
- **State Management**: Zustand (persisted to localStorage)
- **Styling**: Vanilla CSS (`src/index.css`)
- **Linting**: ESLint with TypeScript and React plugins
- **Testing**: Vitest for unit and calculation regression tests

## Project Structure

```
src/
├── components/          # UI components (one per tab)
│   ├── StandardBlendTab.tsx    # Main blend calculator
│   ├── MultiGasTab.tsx         # Two-gas Nitrox solver
│   ├── TopOffTab.tsx           # Top-off projections
│   ├── UtilitiesTab.tsx        # MOD/EAD/Best Mix/END/Density
│   ├── SettingsPanel.tsx       # User preferences
│   ├── SafetyAcknowledgement.tsx # First-run safety gate
│   └── SubscriptionPaywall.tsx # Native mobile subscription gate
├── state/               # Zustand stores
│   ├── settings.ts      # Global settings (units, PPO2, banks)
│   └── session.ts       # Per-tab input persistence
├── utils/               # Pure calculation functions
│   ├── calculations.ts  # Core blending/dive math
│   ├── format.ts        # Number formatting helpers
│   └── units.ts         # Unit conversion utilities
├── services/
│   └── subscription.ts  # RevenueCat integration boundary
├── App.tsx              # Tab navigation layout
├── main.tsx             # Entry point + PWA registration
└── index.css            # Global styles
ios/                     # Capacitor iOS project
android/                 # Capacitor Android project
public/privacy/          # Store privacy page
public/terms/            # Store terms page
public/support/          # Store support page
```

## Development Commands

```bash
npm install       # Install dependencies
npm run dev       # Start dev server (http://localhost:5173)
npm run build     # Production build to dist/
npm run preview   # Preview production build locally
npm run lint      # Run ESLint checks
npm run test      # Run Vitest regression tests once
npm run test:watch # Run Vitest in watch mode
npm run verify:calc # Run calculation regression vectors
npm run check     # Run lint, tests, and build
npm run build:mobile # Build web assets and sync Capacitor iOS/Android
npm run build:mobile:debug # Build native debug bundle with subscription bypass
npm run mobile:ios # Build, sync, and open Xcode project
npm run mobile:android # Build, sync, and open Android Studio project
```

## Definition of Done

A task is complete only when all items below are satisfied:

1. Code changes are implemented and scoped to the request
2. Tests/checks are updated if behavior changed
3. Required verification commands run successfully (see Verification Matrix)
4. Versioning/CHANGELOG impact is explicitly decided (required for release work only)
5. Final response includes files changed, why, validation run, and residual risks

## Ambiguity & Blocking Policy

If requirements are ambiguous, use the smallest safe change that preserves current UI/UX and existing calculation semantics. Document assumptions in the final response.

If blocked by missing requirements, state the blocker and propose the safest default behavior rather than stalling.

## Coding Conventions

### TypeScript

- Use strict TypeScript with explicit interface definitions
- Prefer `type` over `interface` for simple shapes
- Export types alongside functions that use them
- Use nullish coalescing (`??`) and optional chaining (`?.`)

### React Components

- Functional components with hooks only (no class components)
- Use Zustand's `useStore` hooks for state access
- Keep components focused on UI; business logic belongs in `utils/`
- JSX uses React 17+ automatic runtime (no `import React` needed)

### Calculations

- All math in `src/utils/calculations.ts` as pure functions
- Internal calculations use PSI; convert at boundaries via `units.ts`
- Use fractional values (0-1) internally, percentages (0-100) for I/O
- Include tolerance checks for floating-point comparisons (`tolerance = 1e-6`)

### State Management

- `SettingsStore`: Global preferences (units, PPO2, banks, narcotic rules)
- `SessionStore`: Last-used inputs per tab for session persistence
- Both persist via Zustand's `localStorage` middleware

### Styling

- Global styles in `src/index.css`
- Mobile-first responsive design
- High contrast, large touch targets for dive shop environments
- Dark theme with slate/blue color palette

## Adding New Features

### New Calculator/Utility

1. Add calculation logic as pure functions in `src/utils/calculations.ts`
2. Define input/output interfaces at top of file
3. Create UI component in `src/components/`
4. Add tab entry in `App.tsx`
5. Extend `SessionStore` if inputs should persist

### New Setting

1. Add to `SettingsStore` interface in `src/state/settings.ts`
2. Provide sensible default in the store initializer
3. Add UI control in `SettingsPanel.tsx`

### Native Mobile / Subscription Changes

1. Keep browser/PWA usage ungated unless explicitly asked otherwise
2. Keep native subscription logic behind `src/services/subscription.ts`
3. Use `VITE_REVENUECAT_IOS_API_KEY` and `VITE_REVENUECAT_ANDROID_API_KEY` for real native subscription builds
4. Use `npm run build:mobile:debug` only for local simulator/device debugging before RevenueCat products are configured
5. Do not upload builds produced with `VITE_DEBUG_SUBSCRIPTION_BYPASS=true` to TestFlight, Google Play, or production
6. Preserve the first-run safety acknowledgement and store/legal links unless the task explicitly changes compliance UX

### Extending Calculations

- Follow existing patterns in `calculations.ts`
- Use `sanitizeMix()` for input validation
- Return structured result objects with `success`, `warnings`, `errors`
- Support both PSI and bar units at input/output boundaries

## Verification & Testing

### Verification Matrix

Run these commands based on the type of change:

1. **UI, state, styling, or app wiring changes**:
   - `npm run lint`
   - `npm run test`
   - `npm run build`
   - For native app wiring, also run `npm run build:mobile`
2. **Calculation logic changes** (`src/utils/calculations.ts` and related math):
   - `npm run lint`
   - `npm run verify:calc`
   - Run the known-value calculation vectors listed below
   - Add/update lightweight regression coverage as described in "Calculation Regression Harness"
   - `npm run build`
3. **Documentation-only changes**:
   - No build required unless docs reference commands/config changed by the same task
4. **Native mobile release/signing changes**:
   - `npm run check`
   - `npm run build:mobile`
   - `npx cap doctor`
   - `cd android && ./gradlew bundleRelease`
   - `xcodebuild -project ios/App/App.xcodeproj -scheme App -destination 'platform=iOS Simulator,name=iPhone 17' -configuration Debug CODE_SIGNING_ALLOWED=NO build`

### Manual Testing Checklist

Before submitting changes, verify:

1. **Build succeeds**: `npm run build` completes without errors
2. **Lint passes**: `npm run lint` shows no violations
3. **TypeScript compiles**: No type errors in IDE or build output
4. **PWA works offline**: After first load, app functions without network
5. **Settings persist**: Reload preserves user preferences
6. **Units work**: Toggle PSI/bar and ft/m; calculations update correctly
7. **Native debug build works**: `npm run build:mobile:debug`, then Xcode/Android Studio simulator run should open without requiring RevenueCat keys

### Calculation Verification

Test blending scenarios against known values:

- **Fresh Nitrox**: Empty → 32% at 3000 PSI with Air top should require ~460 PSI O2
- **MOD for 32% at PPO2 1.4**: Should equal ~111 ft (33.8 m)
- **EAD for 32% at 100 ft**: Should equal ~82 ft
- **Bleed-down**: Start He% > target He% should trigger drain instruction

### Calculation Regression Harness

Maintain a lightweight, repeatable regression harness for known-value calculation vectors.

- Preferred: executable script/test target (for example `npm run verify:calc`)
- Minimum acceptable: committed test file or script that validates the four vectors above
- Requirement: when changing calculation logic, add or update regression cases in the harness
- Standard runner: Vitest. Do not add Bun, Jest, Cypress, or Playwright for calculation/unit coverage unless the task explicitly requires that layer.

### Browser Testing

- Test on Chrome, Safari, Firefox
- Verify mobile responsiveness (iOS Safari, Android Chrome)
- Test PWA install flow ("Add to Home Screen")

### Native Testing

- Open iOS project at `ios/App/App.xcodeproj`.
- Use Xcode simulator first; select the `App` scheme and an iPhone simulator.
- Open Android project from `android/` in Android Studio.
- For Android command-line release bundles, ensure `JAVA_HOME`, `ANDROID_HOME`, and `ANDROID_SDK_ROOT` point to Android Studio JBR and the user SDK.
- Real subscription testing requires RevenueCat project setup plus App Store Connect and Google Play subscription products.

## Documentation Reference

- [`docs/calculation-model.md`](docs/calculation-model.md) - Formula details
- [`docs/ui-overview.md`](docs/ui-overview.md) - UI intent and patterns
- [`docs/offline-behavior.md`](docs/offline-behavior.md) - PWA/caching strategy
- [`docs/mobile-release.md`](docs/mobile-release.md) - native app store release workflow
- [`design.md`](design.md) - Original functional specification

## Common Pitfalls

1. **Unit confusion**: Internal math is PSI; use `fromDisplayPressure`/`toDisplayPressure`
2. **Floating-point**: Use `isCloseToZero()` for zero comparisons
3. **Fraction vs percent**: Functions expect 0-1 fractions; UI shows 0-100%
4. **Helium constraints**: Start He% > target He% requires bleed-down logic
5. **PWA cache**: After changes, may need to close all tabs and reopen to see updates
6. **Debug vs production mobile builds**: `build:mobile:debug` intentionally bypasses native subscription gating and must not be submitted to stores
7. **Native generated assets**: Capacitor copies web bundles into native projects; ESLint must ignore generated native asset/build output
8. **iOS splash warnings**: Generated splash assets can trigger Xcode "unassigned children" warnings; clean asset catalog before App Store submission if warnings remain

## Protected Areas (Do Not Touch Unless Asked)

Avoid changing these unless the task explicitly requires it:

- PWA/service worker caching strategy (`vite-plugin-pwa` config, offline behavior)
- Deployment configuration (`wrangler.jsonc`, Cloudflare deployment settings)
- Core gas bank defaults and blending assumptions in settings
- Domain formulas or constants outside the requested scope
- Native subscription gating and debug bypass behavior outside requested mobile/subscription work

## Deployment

**Production URL**: [https://trimix-blender.com](https://trimix-blender.com)

**All commits must be signed** (`git commit -S`). Ensure GPG is configured for your git user.

Production deploys automatically when `main` is pushed to GitHub. For normal release work, the expected flow is:

```bash
npm run build
git push origin main
```

After pushing, verify production is serving the new build by checking `https://trimix-blender.com` or the current hashed asset in `dist/`.

Wrangler is only a manual fallback path and requires an authenticated Cloudflare session or `CLOUDFLARE_API_TOKEN` in non-interactive shells:

```bash
npm run build
npx wrangler deploy
```

Ensure authenticated via `npx wrangler login` first when using Wrangler interactively.

## Native Mobile Release

Native release details live in `docs/mobile-release.md`. Current defaults:

- App/package ID: `com.trimixblender.barefootblender`
- RevenueCat entitlement: `pro`
- Apple annual product: `barefoot_blender_pro_annual`
- Google subscription: `barefoot_blender_pro`
- Google annual base plan: `annual-499`
- Price target: `$4.99/year`

App Store and Play Store submissions are manual/account-owner-gated. Do not treat a local native build as deployed.

## Commit & Push Expectations

- Do not commit unless the user asks for a commit/push.
- When committing in this repo, use signed commits: `git commit -S`.
- Keep unrelated edits out of task commits.
- Prefer one logical commit per task unless the user asks otherwise.

## Versioning & Release Checklist

Apply this checklist to release PRs, tagged releases, or merges to `main` intended for deployment. Do not force version bumps for every local fix PR.

1. **Bump the version** in `package.json`:
   - `npm version patch` - Bug fixes and minor changes
   - `npm version minor` - New features
   - `npm version major` - Breaking changes

2. **Update `CHANGELOG.md`**:
   - Add entry with format `[X.Y.Z] - YYYY-MM-DD`
   - Describe what was added, changed, or fixed
   - Group by: Added, Changed, Fixed, Removed (as applicable)

3. **Update `README.md`** if the change affects:
   - Available features or functionality
   - Usage instructions or commands
   - Project structure or dependencies
   - Configuration options

4. **Update mobile release docs** if the change affects:
   - Capacitor commands or native project layout
   - RevenueCat product IDs, entitlement IDs, or subscription behavior
   - Store listing, privacy, terms, support, signing, or validation workflow

5. **Commit all updates together** with a signed commit:
   ```bash
   git add -A
   git commit -S -m "Release vX.Y.Z: Brief description"
   git push
   ```

> **Important**: Complete all versioning steps before publishing a release.

## Assistant Final Response Format

Final responses should include:

1. Files changed
2. What changed and why
3. Validation commands run and outcomes
4. Residual risks, assumptions, or follow-up work

## Key Domain Concepts

- **Partial Pressure Blending**: Adding pure O2/He then topping with mix gas
- **Nitrox**: O2-enriched air (typically 22-40% O2)
- **Trimix**: O2/He/N2 blend for deep technical diving
- **MOD (Maximum Operating Depth)**: Deepest safe depth for a PPO2 limit
- **EAD (Equivalent Air Depth)**: Air dive causing same N2 narcosis
- **END (Equivalent Narcotic Depth)**: Depth with equivalent narcotic effect
- **Bleed-down**: Draining tank before re-blending when He% must decrease
