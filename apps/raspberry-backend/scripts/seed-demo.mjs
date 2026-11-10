import Database from "better-sqlite3";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { hashSecreto } from "./hash.mjs";

/**
 * Datos de demostración para un local vacío: dos zonas, carta, extras,
 * impresoras apuntando a la térmica falsa de :9100 y un camarero.
 * No toca una base que ya tenga salas (un restaurante real).
 */
if (!fs.existsSync("data/local.sqlite")) {
  console.log("[seed] la BD aún no existe; saltando");
  process.exit(0);
}

const db = new Database("data/local.sqlite");
db.pragma("foreign_keys = ON");

const rest = db.prepare("SELECT id FROM restaurantes WHERE id = 'restaurante-demo'").get();
if (!rest) {
  console.log("[seed] no está el restaurante demo; saltando");
  process.exit(0);
}
if (db.prepare("SELECT 1 FROM zonas LIMIT 1").get()) {
  console.log("[seed] ya hay salas; no se pisa la configuración");
  process.exit(0);
}

const ahora = new Date().toISOString();
const id = () => randomUUID();

const zonaSala = id();
const zonaTerraza = id();
const menu = id();
const catBebidas = id();
const catCocina = id();
const cocina = id();
const barra = id();
const caja = id();

const tx = db.transaction(() => {
  db.prepare(`INSERT INTO zonas (id, restaurante_id, nombre, orden) VALUES (?, 'restaurante-demo', ?, ?)`)
    .run(zonaSala, "Sala", 0);
  db.prepare(`INSERT INTO zonas (id, restaurante_id, nombre, orden) VALUES (?, 'restaurante-demo', ?, ?)`)
    .run(zonaTerraza, "Terraza", 1);

  const mesa = db.prepare(
    `INSERT INTO mesas (id, restaurante_id, zona_id, nombre, capacidad, estado) VALUES (?, 'restaurante-demo', ?, ?, 4, 'libre')`
  );
  for (let n = 1; n <= 8; n++) mesa.run(id(), zonaSala, String(n));
  for (let n = 1; n <= 4; n++) mesa.run(id(), zonaTerraza, `T${n}`);

  db.prepare(`INSERT INTO menus (id, restaurante_id, nombre, orden, activo) VALUES (?, 'restaurante-demo', 'Carta', 0, 1)`).run(menu);
  db.prepare(
    `INSERT INTO categorias (id, restaurante_id, menu_id, categoria_padre_id, nombre, orden) VALUES (?, 'restaurante-demo', ?, NULL, ?, ?)`
  ).run(catBebidas, menu, "Bebidas", 0);
  db.prepare(
    `INSERT INTO categorias (id, restaurante_id, menu_id, categoria_padre_id, nombre, orden) VALUES (?, 'restaurante-demo', ?, NULL, ?, ?)`
  ).run(catCocina, menu, "Cocina", 1);

  const producto = db.prepare(
    `INSERT INTO productos (id, restaurante_id, categoria_id, nombre, precio, descripcion, disponible, orden, tipo_iva)
     VALUES (?, 'restaurante-demo', ?, ?, ?, NULL, 1, ?, ?)`
  );
  const bebidas = [
    ["Caña", 2.5, 21],
    ["Vino tinto", 3, 21],
    ["Agua", 1.8, 10],
    ["Refresco", 2.2, 10],
    ["Café", 1.5, 10],
  ];
  const platos = [
    ["Croquetas", 8],
    ["Hamburguesa", 12.5],
    ["Ensalada", 9],
    ["Tortilla", 7],
  ];
  bebidas.forEach(([nombre, precio, iva], i) => producto.run(id(), catBebidas, nombre, precio, i, iva));
  const hamburguesa = id();
  platos.forEach(([nombre, precio], i) => {
    producto.run(nombre === "Hamburguesa" ? hamburguesa : id(), catCocina, nombre, precio, i, 10);
  });

  const config = JSON.stringify({ ip: "127.0.0.1", puerto: 9100 });
  const destino = db.prepare(
    `INSERT INTO puntos_destino (id, restaurante_id, nombre, tipo, protocolo, config, estado_salud)
     VALUES (?, 'restaurante-demo', ?, ?, 'escpos_red', ?, 'desconocido')`
  );
  destino.run(cocina, "Cocina", "impresora_termica", config);
  destino.run(barra, "Barra", "impresora_termica", config);
  destino.run(caja, "Caja", "impresora_ticket", config);

  db.prepare(`INSERT INTO categoria_destino (categoria_id, punto_destino_id) VALUES (?, ?)`).run(catCocina, cocina);
  db.prepare(`INSERT INTO categoria_destino (categoria_id, punto_destino_id) VALUES (?, ?)`).run(catBebidas, barra);

  const extraQueso = id();
  const extraCebolla = id();
  db.prepare(
    `INSERT INTO extras (id, restaurante_id, nombre, precio, ambito, grupo, activo, orden, creado_en)
     VALUES (?, 'restaurante-demo', ?, ?, 'especifico', ?, 1, ?, ?)`
  ).run(extraQueso, "Extra de queso", 1.5, "Hamburguesa", 0, ahora);
  db.prepare(
    `INSERT INTO extras (id, restaurante_id, nombre, precio, ambito, grupo, activo, orden, creado_en)
     VALUES (?, 'restaurante-demo', ?, ?, 'especifico', ?, 1, ?, ?)`
  ).run(extraCebolla, "Sin cebolla", 0, "Hamburguesa", 1, ahora);
  db.prepare(`INSERT INTO extra_producto (extra_id, producto_id) VALUES (?, ?)`).run(extraQueso, hamburguesa);
  db.prepare(`INSERT INTO extra_producto (extra_id, producto_id) VALUES (?, ?)`).run(extraCebolla, hamburguesa);

  const yaCamarero = db.prepare(`SELECT 1 FROM usuarios WHERE nombre = 'Ana' AND restaurante_id = 'restaurante-demo'`).get();
  if (!yaCamarero) {
    db.prepare(
      `INSERT INTO usuarios (id, restaurante_id, nombre, rol, pin_hash, activo, creado_en)
       VALUES (?, 'restaurante-demo', 'Ana', 'camarero', ?, 1, ?)`
    ).run(id(), hashSecreto("1111"), ahora);
  }

  const ajuste = db.prepare(
    `INSERT INTO ajustes (restaurante_id, clave, valor) VALUES ('restaurante-demo', ?, ?)
     ON CONFLICT(restaurante_id, clave) DO UPDATE SET valor = excluded.valor`
  );
  ajuste.run("fiscal_razon_social", "BAR DEMO SL");
  ajuste.run("fiscal_nif", "B00000000");
  ajuste.run("fiscal_direccion", "Calle del Ejemplo 1, Madrid");
  ajuste.run("caja_inicial_fija", "100");
});

tx();
console.log("[seed] demo lista: Sala 1-8, Terraza T1-T4, carta, impresoras en 127.0.0.1:9100");
console.log("[seed] camarero Ana / PIN 1111  (datos fiscales de mentira, solo para probar)");
db.close();
