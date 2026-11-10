import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// La API de verdad la sirve Vercel en /api. En local, `node scripts/nube-api.mjs`
// escucha en el 8787 y Vite le reenvía esas rutas.
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5180,
    proxy: { "/api": "http://127.0.0.1:8787" },
  },
  build: { outDir: "dist" },
});
