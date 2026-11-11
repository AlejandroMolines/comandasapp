#!/usr/bin/env node
/**
 * En el Raspberry y en local: compila todo el monorepo.
 * En Vercel (VERCEL=1): solo la central, y la deja en /public,
 * que es la carpeta que el proyecto de Vercel espera como salida.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pnpmInvocation } from "./package-manager.mjs";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const esWin = process.platform === "win32";

function run(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: raiz, stdio: "inherit", shell: esWin });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

function runPnpm(args) {
  const pnpm = pnpmInvocation(args);
  run(pnpm.cmd, pnpm.args);
}

if (process.env.VERCEL) {
  runPnpm(["--filter", "@comandas/nube", "build"]);
  const dist = path.join(raiz, "apps/nube/dist");
  const salida = path.join(raiz, "public");
  fs.rmSync(salida, { recursive: true, force: true });
  fs.cpSync(dist, salida, { recursive: true });
  console.log(`[vercel] central copiada a ${salida}`);
} else {
  runPnpm(["-r", "build"]);
}
