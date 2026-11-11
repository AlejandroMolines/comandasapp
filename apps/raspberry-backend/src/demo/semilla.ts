import { v4 as uuid } from "uuid";
import { db } from "../db/connection.js";
import { hashSecreto } from "../lib/secretos.js";

const MARCA = "demo_lista";
const VERSION = "2";

export function esModoDemo(): boolean {
  return process.env.MODO_DEMO === "1" || process.env.MODO_DEMO === "true";
}

function restauranteId(): string {
  return process.env.RESTAURANTE_ID ?? "restaurante-demo";
}

function ajuste(clave: string): string | undefined {
  const fila = db
    .prepare(`SELECT valor FROM ajustes WHERE restaurante_id = ? AND clave = ?`)
    .get(restauranteId(), clave) as { valor: string } | undefined;
  return fila?.valor;
}

function ponerAjuste(clave: string, valor: string) {
  db.prepare(
    `INSERT INTO ajustes (restaurante_id, clave, valor) VALUES (?, ?, ?)
     ON CONFLICT(restaurante_id, clave) DO UPDATE SET valor = excluded.valor`
  ).run(restauranteId(), clave, valor);
}

/** Crea carta, mesas, personal y comandas de ejemplo. No hace nada si ya está marcada. */
export function asegurarSemillaDemo(): { modo: "no" | "sin-restaurante" | "lista" | "creada" } {
  if (!esModoDemo()) return { modo: "no" };
  const rest = db.prepare(`SELECT id FROM restaurantes WHERE id = ?`).get(restauranteId());
  if (!rest) return { modo: "sin-restaurante" };
  if (ajuste(MARCA) === VERSION) return { modo: "lista" };

  const hayZonas = db.prepare(`SELECT 1 FROM zonas WHERE restaurante_id = ? LIMIT 1`).get(restauranteId());
  const hayComandas = db.prepare(`SELECT 1 FROM comandas WHERE restaurante_id = ? LIMIT 1`).get(restauranteId());
  const tx = db.transaction(() => {
    if (!hayZonas) sembrarCatalogo();
    if (!hayComandas) sembrarServicio();
    ponerAjuste(MARCA, VERSION);
    marcarFiscalDemo();
  });
  tx();
  return { modo: "creada" };
}

/** Borra la actividad y la carta de ESTE servidor demo y vuelve a la semilla. */
export function reiniciarDemo(): { ok: true } {
  if (!esModoDemo()) {
    throw new Error("Este servidor no es el restaurante demo");
  }
  const rest = db.prepare(`SELECT id FROM restaurantes WHERE id = ?`).get(restauranteId());
  if (!rest) throw new Error("El restaurante demo todavía no existe");
  const tx = db.transaction(() => {
    borrarActividad();
    sembrarCatalogo();
    sembrarServicio();
    ponerAjuste(MARCA, VERSION);
    marcarFiscalDemo();
  });
  tx();
  return { ok: true };
}

function marcarFiscalDemo() {
  ponerAjuste("fiscal_razon_social", "BAR DEMO SL");
  ponerAjuste("fiscal_nif", "B00000000");
  ponerAjuste("fiscal_direccion", "Calle del Ejemplo 1, Madrid");
  ponerAjuste("fiscal_serie", "DEMO");
  ponerAjuste("fiscal_serie_simplificada", "DEMO");
  ponerAjuste("caja_inicial_fija", "100");
}

function usuarioId(nombre: string, rol: "admin" | "camarero", pin: string): string {
  const ya = db
    .prepare(`SELECT id FROM usuarios WHERE restaurante_id = ? AND nombre = ? AND activo = 1`)
    .get(restauranteId(), nombre) as { id: string } | undefined;
  if (ya) return ya.id;
  const id = uuid();
  db.prepare(
    `INSERT INTO usuarios (id, restaurante_id, nombre, rol, pin_hash, activo, creado_en)
     VALUES (?, ?, ?, ?, ?, 1, ?)`
  ).run(id, restauranteId(), nombre, rol, hashSecreto(pin), new Date().toISOString());
  return id;
}

function sembrarCatalogo() {
  const rid = restauranteId();
  const sala = uuid();
  const terraza = uuid();
  db.prepare(`INSERT INTO zonas (id, restaurante_id, nombre, orden) VALUES (?, ?, 'Sala', 0)`).run(sala, rid);
  db.prepare(`INSERT INTO zonas (id, restaurante_id, nombre, orden) VALUES (?, ?, 'Terraza', 1)`).run(terraza, rid);

  const mesa = db.prepare(
    `INSERT INTO mesas (id, restaurante_id, zona_id, nombre, capacidad, estado) VALUES (?, ?, ?, ?, 4, 'libre')`
  );
  for (let n = 1; n <= 6; n++) mesa.run(uuid(), rid, sala, String(n));
  for (let n = 1; n <= 4; n++) mesa.run(uuid(), rid, terraza, `T${n}`);

  const menu = uuid();
  db.prepare(`INSERT INTO menus (id, restaurante_id, nombre, orden, activo) VALUES (?, ?, 'Carta', 0, 1)`).run(menu, rid);
  const bebidas = uuid();
  const cocina = uuid();
  const postres = uuid();
  const cat = db.prepare(
    `INSERT INTO categorias (id, restaurante_id, menu_id, categoria_padre_id, nombre, orden) VALUES (?, ?, ?, NULL, ?, ?)`
  );
  cat.run(bebidas, rid, menu, "Bebidas", 0);
  cat.run(cocina, rid, menu, "Cocina", 1);
  cat.run(postres, rid, menu, "Postres", 2);

  const producto = db.prepare(
    `INSERT INTO productos (id, restaurante_id, categoria_id, nombre, precio, descripcion, disponible, orden, tipo_iva)
     VALUES (?, ?, ?, ?, ?, NULL, 1, ?, ?)`
  );
  const alta = (categoria: string, nombre: string, precio: number, orden: number, iva: number) => {
    const id = uuid();
    producto.run(id, rid, categoria, nombre, precio, orden, iva);
    return id;
  };
  alta(bebidas, "Caña", 2.5, 0, 21);
  alta(bebidas, "Vino tinto", 3, 1, 21);
  alta(bebidas, "Agua", 1.8, 2, 10);
  alta(bebidas, "Café", 1.5, 3, 10);
  const hamburguesa = alta(cocina, "Hamburguesa", 12.5, 0, 10);
  alta(cocina, "Croquetas", 8, 1, 10);
  alta(cocina, "Ensalada", 9, 2, 10);
  alta(cocina, "Tortilla", 7, 3, 10);
  alta(postres, "Tarta de queso", 5.5, 0, 10);
  alta(postres, "Helado", 4, 1, 10);

  const config = JSON.stringify({ ip: "127.0.0.1", puerto: 9100, demo: true });
  const destino = db.prepare(
    `INSERT INTO puntos_destino (id, restaurante_id, nombre, tipo, protocolo, config, estado_salud)
     VALUES (?, ?, ?, ?, 'escpos_red', ?, 'ok')`
  );
  const idCocina = uuid();
  const idBarra = uuid();
  const idCaja = uuid();
  destino.run(idCocina, rid, "Cocina", "impresora_termica", config);
  destino.run(idBarra, rid, "Barra", "impresora_termica", config);
  destino.run(idCaja, rid, "Caja", "impresora_ticket", config);
  db.prepare(`INSERT INTO categoria_destino (categoria_id, punto_destino_id) VALUES (?, ?)`).run(cocina, idCocina);
  db.prepare(`INSERT INTO categoria_destino (categoria_id, punto_destino_id) VALUES (?, ?)`).run(postres, idCocina);
  db.prepare(`INSERT INTO categoria_destino (categoria_id, punto_destino_id) VALUES (?, ?)`).run(bebidas, idBarra);

  const extra = uuid();
  db.prepare(
    `INSERT INTO extras (id, restaurante_id, nombre, precio, ambito, grupo, activo, orden, creado_en)
     VALUES (?, ?, 'Extra de queso', 1.5, 'especifico', 'Hamburguesa', 1, 0, ?)`
  ).run(extra, rid, new Date().toISOString());
  db.prepare(`INSERT INTO extra_producto (extra_id, producto_id) VALUES (?, ?)`).run(extra, hamburguesa);

  const pinAna = process.env.DEMO_WAITER_PIN ?? "1111";
  const pinLuis = process.env.DEMO_WAITER_PIN_2 ?? "2222";
  usuarioId(process.env.DEMO_WAITER_NAME ?? "Ana", "camarero", pinAna);
  usuarioId("Luis", "camarero", pinLuis);
}

function productoId(nombre: string): string {
  const fila = db
    .prepare(`SELECT id FROM productos WHERE restaurante_id = ? AND nombre = ?`)
    .get(restauranteId(), nombre) as { id: string };
  return fila.id;
}

function mesaId(nombre: string): string {
  const fila = db
    .prepare(`SELECT id FROM mesas WHERE restaurante_id = ? AND nombre = ?`)
    .get(restauranteId(), nombre) as { id: string };
  return fila.id;
}

function sembrarServicio() {
  const rid = restauranteId();
  const admin = db
    .prepare(`SELECT id FROM usuarios WHERE restaurante_id = ? AND rol = 'admin' AND activo = 1 LIMIT 1`)
    .get(rid) as { id: string } | undefined;
  const ana = db
    .prepare(`SELECT id FROM usuarios WHERE restaurante_id = ? AND nombre = ? AND activo = 1`)
    .get(rid, process.env.DEMO_WAITER_NAME ?? "Ana") as { id: string } | undefined;
  if (!admin || !ana) return;

  const ahora = Date.now();
  const hace = (min: number) => new Date(ahora - min * 60_000).toISOString();
  const turno = uuid();
  db.prepare(
    `INSERT INTO turnos (id, restaurante_id, usuario_apertura_id, abierto_en, caja_inicial)
     VALUES (?, ?, ?, ?, 100)`
  ).run(turno, rid, admin.id, hace(180));

  const linea = db.prepare(
    `INSERT INTO lineas_comanda
       (id, comanda_id, ronda_id, producto_id, cantidad, precio_unitario, notas, estado, enviado_en)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'enviada', ?)`
  );
  const ronda = db.prepare(
    `INSERT INTO rondas (id, comanda_id, camarero_id, estado, creado_en) VALUES (?, ?, ?, 'enviada', ?)`
  );
  const comanda = db.prepare(
    `INSERT INTO comandas (id, restaurante_id, turno_id, mesa_id, tipo, camarero_id, estado, creado_en, cerrado_en)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const abierta = (mesa: string, minutos: number, lineas: [string, number, number][]) => {
    const cid = uuid();
    const cuando = hace(minutos);
    comanda.run(cid, rid, turno, mesaId(mesa), "mesa", ana.id, "abierta", cuando, null);
    const ridR = uuid();
    ronda.run(ridR, cid, ana.id, cuando);
    for (const [nombre, cantidad, precio] of lineas) {
      linea.run(uuid(), cid, ridR, productoId(nombre), cantidad, precio, null, cuando);
    }
    db.prepare(`UPDATE mesas SET estado = 'ocupada' WHERE id = ?`).run(mesaId(mesa));
  };

  abierta("2", 35, [["Hamburguesa", 1, 12.5], ["Caña", 2, 2.5]]);
  abierta("4", 12, [["Ensalada", 1, 9], ["Agua", 1, 1.8]]);

  const llevar = uuid();
  const cuandoLlevar = hace(8);
  comanda.run(llevar, rid, turno, null, "llevar", ana.id, "abierta", cuandoLlevar, null);
  const rLlevar = uuid();
  ronda.run(rLlevar, llevar, ana.id, cuandoLlevar);
  linea.run(uuid(), llevar, rLlevar, productoId("Café"), 2, 1.5, "para llevar", cuandoLlevar);

  const cerrada = uuid();
  const abiertaEn = hace(140);
  const cerradaEn = hace(90);
  comanda.run(cerrada, rid, turno, mesaId("1"), "mesa", ana.id, "cerrada", abiertaEn, cerradaEn);
  const rCerrada = uuid();
  ronda.run(rCerrada, cerrada, ana.id, abiertaEn);
  linea.run(uuid(), cerrada, rCerrada, productoId("Tortilla"), 1, 7, null, abiertaEn);
  linea.run(uuid(), cerrada, rCerrada, productoId("Café"), 1, 1.5, null, abiertaEn);
  db.prepare(
    `INSERT INTO pagos (id, comanda_id, metodo, importe, propina, creado_en, serie_simpl, numero_simpl, ejercicio_simpl)
     VALUES (?, ?, 'tarjeta', 8.5, 0, ?, 'DEMO', 1, ?)`
  ).run(uuid(), cerrada, cerradaEn, new Date().getFullYear());
}

function borrarActividad() {
  const rid = restauranteId();
  const comandas = db.prepare(`SELECT id FROM comandas WHERE restaurante_id = ?`).all(rid) as { id: string }[];
  const ids = comandas.map((c) => c.id);
  const borrar = (sql: string, lista: string[]) => {
    for (const id of lista) db.prepare(sql).run(id);
  };
  borrar(
    `DELETE FROM linea_extras WHERE linea_id IN (SELECT id FROM lineas_comanda WHERE comanda_id = ?)`,
    ids
  );
  borrar(`DELETE FROM lineas_comanda WHERE comanda_id = ?`, ids);
  borrar(`DELETE FROM rondas WHERE comanda_id = ?`, ids);
  db.prepare(`DELETE FROM facturas WHERE restaurante_id = ?`).run(rid);
  borrar(`DELETE FROM pagos WHERE comanda_id = ?`, ids);
  db.prepare(`DELETE FROM comandas WHERE restaurante_id = ?`).run(rid);
  db.prepare(`DELETE FROM turnos WHERE restaurante_id = ?`).run(rid);

  const destinos = db.prepare(`SELECT id FROM puntos_destino WHERE restaurante_id = ?`).all(rid) as { id: string }[];
  for (const d of destinos) db.prepare(`DELETE FROM log_impresion WHERE punto_destino_id = ?`).run(d.id);

  const extras = db.prepare(`SELECT id FROM extras WHERE restaurante_id = ?`).all(rid) as { id: string }[];
  for (const e of extras) {
    db.prepare(`DELETE FROM extra_producto WHERE extra_id = ?`).run(e.id);
    db.prepare(`DELETE FROM extra_categoria WHERE extra_id = ?`).run(e.id);
  }
  db.prepare(`DELETE FROM extras WHERE restaurante_id = ?`).run(rid);

  const productos = db.prepare(`SELECT id FROM productos WHERE restaurante_id = ?`).all(rid) as { id: string }[];
  for (const p of productos) db.prepare(`DELETE FROM producto_destino WHERE producto_id = ?`).run(p.id);
  const categorias = db.prepare(`SELECT id FROM categorias WHERE restaurante_id = ?`).all(rid) as { id: string }[];
  for (const c of categorias) db.prepare(`DELETE FROM categoria_destino WHERE categoria_id = ?`).run(c.id);
  db.prepare(`DELETE FROM productos WHERE restaurante_id = ?`).run(rid);
  db.prepare(`DELETE FROM categorias WHERE restaurante_id = ?`).run(rid);
  db.prepare(`DELETE FROM menus WHERE restaurante_id = ?`).run(rid);
  db.prepare(`DELETE FROM mesas WHERE restaurante_id = ?`).run(rid);
  db.prepare(`DELETE FROM zonas WHERE restaurante_id = ?`).run(rid);
  db.prepare(`DELETE FROM puntos_destino WHERE restaurante_id = ?`).run(rid);
  db.prepare(`DELETE FROM ajustes WHERE restaurante_id = ? AND clave = ?`).run(rid, MARCA);
}
