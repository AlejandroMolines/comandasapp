import Database from "better-sqlite3";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { hashSecreto } from "./hash.mjs";

const restauranteId = process.env.RESTAURANTE_ID ?? "restaurante-demo";
const restauranteNombre = process.env.DEMO_RESTAURANT_NAME ?? "Restaurante Demo";
const adminEmail = process.env.DEMO_ADMIN_EMAIL ?? "admin@demo.com";
const adminPassword = process.env.DEMO_ADMIN_PASSWORD ?? "admin";
const adminPin = process.env.DEMO_ADMIN_PIN ?? "1234";
const dbPath = process.env.DB_PATH ?? "data/local.sqlite";

if (process.env.NODE_ENV === "production") {
  const obligatorias = ["RESTAURANTE_ID", "DEMO_RESTAURANT_NAME", "DEMO_ADMIN_EMAIL", "DEMO_ADMIN_PASSWORD", "DEMO_ADMIN_PIN"];
  const faltan = obligatorias.filter((variable) => !process.env[variable]);
  const emailValido = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail) && adminEmail.length <= 320;
  const idValido = /^[A-Za-z0-9_-]{1,80}$/.test(restauranteId);
  if (faltan.length || adminPassword.length < 16 || adminPassword.length > 1024 || !emailValido || !idValido || !/^\d{3,6}$/.test(adminPin)) {
    throw new Error(`Configura ${obligatorias.join(", ")}; usa un email válido, contraseña de 16–1024 caracteres, ID simple y PIN de 3–6 dígitos.`);
  }
}

// Idempotente: crea el restaurante demo y el perfil Admin si no existen.
if (!fs.existsSync(dbPath)) {
  console.log("[bootstrap] la BD aún no existe (arranca antes el backend); saltando");
  process.exit(0);
}

const db = new Database(dbPath);

const rest = db.prepare("SELECT id FROM restaurantes WHERE id = ?").get(restauranteId);
if (!rest) {
  db.prepare(
    `INSERT INTO restaurantes (id, nombre, email, password_hash, creado_en)
     VALUES (?, ?, ?, ?, datetime('now'))`
  ).run(restauranteId, restauranteNombre, adminEmail, hashSecreto(adminPassword));
  console.log(`[bootstrap] restaurante creado — ${restauranteId}`);
} else {
  console.log("[bootstrap] restaurante ya existe");
}

const admin = db.prepare("SELECT 1 FROM usuarios WHERE restaurante_id = ? AND rol = 'admin' AND activo = 1").get(restauranteId);
if (!admin) {
  db.prepare(
    `INSERT INTO usuarios (id, restaurante_id, nombre, rol, pin_hash, activo, creado_en)
     VALUES (?, ?, 'Admin', 'admin', ?, 1, datetime('now'))`
  ).run(randomUUID(), restauranteId, hashSecreto(adminPin));
  console.log("[bootstrap] perfil Admin creado");
} else {
  console.log("[bootstrap] ya existe un admin; nada que hacer");
}
