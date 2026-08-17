import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";

// En dev: la API vive en :3000 (VITE_API la apunta ahí, CORS abierto).
// En producción: el backend del Raspberry sirve esta build como estático (same-origin).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  // host: true -> escucha en 0.0.0.0, así funciona por localhost, por
  // 127.0.0.1 (IPv4, que si no queda fuera) y desde el móvil por la IP de la LAN.
  server: { host: true, port: 5173 },
  build: { outDir: "dist" },
});
