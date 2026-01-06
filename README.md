# Barefoot Blender

Barefoot Blender is an offline-first Progressive Web App that assists scuba divers, fill station operators, and technical teams with advanced gas blending and dive-planning utilities. The tool supports Nitrox and Trimix workflows, bleed-down guidance, top-off efficiency projections, multi-bank Nitrox mixes, and a suite of gas analysis calculators.

Source code: [github.com/jkowall/Barefoot-Blender](https://github.com/jkowall/Barefoot-Blender)

## Features

- **Standard Blend Planner** – Partial pressure blending with automatic bleed-down solutions, warnings, an interactive sensitivity slider, and reverse solvers for required start pressure and helium-free targets.
- **Top-Off What-If** – Quick projections for topping a cylinder, including final mix readouts and a bleed/down sensitivity chart tied to the selected bank.
- **Dynamic Multi-Gas Blending** – Support for 1-4 gas sources with add/remove buttons, linear solver for two source gases with Trimix presets, custom O₂/He mixes, target helium support, cost optimization, and fill order recommendations.
- **Gas Cost Calculator** – Calculates the cost of gas fills based on user-configured prices per cubic foot, tank size, and rated pressure.
- **Dive Utilities** – MOD, EAD, Best Mix, END, and density calculators that honor global PPO₂ and narcotic settings.
- **Persistent Settings** – Local storage of preferred units, PPO₂ defaults, narcotic rules, and custom banked gases.
- **Installable PWA** – Works fully offline after first load via Vite PWA service worker integration.

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

## Project Structure

```
Barefoot Blender/
├─ docs/                          # Supplementary documentation
├─ public/                        # Static assets (PWA icons, etc.)
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

## Extending the App

1. **Add new calculators** – Implement reusable math helpers in `src/utils`, store state in `session.ts`, and surface UI in a dedicated component.
2. **Enhance settings** – Extend `SettingsStore` with new toggles and expose them in `SettingsPanel`.
3. **Polish styling** – Update `index.css` or introduce a component-level styling solution (e.g., CSS Modules) to refine the UI.

## Documentation

Additional background materials live in the [`docs/`](docs) directory:

- [`docs/calculation-model.md`](docs/calculation-model.md)
- [`docs/ui-overview.md`](docs/ui-overview.md)
- [`docs/offline-behavior.md`](docs/offline-behavior.md)

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
