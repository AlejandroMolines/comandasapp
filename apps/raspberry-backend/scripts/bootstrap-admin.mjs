import Database from "better-sqlite3";
import fs from "node:fs";
import { randomUUID } from "node:crypto";

// Idempotente: crea el restaurante demo y el perfil Admin si no existen.
if (!fs.existsSync("data/local.sqlite")) {
  console.log("[bootstrap] la BD aún no existe (arranca antes el backend); saltando");
  process.exit(0);
}

const db = new Database("data/local.sqlite");

const rest = db.prepare("SELECT id FROM restaurantes LIMIT 1").get();
if (!rest) {
  db.prepare(
    `INSERT INTO restaurantes (id, nombre, email, password_hash, creado_en)
     VALUES ('restaurante-demo', 'Restaurante Demo', 'admin@demo.com', 'admin', datetime('now'))`
  ).run();
  console.log("[bootstrap] restaurante creado — login: admin@demo.com / admin");
} else {
  console.log("[bootstrap] restaurante ya existe");
}

const admin = db.prepare("SELECT 1 FROM usuarios WHERE rol = 'admin' AND activo = 1").get();
if (!admin) {
  db.prepare(
    `INSERT INTO usuarios (id, restaurante_id, nombre, rol, pin_hash, activo, creado_en)
     VALUES (?, 'restaurante-demo', 'Admin', 'admin', '1234', 1, datetime('now'))`
  ).run(randomUUID());
  console.log("[bootstrap] perfil Admin creado (PIN 1234) — cámbialo en producción");
} else {
  console.log("[bootstrap] ya existe un admin; nada que hacer");
}
