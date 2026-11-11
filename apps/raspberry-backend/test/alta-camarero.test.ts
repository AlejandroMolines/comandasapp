import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { randomUUID } from "node:crypto";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "alta-"));
process.env.DB_PATH = path.join(dir, "t.sqlite");
process.env.TOKEN_SECRET = "clave-de-test-suficientemente-larga";
process.env.RESTAURANTE_ID = "restaurante-demo";
process.env.NODE_ENV = "test";

const { db } = await import("../src/db/connection.ts");
const { firmarAlta, leerAlta, VENTANA_ALTA_SEGUNDOS } = await import("../src/lib/altaCamarero.ts");
const { firmarPayload } = await import("../src/lib/secretos.ts");

const AHORA = Date.parse("2026-11-11T12:00:30.000Z");

test("el QR de una ventana se acepta y el caducado no", () => {
  const { token, exp } = firmarAlta("restaurante-demo", AHORA);
  assert.equal(leerAlta(token, "restaurante-demo", AHORA)?.exp, exp);
  assert.equal(leerAlta(token, "otro-local", AHORA), null);
  assert.equal(leerAlta(token, "restaurante-demo", AHORA + (VENTANA_ALTA_SEGUNDOS + 40) * 1000), null);
  const falso = firmarPayload({ tipo: "alta-camarero", restauranteId: "restaurante-demo", exp: exp + 99999 });
  assert.equal(leerAlta(falso, "restaurante-demo", AHORA), null);
});

test("un token válido crea un camarero activo y no repite el nombre", async () => {
  const ahora = new Date().toISOString();
  db.prepare(
    `INSERT INTO restaurantes (id, nombre, email, password_hash, creado_en) VALUES ('restaurante-demo', 'Demo', 'a@b.c', 'x', ?)`
  ).run(ahora);
  const { crearServidor } = await import("../src/server.ts");
  const { httpServer } = crearServidor();
  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", () => resolve()));
  const puerto = (httpServer.address() as { port: number }).port;
  const { token } = firmarAlta("restaurante-demo");

  const alta = await fetch(`http://127.0.0.1:${puerto}/auth/alta-camarero`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, nombre: "Nuria", pin: "1234" }),
  });
  assert.equal(alta.status, 201);
  const cuerpo = await alta.json() as { usuario: { rol: string; nombre: string }; token: string };
  assert.equal(cuerpo.usuario.rol, "camarero");
  assert.equal(cuerpo.usuario.nombre, "Nuria");
  assert.equal(typeof cuerpo.token, "string");

  const fila = db.prepare(`SELECT rol, activo FROM usuarios WHERE nombre = 'Nuria'`).get() as { rol: string; activo: number };
  assert.equal(fila.rol, "camarero");
  assert.equal(fila.activo, 1);

  const repetida = await fetch(`http://127.0.0.1:${puerto}/auth/alta-camarero`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, nombre: "Nuria" }),
  });
  assert.equal(repetida.status, 409);

  const malo = await fetch(`http://127.0.0.1:${puerto}/auth/alta-camarero`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: "no-vale", nombre: "Otro" }),
  });
  assert.equal(malo.status, 400);

  httpServer.close();
});

after(() => {
  db.close();
  void randomUUID;
});
