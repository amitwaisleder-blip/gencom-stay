import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// gencom-stay is installed to the iPhone/iPad home screen as a PWA. The manifest
// and service worker below are what make "Add to Home Screen" behave like a real
// app (own icon, standalone window, offline shell).
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "apple-touch-icon.png"],
      manifest: {
        name: "gencom-stay",
        short_name: "gencom-stay",
        description: "An Outlook companion that learns what matters.",
        theme_color: "#0f172a",
        background_color: "#0f172a",
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
