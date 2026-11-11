#!/usr/bin/env node
/**
 * Arranca TODO el sistema de desarrollo de una vez:
 *   backend + bootstrap del admin + printer-worker + PWA (+ impresora falsa con --fake)
 *
 * Multiplataforma: funciona en Linux (Arch incluido), macOS y Windows.
 *
 * Uso:   node scripts/dev.mjs [--fake]
 *   --fake  arranca también una impresora térmica falsa en :9100
 *
 * Ctrl+C para todo: mata todos los procesos hijos.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pnpmInvocation } from "./package-manager.mjs";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const conFake = process.argv.includes("--fake");
const esWin = process.platform === "win32";

const colores = { backend: "\x1b[36m", worker: "\x1b[33m", pwa: "\x1b[35m", fake: "\x1b[32m", sys: "\x1b[90m" };
const RESET = "\x1b[0m";
const log = (quien, linea) => process.stdout.write(`${colores[quien] ?? ""}[${quien}]${RESET} ${linea}`);

const hijos = [];
function lanzar(nombre, cmd, args, opts = {}) {
  const p = spawn(cmd, args, {
    cwd: opts.cwd ?? raiz,
    env: { ...process.env, ...opts.env },
    shell: esWin,
    detached: !esWin, // POSIX: cada hijo lidera su grupo -> kill(-pid) mata el árbol entero
  });
  hijos.push(p);
  p.stdout.on("data", (d) => d.toString().split("\n").filter(Boolean).forEach((l) => log(nombre, l + "\n")));
  p.stderr.on("data", (d) => d.toString().split("\n").filter(Boolean).forEach((l) => log(nombre, l + "\n")));
  p.on("exit", (code) => log("sys", `${nombre} terminó (código ${code})\n`));
  return p;
}

function matarTodo() {
  log("sys", "cerrando todos los procesos...\n");
  for (const p of hijos) {
    if (esWin) {
      // En Windows, kill del árbol completo (shell:true crea proceso intermedio).
      spawn("taskkill", ["/pid", String(p.pid), "/T", "/F"], { shell: true });
    } else {
      try { process.kill(-p.pid, "SIGTERM"); } catch { p.kill("SIGTERM"); }
    }
  }
  setTimeout(() => process.exit(0), 800);
}
process.on("SIGINT", matarTodo);
process.on("SIGTERM", matarTodo);

/** IP de la LAN, para poder abrir la app desde el móvil. */
function ipLocal() {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const i of ifaces ?? []) {
      if (i.family === "IPv4" && !i.internal) return i.address;
    }
  }
  return "127.0.0.1";
}

/** Lee la versión actual de la app desde su fuente, para poder imprimirla
 *  en la terminal — así se sabe de un vistazo qué build se está sirviendo,
 *  sin depender de lo que muestre (o no) el navegador. */
function versionApp() {
  try {
    const src = fs.readFileSync(path.join(raiz, "apps/pwa-camarero/src/version.ts"), "utf-8");
    return src.match(/VERSION\s*=\s*"([^"]+)"/)?.[1] ?? "desconocida";
  } catch {
    return "desconocida";
  }
}

async function esperarSalud(url, intentos = 40) {
  for (let i = 0; i < intentos; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return true;
    } catch { /* aún no */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

// ---------------------------------------------------------------------------
async function main() {
  // 0. Dependencias instaladas y tipos compilados (solo si falta algo).
  if (!fs.existsSync(path.join(raiz, "node_modules"))) {
    log("sys", "instalando dependencias (primera vez)...\n");
    await new Promise((res, rej) => {
      const pnpm = pnpmInvocation(["install"]);
      const p = spawn(pnpm.cmd, pnpm.args, { cwd: raiz, shell: esWin, stdio: "inherit" });
      p.on("exit", (c) => (c === 0 ? res() : rej(new Error("pnpm install falló"))));
    });
  }
  if (!fs.existsSync(path.join(raiz, "packages/shared-types/dist"))) {
    log("sys", "compilando shared-types...\n");
    await new Promise((res, rej) => {
      const pnpm = pnpmInvocation(["--filter", "@comandas/shared-types", "build"]);
      const p = spawn(pnpm.cmd, pnpm.args, { cwd: raiz, shell: esWin, stdio: "inherit" });
      p.on("exit", (c) => (c === 0 ? res() : rej(new Error("build de shared-types falló"))));
    });
  }

  // IMPORTANTE: el backend en modo :3000 sirve la PWA desde su carpeta
  // apps/pwa-camarero/dist. Esa carpeta NO se regenera sola — si quedó una
  // build vieja ahí (de ayer, de otra rama, de lo que sea), :3000 seguirá
  // sirviendo esa versión antigua para siempre, sin importar cuántas veces
  // se recargue el navegador o se cambie de dispositivo. Por eso se
  // recompila SIEMPRE aquí, en cada arranque, sin excepción.
  log("sys", `compilando la PWA (versión: ${versionApp()})...\n`);
  await new Promise((res, rej) => {
    const pnpm = pnpmInvocation(["--filter", "pwa-camarero", "build"]);
    const p = spawn(pnpm.cmd, pnpm.args, { cwd: raiz, shell: esWin, stdio: "inherit" });
    p.on("exit", (c) => (c === 0 ? res() : rej(new Error("build de la PWA falló"))));
  });
  log("sys", "PWA compilada ✓\n");

  // El esquema de la base de datos se copia siempre al dist del backend:
  // si se editó schema.sql y el backend ya estaba compilado, esto evita
  // servir un esquema desincronizado del código.
  const schemaOrigen = path.join(raiz, "apps/raspberry-backend/src/db/schema.sql");
  const schemaDestinoDir = path.join(raiz, "apps/raspberry-backend/dist/db");
  if (fs.existsSync(schemaOrigen)) {
    fs.mkdirSync(schemaDestinoDir, { recursive: true });
    fs.copyFileSync(schemaOrigen, path.join(schemaDestinoDir, "schema.sql"));
  }

  // 1. Backend
  const backendPnpm = pnpmInvocation(["--filter", "raspberry-backend", "dev"]);
  lanzar("backend", backendPnpm.cmd, backendPnpm.args);
  log("sys", "esperando al backend en :3000...\n");
  const ok = await esperarSalud("http://127.0.0.1:3000/salud");
  if (!ok) { log("sys", "el backend no arranca — revisa los logs de arriba\n"); return matarTodo(); }
  log("sys", "backend OK ✓\n");

  // 2. Admin inicial y, si el local está vacío, carta y mesas de demostración.
  for (const script of ["scripts/bootstrap-admin.mjs", "scripts/seed-demo.mjs"]) {
    await new Promise((res) => {
      const p = spawn("node", [script], {
        cwd: path.join(raiz, "apps/raspberry-backend"), shell: esWin,
      });
      p.stdout.on("data", (d) => log("sys", d.toString()));
      p.stderr.on("data", (d) => log("sys", d.toString()));
      p.on("exit", () => res());
    });
  }

  // 3. Impresora falsa (opcional) — ANTES del worker, para que el health check la vea viva.
  if (conFake) {
    lanzar("fake", "node", ["apps/printer-worker/scripts/impresora-fake.mjs"]);
  }

  // 4. Worker de impresión
  const workerPnpm = pnpmInvocation(["--filter", "printer-worker", "dev"]);
  lanzar("worker", workerPnpm.cmd, workerPnpm.args);

  // 5. PWA
  const pwaPnpm = pnpmInvocation(["--filter", "pwa-camarero", "dev"]);
  lanzar("pwa", pwaPnpm.cmd, pwaPnpm.args, {
    env: { VITE_API: "http://127.0.0.1:3000" },
  });

  log("sys", "\n");
  log("sys", "═══════════════════════════════════════════════\n");
  log("sys", "  Todo arrancado:\n");
  const ip = ipLocal();
  log("sys", `  · Versión servida en :3000/:5173 -> ${versionApp()}\n`);
  log("sys", `  · API + PWA:      http://localhost:3000   (móvil: http://${ip}:3000)\n`);
  log("sys", `  · PWA hot reload: http://localhost:5173   (móvil: http://${ip}:5173)\n`);
  log("sys", `  · Impresora falsa :9100  ${conFake ? "SÍ" : "no (usa --fake)"}\n`);
  log("sys", "  · Login: admin@demo.com / admin -> perfil Admin (PIN 1234)\n");
  log("sys", "  · PC: localhost:3000   · Móviles: la IP de arriba\n");
  log("sys", `  · Central: ${process.env.NUBE_URL || "no configurada (el local no la necesita)"}\n`);
  log("sys", "  · Ctrl+C para parar todo\n");
  log("sys", "═══════════════════════════════════════════════\n");
}

main().catch((e) => { console.error(e); matarTodo(); });
