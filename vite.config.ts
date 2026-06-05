import { defineConfig } from "vite";
import { execSync } from "node:child_process";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// Stamp the current git commit so the running app can show which build it is — the
// fastest way to confirm a pull actually took effect. Falls back to "dev" if git
// isn't available.
let buildId = "dev";
try {
  buildId = execSync("git rev-parse --short HEAD").toString().trim();
} catch {
  /* not a git checkout */
}

// gencom-stay is installed to the iPhone/iPad home screen as a PWA. The manifest
// and service worker below are what make "Add to Home Screen" behave like a real
// app (own icon, standalone window, offline shell).
export default defineConfig({
  define: {
    __BUILD_ID__: JSON.stringify(buildId),
  },
  server: {
    // Always use this exact port, and FAIL LOUDLY if it's already taken (instead of
    // silently moving to another port, which makes you reload a stale old server).
    port: 5173,
    strictPort: true,
  },
  plugins: [
    react(),
    VitePWA({
      // selfDestroying makes any previously-installed service worker unregister and
      // wipe its caches, so a stale cached build can't keep serving old files during
      // this prototyping phase. Re-enable normal caching before production deploy.
      selfDestroying: true,
      injectRegister: "auto",
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "apple-touch-icon.png"],
      manifest: {
        name: "Gencom Mail",
        short_name: "Gencom Mail",
        description: "An Outlook companion that learns what matters.",
        theme_color: "#3A5A20",
        background_color: "#E3ECD6",
        display: "standalone",
        orientation: "portrait",
        start_url: "/",
        icons: [
          { src: "pwa-192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "pwa-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        // Cache the app shell; Graph API calls are always fetched live (never cached).
        navigateFallbackDenylist: [/^https:\/\/graph\.microsoft\.com/],
      },
    }),
  ],
});
