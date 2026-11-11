import { spawnSync } from "node:child_process";

const esWin = process.platform === "win32";
let resolved;

function disponible(cmd) {
  const r = spawnSync(cmd, ["--version"], {
    stdio: "ignore",
    shell: esWin,
    env: process.env,
  });
  return r.status === 0;
}

/** Devuelve el ejecutable y los argumentos comunes para invocar pnpm. */
export function pnpmInvocation(args = []) {
  if (!resolved) {
    if (disponible("pnpm")) resolved = { cmd: "pnpm", prefix: [] };
    else if (disponible("corepack")) resolved = { cmd: "corepack", prefix: ["pnpm"] };
    else throw new Error("No se encuentra pnpm ni Corepack. Instala pnpm 10 o Corepack.");
  }
  return { cmd: resolved.cmd, args: [...resolved.prefix, ...args] };
}
