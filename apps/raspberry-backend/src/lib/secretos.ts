import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * Secretos locales del Raspberry. Nada sale de la máquina:
 * scrypt (PIN y contraseña) y HMAC-SHA256 (tokens) viven en node:crypto.
 *
 * Formato del hash: `scrypt$<N>$<salt base64url>$<hash base64url>`.
 * Tiene que coincidir con scripts/hash.mjs, que usa el bootstrap.
 */

const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEYLEN = 32;

export function hashSecreto(plano: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(plano, salt, KEYLEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return `scrypt$${SCRYPT_N}$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

/** `legacy` = el valor guardado aún está en claro y hay que reescribirlo. */
export function verificarSecreto(plano: string, almacenado: string): { ok: boolean; legacy: boolean } {
  if (!almacenado) return { ok: false, legacy: false };
  if (almacenado.startsWith("scrypt$")) {
    const partes = almacenado.split("$");
    if (partes.length !== 4) return { ok: false, legacy: false };
    const n = Number(partes[1]);
    const salt = Buffer.from(partes[2], "base64url");
    const esperado = Buffer.from(partes[3], "base64url");
    if (!n || salt.length === 0 || esperado.length === 0) return { ok: false, legacy: false };
    const actual = crypto.scryptSync(plano, salt, esperado.length, { N: n, r: SCRYPT_R, p: SCRYPT_P });
    if (actual.length !== esperado.length) return { ok: false, legacy: false };
    return { ok: crypto.timingSafeEqual(actual, esperado), legacy: false };
  }
  const a = Buffer.from(plano);
  const b = Buffer.from(almacenado);
  if (a.length !== b.length) return { ok: false, legacy: true };
  return { ok: crypto.timingSafeEqual(a, b), legacy: true };
}

let secretoCache: string | null = null;

/** Clave HMAC. TOKEN_SECRET si viene de fuera; si no, un archivo junto a la BD (gitignored). */
export function secretoFirma(): string {
  if (process.env.TOKEN_SECRET) return process.env.TOKEN_SECRET;
  if (secretoCache) return secretoCache;
  const dbPath = process.env.DB_PATH;
  const ruta = process.env.TOKEN_SECRET_FILE
    ?? path.join(dbPath ? path.dirname(dbPath) : path.join(process.cwd(), "data"), "token.secret");
  try {
    const existente = fs.readFileSync(ruta, "utf8").trim();
    if (existente) {
      secretoCache = existente;
      return existente;
    }
  } catch {
    /* se crea debajo */
  }
  fs.mkdirSync(path.dirname(ruta), { recursive: true });
  const nuevo = crypto.randomBytes(32).toString("hex");
  fs.writeFileSync(ruta, nuevo, { mode: 0o600 });
  secretoCache = nuevo;
  return nuevo;
}

export function firmarPayload(payload: object): string {
  const cuerpo = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const firma = crypto.createHmac("sha256", secretoFirma()).update(cuerpo).digest("base64url");
  return `${cuerpo}.${firma}`;
}

export function leerToken<T>(token: string): T | null {
  const punto = token.lastIndexOf(".");
  if (punto <= 0) return null;
  const cuerpo = token.slice(0, punto);
  const firma = token.slice(punto + 1);
  const esperada = crypto.createHmac("sha256", secretoFirma()).update(cuerpo).digest("base64url");
  const a = Buffer.from(firma);
  const b = Buffer.from(esperada);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    return JSON.parse(Buffer.from(cuerpo, "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }
}

export function secretosIguales(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length === 0 || ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}
