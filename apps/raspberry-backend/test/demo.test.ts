import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { randomUUID } from "node:crypto";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "demo-"));
process.env.DB_PATH = path.join(dir, "t.sqlite");
process.env.TOKEN_SECRET = "clave-de-test-suficientemente-larga";
process.env.RESTAURANTE_ID = "restaurante-demo";
process.env.MODO_DEMO = "1";
process.env.NODE_ENV = "test";

const { db } = await import("../src/db/connection.ts");
const { asegurarSemillaDemo, reiniciarDemo } = await import("../src/demo/semilla.ts");

function contar(sql: string) {
  return (db.prepare(sql).get() as { n: number }).n;
}

test("la semilla es idempotente, trae servicio de ejemplo y se puede reiniciar", () => {
  const ahora = new Date().toISOString();
  db.prepare(
    `INSERT INTO restaurantes (id, nombre, email, password_hash, creado_en) VALUES (?, 'Demo', 'demo@demo.test', 'x', ?)`
  ).run("restaurante-demo", ahora);
  db.prepare(
    `INSERT INTO usuarios (id, restaurante_id, nombre, rol, pin_hash, activo, creado_en)
     VALUES (?, 'restaurante-demo', 'Admin', 'admin', 'x', 1, ?)`
  ).run(randomUUID(), ahora);

  assert.equal(asegurarSemillaDemo().modo, "creada");
  assert.equal(asegurarSemillaDemo().modo, "lista");
  assert.equal(contar(`SELECT COUNT(*) AS n FROM zonas`), 2);
  assert.equal(contar(`SELECT COUNT(*) AS n FROM productos`), 10);
  assert.equal(contar(`SELECT COUNT(*) AS n FROM comandas WHERE estado NOT IN ('cerrada','cancelada')`), 3);
  assert.equal(contar(`SELECT COUNT(*) AS n FROM comandas WHERE estado = 'cerrada'`), 1);
  const serie = db.prepare(`SELECT valor FROM ajustes WHERE clave = 'fiscal_serie_simplificada'`).get() as { valor: string };
  assert.equal(serie.valor, "DEMO");
  const pago = db.prepare(`SELECT serie_simpl FROM pagos`).get() as { serie_simpl: string };
  assert.equal(pago.serie_simpl, "DEMO");

  reiniciarDemo();
  assert.equal(contar(`SELECT COUNT(*) AS n FROM zonas`), 2);
  assert.equal(contar(`SELECT COUNT(*) AS n FROM comandas`), 4);
  assert.equal(contar(`SELECT COUNT(*) AS n FROM usuarios WHERE rol = 'admin'`), 1);
});

test("un servidor que no es demo no se reinicia", () => {
  process.env.MODO_DEMO = "0";
  assert.throws(() => reiniciarDemo(), /no es el restaurante demo/);
  assert.equal(asegurarSemillaDemo().modo, "no");
  process.env.MODO_DEMO = "1";
});

after(() => db.close());
