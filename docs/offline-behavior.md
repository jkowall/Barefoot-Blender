# Offline Behavior & PWA Notes

Barefoot Blender is designed to provide full functionality without a network connection once it has been loaded at least once.

## Service Worker Strategy

- Configured via `vite-plugin-pwa` in `vite.config.ts` with `registerType: "autoUpdate"`.
- The generated service worker precaches build assets, React bundles, and static icons.
- `autoUpdate` ensures that clients fetch updated assets in the background and activate them on the next navigation.

## Asset Caching

- `includeAssets: ["icon.svg"]` guarantees that the app icon is available for offline installation prompts.
- Additional assets placed under `public/` are automatically copied into the build and cached.

## Runtime Storage

- User preferences and recent inputs live in `localStorage` through Zustand persistence middleware.
- This data remains accessible offline and survives reloads.

## Installation

- Users can install the PWA from supported browsers (Chrome, Edge, Safari on iOS 16+, etc.).
- The app manifests as `Barefoot Blender` with a standalone display mode, dark theme color, and portrait orientation lock.

## Development Tips

- To test offline support locally, run `npm run build` followed by `npm run preview`, open the app, and toggle "Offline" mode in DevTools.
- Service worker updates require a full reload if the cached assets change. During development, running `npm run dev` bypasses the service worker to simplify iteration.

## Future Enhancements

- Add runtime caching for remote resources if the app expands to fetch live data (e.g., gas pricing).
- Consider exposing a manual "Check for Updates" action if release cadence accelerates.
