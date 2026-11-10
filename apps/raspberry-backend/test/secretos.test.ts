import assert from "node:assert/strict";
import { test } from "node:test";

process.env.TOKEN_SECRET = "clave-de-test-suficientemente-larga";

const { firmarPayload, hashSecreto, leerToken, verificarSecreto } = await import("../src/lib/secretos.ts");

test("el hash no guarda el secreto en claro y verifica", () => {
  const hash = hashSecreto("1234");
  assert.equal(hash.startsWith("scrypt$16384$"), true);
  assert.equal(hash.includes("1234"), false);
  assert.equal(verificarSecreto("1234", hash).ok, true);
  assert.equal(verificarSecreto("0000", hash).ok, false);
  assert.equal(verificarSecreto("1234", hash).legacy, false);
});

test("un secreto guardado en claro se reconoce como legado", () => {
  const r = verificarSecreto("admin", "admin");
  assert.equal(r.ok, true);
  assert.equal(r.legacy, true);
  assert.equal(verificarSecreto("otro", "admin").ok, false);
});

test("un token sin firma o manipulado no se acepta", () => {
  const token = firmarPayload({ usuarioId: "u1", rol: "camarero" });
  assert.deepEqual(leerToken(token), { usuarioId: "u1", rol: "camarero" });

  const [cuerpo] = token.split(".");
  const alterado = Buffer.from(JSON.stringify({ usuarioId: "u1", rol: "admin" })).toString("base64url");
  assert.equal(leerToken(`${alterado}.${token.split(".")[1]}`), null);
  assert.equal(leerToken(Buffer.from(JSON.stringify({ usuarioId: "u1", rol: "admin" })).toString("base64")), null);
  assert.equal(cuerpo.length > 0, true);
});
