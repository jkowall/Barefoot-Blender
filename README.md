# Barefoot Blender

Barefoot Blender is an offline-first Progressive Web App that assists scuba divers, fill station operators, and technical teams with advanced gas blending and dive-planning utilities. The tool supports Nitrox and Trimix workflows, bleed-down guidance, top-off efficiency projections, multi-bank Nitrox mixes, and a suite of gas analysis calculators.

Source code: [github.com/jkowall/Barefoot-Blender](https://github.com/jkowall/Barefoot-Blender)

## Features

- **Standard Blend Planner** – Partial pressure blending with automatic bleed-down solutions, warnings, an interactive sensitivity slider, and reverse solvers for required start pressure and helium-free targets.
- **Top-Off What-If** – Quick projections for topping a cylinder, including final mix readouts, fill cost, and a bleed/down sensitivity chart tied to the selected bank.
- **Dynamic Multi-Gas Blending** – Support for 1-4 gas sources with add/remove buttons, per-source bank pressure limits, linear solver for two source gases with Trimix presets, custom O₂/He mixes, target helium support, cost optimization, tank-volume cost basis, and fill order recommendations.
- **Gas Cost Calculator** – Calculates fill cost with O₂, He, and top-off gas line items using configurable O₂/He/Top-Off pricing, per-fill tank size, and rated pressure.
- **Tank Conversion** – Converts PSI, cubic feet, and free gas liters using the active tank volume and rated pressure.
- **Blend History + Recreate** – Stores successful Standard Blend plans locally with quick recreate/remove/clear actions.
- **Dive Utilities** – MOD, EAD, Best Mix, END, and density calculators that honor global PPO₂ and narcotic settings.
- **Persistent Settings** – Local storage of preferred units, PPO₂ defaults, narcotic rules, and custom banked gases.
- **Installable PWA** – Works fully offline after first load via Vite PWA service worker integration.
- **In-App Bug Reporting** – Opens prefilled support email reports with optional sanitized diagnostics and a copy fallback.
- **Native Mobile Release Path** – Capacitor projects for iOS and Android with RevenueCat-backed annual subscription access.

## Tech Stack

- [React 18](https://react.dev/) with TypeScript
- [Vite](https://vitejs.dev/) build tooling and dev server
- [Zustand](https://github.com/pmndrs/zustand) for state persistence
- [vite-plugin-pwa](https://vite-pwa-org.netlify.app/) for service worker generation

## Getting Started

```bash
npm install
npm run dev
```

- Open the dev server URL shown in the terminal (defaults to `http://localhost:5173`).
- Use your browser's "Install App" or "Add to Home Screen" option to pin the PWA locally.

### Available Scripts

- `npm run dev` – Start the development server with hot module replacement.
- `npm run build` – Produce a production bundle in `dist/` with pre-cached assets.
- `npm run preview` – Preview the production build locally.
- `npm run lint` – Run ESLint against the TypeScript source.
- `npm run test` – Run the Vitest regression suite once.
- `npm run test:watch` – Run Vitest in watch mode for local development.
- `npm run verify:calc` – Run the calculation regression vectors only.
- `npm run check` – Run lint, tests, and production build in sequence.
- `npm run build:mobile` – Build the web app and sync Capacitor iOS/Android projects.
- `npm run build:mobile:debug` – Build a simulator/device debug bundle that bypasses native subscription gating.
- `npm run debug:ios` – Build the debug mobile bundle and open the iOS project in Xcode.
- `npm run debug:android` – Start an Android emulator, build the debug mobile bundle, install it, and run it.
- `npm run mobile:ios` – Build, sync, and open the iOS project in Xcode.
- `npm run mobile:ios:debug` – Build the debug subscription-bypass bundle and open the iOS project.
- `npm run mobile:android` – Build, sync, and open the Android project in Android Studio.
- `npm run mobile:android:debug` – Build the debug subscription-bypass bundle and open the Android project.

### Native Mobile Subscriptions

The iOS and Android apps use Capacitor with RevenueCat. Browser/PWA usage remains ungated; native app access is gated by the `pro` entitlement.

- Entitlement: `pro`
- Apple annual product: `barefoot_blender_pro_annual`
- Google subscription: `barefoot_blender_pro`
- Google annual base plan: `annual-499`
- Price target: `$4.99/year`

Set the public RevenueCat SDK keys in the build environment before native subscription testing:

```bash
VITE_REVENUECAT_IOS_API_KEY=appl_...
VITE_REVENUECAT_ANDROID_API_KEY=goog_...
```

For local simulator debugging without RevenueCat products, build with:

```bash
npm run debug:ios
npm run debug:android
```

These commands run `npm run build:mobile:debug` and unlock the native app shell by setting `VITE_DEBUG_SUBSCRIPTION_BYPASS=true` at build time. The iOS command opens `ios/App/App.xcodeproj`; the Android command starts the first available emulator, then installs and runs the app. To choose a specific Android virtual device, run `ANDROID_AVD=Pixel_10_Pro_Fold_-_EMU npm run debug:android`. Do not use the debug build for TestFlight, Play testing, or production submissions.

See [`docs/mobile-release.md`](docs/mobile-release.md) for account setup, signing, upload, store listing, and validation steps.

## Project Structure

```
Barefoot Blender/
├─ docs/                          # Supplementary documentation
├─ public/                        # Static assets (PWA icons, etc.)
├─ ios/                           # Capacitor iOS project
├─ android/                       # Capacitor Android project
├─ src/
│  ├─ components/                 # UI modules for each major feature
│  ├─ state/                      # Zustand stores for settings & session data
│  ├─ utils/                      # Calculation, conversion, and formatting helpers
│  ├─ App.tsx                     # Top-level tab layout and navigation
│  ├─ main.tsx                    # React entry point & PWA registration
│  └─ index.css                   # Global styles
├─ design.md                      # Original functional specification
├─ README.md                      # This file
└─ vite.config.ts                 # Build and PWA configuration
```

## Cloudflare Deployment

Deployments are handled manually with Wrangler after a local build:

```bash
npm run build
npx wrangler deploy
```

Ensure you are authenticated with Cloudflare (`npx wrangler login`) and that `wrangler.jsonc` points to the correct asset directory.

## Persistence & Offline Behavior

- Settings and last-used inputs persist via `localStorage` to enable quick recalculations.
- The service worker uses the `autoUpdate` strategy so clients fetch fresh assets when available while remaining fully functional offline.
- Native iOS and Android builds serve bundled app assets through Capacitor and use RevenueCat entitlement caching after a successful online subscription verification.

## Extending the App

1. **Add new calculators** – Implement reusable math helpers in `src/utils`, cover calculation changes with Vitest regression tests, store state in `session.ts`, and surface UI in a dedicated component.
2. **Enhance settings** – Extend `SettingsStore` with new toggles and expose them in `SettingsPanel`.
3. **Polish styling** – Update `index.css` or introduce a component-level styling solution (e.g., CSS Modules) to refine the UI.

## Documentation

Additional background materials live in the [`docs/`](docs) directory:

- [`docs/calculation-model.md`](docs/calculation-model.md)
- [`docs/ui-overview.md`](docs/ui-overview.md)
- [`docs/offline-behavior.md`](docs/offline-behavior.md)
- [`docs/mobile-release.md`](docs/mobile-release.md)

Refer to these documents for formula references, UI intent, and caching strategies.

## Versioning

- Bump the project version in `package.json` (for example with `npm version patch`).
- Add a corresponding entry to [`CHANGELOG.md`](CHANGELOG.md) using the `[#.#.#] - YYYY-MM-DD` format.
- The UI footer reads the version injected at build time, so no additional code changes are required after updating `package.json`.

## Changelog

See [`CHANGELOG.md`](CHANGELOG.md) for a timeline of recent updates and feature additions.

## Credits

- **Inspiration & Direction:** John Bentley, technical diving and gas-mixing expert — learn more at [barefootbentley.com](https://barefootbentley.com/) and don’t forget to follow his [YouTube channel](https://www.youtube.com/@barefootbentley) and [Instagram](https://www.instagram.com/barefoot_bentley).
- **Development:** Jonah Kowall is an avid scuba diver on both open and closed circuit scuba. He is an open-source maintainer for OpenSearch and Jaeger and a longtime advocate of community-driven observability tooling. Check out his [YouTube channel](https://www.youtube.com/@jkowall) and [Instagram](https://www.instagram.com/jkowall).
- **AI Pairing:** Google Antigravity and GitHub Copilot using Google Gemini Pro High and Claude Opus 4.5 assisted with programming and refactoring.

## License

Distributed under the [Apache License, Version 2.0](LICENSE).
