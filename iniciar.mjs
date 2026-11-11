#!/usr/bin/env node
/**
 * Arranque del local en un paso. No hace falta acordarse de pnpm, de Vite
 * ni de compilar a mano.
 *
 *   node iniciar.mjs
 *
 * Deja sirviendo, en el puerto 3000:
 *   · el PC del encargado
 *   · los móviles de los camareros (misma dirección, por la IP de la WiFi)
 *
 * La central de todos los restaurantes NO se arranca aquí: vive en Vercel.
 * Este proceso solo le avisa si existen NUBE_URL y NUBE_TOKEN.
 *
 *   node iniciar.mjs --sin-impresora-falsa
 *     cuando haya una térmica de verdad en la red (si no, se simula una en :9100)
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const esWin = process.platform === "win32";
const sinFalsa = process.argv.includes("--sin-impresora-falsa");
const hijos = [];

function fail(msg) {
  console.error(`\n${msg}\n`);
  process.exit(1);
}

function nodeOk() {
  const major = Number(process.versions.node.split(".")[0]);
  if (major < 20 || major >= 23) {
    fail(`Hace falta Node 20 o 22. Ahora mismo está el ${process.versions.node}.\nCon nvm: nvm install 22 && nvm use 22`);
  }
}

function ejecutar(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: opts.cwd ?? raiz, stdio: "inherit", shell: esWin, env: process.env });
  if (r.status !== 0) fail(`Falló: ${cmd} ${args.join(" ")}`);
}

function hay(cmd) {
  const r = spawnSync(cmd, ["-v"], { shell: esWin, stdio: "ignore" });
  return r.status === 0;
}

function pnpmCommand() {
  if (hay("pnpm")) return { cmd: "pnpm", prefix: [] };
  if (hay("corepack")) {
    console.log("Usando pnpm mediante Corepack (sin instalar shims globales)…");
    return { cmd: "corepack", prefix: ["pnpm"] };
  }
  fail("No está pnpm ni Corepack. Instala Node.js 20 o 22, que incluye Corepack.");
  return { cmd: "pnpm", prefix: [] };
}

function lanzar(nombre, cmd, args, cwd) {
  const p = spawn(cmd, args, {
    cwd,
    env: process.env,
    shell: esWin,
    detached: !esWin,
    stdio: ["ignore", "pipe", "pipe"],
  });
  hijos.push(p);
  const log = (buf) => {
    for (const linea of buf.toString().split("\n").filter(Boolean)) {
      console.log(`[${nombre}] ${linea}`);
    }
  };
  p.stdout.on("data", log);
  p.stderr.on("data", log);
  return p;
}

function matar() {
  console.log("\nCerrando el local…");
  for (const p of hijos) {
    if (esWin) spawn("taskkill", ["/pid", String(p.pid), "/T", "/F"], { shell: true });
    else {
      try { process.kill(-p.pid, "SIGTERM"); } catch { p.kill("SIGTERM"); }
    }
  }
  setTimeout(() => process.exit(0), 600);
}

function ipLocal() {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const i of ifaces ?? []) {
      if (i.family === "IPv4" && !i.internal) return i.address;
    }
  }
  return "127.0.0.1";
}

async function esperar(url) {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch { /* aún no */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  fail("El servidor no arrancó en el puerto 3000. Mira los logs de arriba.");
}

async function main() {
  nodeOk();
  const pnpm = pnpmCommand();
  process.chdir(raiz);

  if (!fs.existsSync(path.join(raiz, "node_modules"))) {
    console.log("Instalando dependencias (solo la primera vez)…");
    ejecutar(pnpm.cmd, [...pnpm.prefix, "install"]);
  }

  console.log("Compilando…");
  ejecutar(pnpm.cmd, [...pnpm.prefix, "-r", "build"]);
  const schemaDir = path.join(raiz, "apps/raspberry-backend/dist/db");
  fs.mkdirSync(schemaDir, { recursive: true });
  fs.copyFileSync(
    path.join(raiz, "apps/raspberry-backend/src/db/schema.sql"),
    path.join(schemaDir, "schema.sql")
  );

  const backend = path.join(raiz, "apps/raspberry-backend");
  lanzar("servidor", "node", ["dist/server.js"], backend);
  await esperar("http://127.0.0.1:3000/salud");

  ejecutar("node", ["scripts/bootstrap-admin.mjs"], { cwd: backend });
  ejecutar("node", ["scripts/seed-demo.mjs"], { cwd: backend });

  if (!sinFalsa) lanzar("impresora", "node", ["apps/printer-worker/scripts/impresora-fake.mjs"], raiz);
  lanzar("impresion", "node", ["dist/worker.js"], path.join(raiz, "apps/printer-worker"));

  const ip = ipLocal();
  console.log(`
────────────────────────────────────────────
  Local listo. Una sola dirección:

  PC (encargado)     http://localhost:3000
  Móviles (camareros) http://${ip}:3000
                     misma WiFi, nada que instalar

  Login  admin@demo.com / admin
         perfil Admin, PIN 1234
         camarero de prueba: Ana, PIN 1111

  La central de todos los restaurantes está en Vercel.
  ${process.env.NUBE_URL ? `Este local avisa a ${process.env.NUBE_URL}` : "Sin NUBE_URL: no avisa a la central, y el bar funciona igual."}

  Ctrl+C para parar.
────────────────────────────────────────────
`);
}

process.on("SIGINT", matar);
process.on("SIGTERM", matar);
main().catch((e) => fail(e?.message ?? String(e)));
