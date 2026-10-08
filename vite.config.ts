import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { configDefaults } from "vitest/config";
import packageJson from "./package.json";

// The dev server injects inline scripts (React Refresh preamble) and <style> tags for HMR,
// which the production CSP in index.html blocks. Relax it for `vite` dev only; builds keep it strict.
const relaxCspForDevServer = (): Plugin => ({
  name: "relax-csp-for-dev-server",
  apply: "serve",
  transformIndexHtml: (html) =>
    html
      .replace("script-src 'self';", "script-src 'self' 'unsafe-inline';")
      .replace("style-src 'self';", "style-src 'self' 'unsafe-inline';")
      .replace("connect-src 'self';", "connect-src 'self' ws: wss:;")
});

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version)
  },
  test: {
    // Claude Code git worktrees live under .claude/worktrees/ with their own src/ copies;
    // without this, `vitest run` and path filters like verify:calc also run those stale tests.
    exclude: [...configDefaults.exclude, ".claude/**"]
  },
  plugins: [
    relaxCspForDevServer(),
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["logo.png", "logo-512.png", "logo-192.png", "logo-64.png"],
      manifest: {
        name: "Barefoot Blender",
        short_name: "Blender",
        description: "Advanced gas blending planner for scuba diving",
        theme_color: "#0f172a",
        background_color: "#0f172a",
        display: "standalone",
        orientation: "portrait",
        icons: [
          {
            src: "logo-192.png",
            sizes: "192x192",
            type: "image/png"
          },
          {
            src: "logo-512.png",
            sizes: "512x512",
            type: "image/png"
          },
          {
            src: "logo.png",
            sizes: "1024x1024",
            type: "image/png"
          }
        ]
      }
    })
  ]
});
