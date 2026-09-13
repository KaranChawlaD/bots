import path from "node:path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  server: {
    port: 5174,
    proxy: {
      // The real control panel API (src/ui/server.ts) — this app is a
      // presentation layer on top of it, no backend logic lives here.
      "/api": {
        target: process.env.CONTROL_PANEL_URL ?? "http://127.0.0.1:5173",
        changeOrigin: true,
      },
    },
  },
});
