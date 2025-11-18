import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import packageJson from "./package.json";

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version)
  },
  plugins: [
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
  ],
  server: {
    host: true
  }
});
