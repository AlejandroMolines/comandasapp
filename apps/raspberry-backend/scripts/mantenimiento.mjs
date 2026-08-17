#!/usr/bin/env node
/**
 * Mantenimiento nocturno del Raspberry. Dos tareas:
 *
 *   1. BACKUP de la base de datos. Es el riesgo real del sistema: el día que
 *      muera la tarjeta SD se pierde todo el histórico. Se usa el comando
 *      .backup de SQLite (no una copia del archivo) porque es consistente
 *      incluso con la base de datos en uso.
 *
 *   2. PURGA de la cola de impresión ya procesada. Es lo único que crece de
 *      verdad: guarda los bytes de cada ticket, unos 75 MB al año. Los datos
 *      de negocio NO se tocan (obligación legal de 4 años, y ocupan poco).
 *
 * Uso:
 *   node scripts/mantenimiento.mjs
 *   DESTINO_BACKUP=/media/usb node scripts/mantenimiento.mjs
 *
 * Para que se ejecute solo cada noche, ver docs/MANTENIMIENTO.md
 */
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const DB = process.env.DB_PATH ?? "data/local.sqlite";
const DESTINO = process.env.DESTINO_BACKUP ?? "backups";
const DIAS_COLA = Number(process.env.DIAS_COLA ?? 7);
const BACKUPS_A_GUARDAR = Number(process.env.BACKUPS_A_GUARDAR ?? 30);

const log = (...a) => console.log(`[mantenimiento ${new Date().toISOString().slice(0, 19)}]`, ...a);

if (!fs.existsSync(DB)) {
  log(`No existe la base de datos en ${DB}. Nada que hacer.`);
  process.exit(0);
}

const db = new Database(DB);

// --- 1. Backup ------------------------------------------------------------
fs.mkdirSync(DESTINO, { recursive: true });
const fecha = new Date().toISOString().slice(0, 10);
const destino = path.join(DESTINO, `comandas-${fecha}.sqlite`);

try {
  // .backup() de better-sqlite3 usa la API de backup de SQLite: hace una copia
  // coherente aunque haya escrituras a la vez. Copiar el archivo a mano puede
  // dar una base de datos corrupta si pilla una transacción a medias.
  await db.backup(destino);
  const mb = (fs.statSync(destino).size / 1024 / 1024).toFixed(1);
  log(`Backup hecho: ${destino} (${mb} MB)`);
} catch (e) {
  log(`ERROR en el backup: ${e.message}`);
  process.exitCode = 1;
}

// Rotación: conservar los N más recientes.
try {
  const previos = fs
    .readdirSync(DESTINO)
    .filter((f) => f.startsWith("comandas-") && f.endsWith(".sqlite"))
    .sort()
    .reverse();
  for (const viejo of previos.slice(BACKUPS_A_GUARDAR)) {
    fs.unlinkSync(path.join(DESTINO, viejo));
    log(`Backup antiguo borrado: ${viejo}`);
  }
} catch (e) {
  log(`Aviso al rotar backups: ${e.message}`);
}

// --- 2. Purga de la cola de impresión -------------------------------------
const antes = db.prepare("SELECT COUNT(*) n FROM log_impresion").get().n;
const info = db
  .prepare(
    `DELETE FROM log_impresion
      WHERE estado = 'ok' AND julianday('now') - julianday(creado_en) > ?`
  )
  .run(DIAS_COLA);
log(`Cola de impresión: ${antes} registros, ${info.changes} purgados (> ${DIAS_COLA} días).`);

// --- 3. Compactar ---------------------------------------------------------
// VACUUM recupera el espacio de las filas borradas. Se hace después de purgar
// y solo si se borró algo, porque reescribe el archivo entero y en una SD eso
// es desgaste que no conviene provocar a diario sin motivo.
if (info.changes > 0) {
  db.exec("VACUUM");
  log("Base de datos compactada (VACUUM).");
}

// --- Resumen --------------------------------------------------------------
const stats = {
  comandas: db.prepare("SELECT COUNT(*) n FROM comandas").get().n,
  pagos: db.prepare("SELECT COUNT(*) n FROM pagos").get().n,
  facturas: db.prepare("SELECT COUNT(*) n FROM facturas").get().n,
  tamañoMB: (fs.statSync(DB).size / 1024 / 1024).toFixed(1),
};
log(
  `Estado: ${stats.pagos} tickets · ${stats.facturas} facturas · ` +
  `${stats.comandas} comandas · BD ${stats.tamañoMB} MB`
);

db.close();
