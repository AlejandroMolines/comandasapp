import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DB_PATH = process.env.DB_PATH ?? path.join(__dirname, "../../data/local.sqlite");

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL"); // importante: mejor concurrencia lectura/escritura en el Raspberry
db.pragma("foreign_keys = ON");

const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf-8");
db.exec(schema);

// Bases creadas antes de estas columnas: ALTER idempotente.
// Las instalaciones nuevas ya las traen en schema.sql y aquí no se tocan.
const columnasNuevas: [string, string, string][] = [
  ["lineas_comanda", "anulada", "INTEGER NOT NULL DEFAULT 0"],
  ["lineas_comanda", "motivo_anulacion", "TEXT"],
  ["lineas_comanda", "anulada_en", "TEXT"],
  ["lineas_comanda", "anulada_por", "TEXT"],
  ["comandas", "descuento_tipo", "TEXT"],
  ["comandas", "descuento_valor", "REAL NOT NULL DEFAULT 0"],
  ["comandas", "descuento_motivo", "TEXT"],
  ["log_impresion", "es_anulacion", "INTEGER NOT NULL DEFAULT 0"],
  ["log_impresion", "linea_anulada_id", "TEXT"],
];
for (const [tabla, columna, def] of columnasNuevas) {
  const info = db.prepare(`PRAGMA table_info(${tabla})`).all() as { name: string }[];
  if (!info.some((c) => c.name === columna)) {
    db.exec(`ALTER TABLE ${tabla} ADD COLUMN ${columna} ${def}`);
  }
}

console.log(`[db] SQLite lista en ${DB_PATH}`);
