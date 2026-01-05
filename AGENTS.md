# AGENTS.md - LLM Development Guide

This document provides guidance for AI/LLM assistants working on the Barefoot Blender codebase.

## Project Overview

Barefoot Blender is an offline-first Progressive Web App (PWA) for scuba gas blending and dive planning. It calculates Nitrox/Trimix blends using partial pressure methods and provides dive planning utilities (MOD, EAD, END, density).

## Tech Stack

- **Framework**: React 18 with TypeScript
- **Build Tool**: Vite 7.x with `vite-plugin-pwa`
- **State Management**: Zustand (persisted to localStorage)
- **Styling**: Vanilla CSS (`src/index.css`)
- **Linting**: ESLint with TypeScript and React plugins

## Project Structure

```
src/
├── components/          # UI components (one per tab)
│   ├── StandardBlendTab.tsx    # Main blend calculator
│   ├── MultiGasTab.tsx         # Two-gas Nitrox solver
│   ├── TopOffTab.tsx           # Top-off projections
│   ├── UtilitiesTab.tsx        # MOD/EAD/Best Mix/END/Density
│   └── SettingsPanel.tsx       # User preferences
├── state/               # Zustand stores
│   ├── settings.ts      # Global settings (units, PPO2, banks)
│   └── session.ts       # Per-tab input persistence
├── utils/               # Pure calculation functions
│   ├── calculations.ts  # Core blending/dive math
│   ├── format.ts        # Number formatting helpers
│   └── units.ts         # Unit conversion utilities
├── App.tsx              # Tab navigation layout
├── main.tsx             # Entry point + PWA registration
└── index.css            # Global styles
```

## Development Commands

```bash
npm install       # Install dependencies
npm run dev       # Start dev server (http://localhost:5173)
npm run build     # Production build to dist/
npm run preview   # Preview production build locally
npm run lint      # Run ESLint checks
```

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

### Extending Calculations

- Follow existing patterns in `calculations.ts`
- Use `sanitizeMix()` for input validation
- Return structured result objects with `success`, `warnings`, `errors`
- Support both PSI and bar units at input/output boundaries

## Verification & Testing

### Manual Testing Checklist

Before submitting changes, verify:

1. **Build succeeds**: `npm run build` completes without errors
2. **Lint passes**: `npm run lint` shows no violations
3. **TypeScript compiles**: No type errors in IDE or build output
4. **PWA works offline**: After first load, app functions without network
5. **Settings persist**: Reload preserves user preferences
6. **Units work**: Toggle PSI/bar and ft/m; calculations update correctly

### Calculation Verification

Test blending scenarios against known values:

- **Fresh Nitrox**: Empty → 32% at 3000 PSI with Air top should require ~460 PSI O2
- **MOD for 32% at PPO2 1.4**: Should equal ~111 ft (33.8 m)
- **EAD for 32% at 100 ft**: Should equal ~82 ft
- **Bleed-down**: Start He% > target He% should trigger drain instruction

### Browser Testing

- Test on Chrome, Safari, Firefox
- Verify mobile responsiveness (iOS Safari, Android Chrome)
- Test PWA install flow ("Add to Home Screen")

## Documentation Reference

- [`docs/calculation-model.md`](docs/calculation-model.md) - Formula details
- [`docs/ui-overview.md`](docs/ui-overview.md) - UI intent and patterns
- [`docs/offline-behavior.md`](docs/offline-behavior.md) - PWA/caching strategy
- [`design.md`](design.md) - Original functional specification

## Common Pitfalls

1. **Unit confusion**: Internal math is PSI; use `fromDisplayPressure`/`toDisplayPressure`
2. **Floating-point**: Use `isCloseToZero()` for zero comparisons
3. **Fraction vs percent**: Functions expect 0-1 fractions; UI shows 0-100%
4. **Helium constraints**: Start He% > target He% requires bleed-down logic
5. **PWA cache**: After changes, may need to close all tabs and reopen to see updates

## Deployment

**Production URL**: [https://trimix-blender.com](https://trimix-blender.com)

```bash
npm run build
npx wrangler deploy   # Deploys to Cloudflare Pages
```

Ensure authenticated via `npx wrangler login` first.

## Versioning

1. Bump version: `npm version patch|minor|major`
2. Update `CHANGELOG.md` with `[X.Y.Z] - YYYY-MM-DD` entry
3. Build and deploy

## Key Domain Concepts

- **Partial Pressure Blending**: Adding pure O2/He then topping with mix gas
- **Nitrox**: O2-enriched air (typically 22-40% O2)
- **Trimix**: O2/He/N2 blend for deep technical diving
- **MOD (Maximum Operating Depth)**: Deepest safe depth for a PPO2 limit
- **EAD (Equivalent Air Depth)**: Air dive causing same N2 narcosis
- **END (Equivalent Narcotic Depth)**: Depth with equivalent narcotic effect
- **Bleed-down**: Draining tank before re-blending when He% must decrease
