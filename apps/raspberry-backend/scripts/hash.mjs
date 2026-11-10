import crypto from "node:crypto";

/**
 * Mismo formato que src/lib/secretos.ts: scrypt$N$salt$hash.
 * Lo usan el bootstrap y la semilla de demo para no dejar PIN ni
 * contraseñas en claro ni siquiera antes del primer login.
 */
export function hashSecreto(plano) {
  const N = 16384;
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(plano, salt, 32, { N, r: 8, p: 1 });
  return `scrypt$${N}$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}
