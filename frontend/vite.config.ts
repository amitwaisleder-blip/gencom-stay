import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // `@/` is scoped to the Intern Program module so the ported code
      // can keep its original imports without rewriting every line.
      "@": path.resolve(__dirname, "src/pages/InternProgram"),
    },
  },
  server: {
    // Bind to IPv4 explicitly. Vite's default localhost bind is IPv6-only on
    // Windows, which Chrome (IPv4-first resolver) misses → ERR_CONNECTION_REFUSED.
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/api": "http://localhost:8000",
      "/files": "http://localhost:8000",
    },
  },
});
