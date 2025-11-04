# Barefoot Blender

Barefoot Blender is an offline-first Progressive Web App that assists scuba divers, fill station operators, and technical teams with advanced gas blending and dive-planning utilities. The tool supports Nitrox and Trimix workflows, bleed-down guidance, top-off efficiency projections, multi-bank Nitrox mixes, and a suite of gas analysis calculators.

## Features

- **Standard Blend Planner** – Partial pressure blending with automatic bleed-down solutions, warnings, and a multi-scenario top-off chart.
- **Multi-Gas Nitrox Mixing** – Linear solver for filling from two banked gases with support for custom oxygen percentages.
- **Dive Utilities** – MOD, EAD, Best Mix, END, and density calculators that honor global PPO2 and narcotic settings.
- **Persistent Settings** – Local storage of preferred units, PPO2 defaults, narcotic rules, and custom banked gases.
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

## Cloudflare Pages Deployment

GitHub Actions in `.github/workflows/deploy.yml` automate linting, building, and publishing to Cloudflare Pages.

1. Create or select a Cloudflare Pages project for the site.
2. Add required secrets in the GitHub repository settings:
	- `CLOUDFLARE_API_TOKEN` – Deployment token scoped to the Pages project.
	- `CLOUDFLARE_ACCOUNT_ID` – Your Cloudflare account identifier.
	- `CLOUDFLARE_PROJECT_NAME` – The Pages project slug (e.g., `barefoot-blender`).
3. Push commits to `main` or trigger the workflow manually. Successful runs upload the `dist/` build output to Pages.

The workflow uses Node 20, caches npm dependencies, runs `npm run lint`, and executes `npm run build` before deployment.

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

## License

Distributed under the [Apache License, Version 2.0](LICENSE).
