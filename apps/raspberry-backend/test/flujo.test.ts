import assert from "node:assert/strict";
import fs from "node:fs";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { randomUUID } from "node:crypto";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "comandas-"));
process.env.DB_PATH = path.join(dir, "t.sqlite");
process.env.TOKEN_SECRET = "clave-de-test-suficientemente-larga";
process.env.RESTAURANTE_ID = "restaurante-demo";
process.env.NODE_ENV = "test";

const { db } = await import("../src/db/connection.ts");
const { crearServidor } = await import("../src/server.ts");
const { firmarToken } = await import("../src/middleware/auth.ts");

const ADMIN = "11111111-1111-4111-8111-111111111111";
const CAMARERO = "22222222-2222-4222-8222-222222222222";

let base = "";
let cerrar = () => {};

async function http(method: string, ruta: string, body?: unknown, token?: string) {
  const res = await fetch(base + ruta, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: Record<string, unknown> | null = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { status: res.status, json };
}

async function tokenDe(usuarioId: string, pin: string) {
  const rest = await http("POST", "/auth/restaurante", {
    email: "admin@demo.com",
    password: "admin",
    dispositivoId: "test",
  });
  assert.equal(rest.status, 200, JSON.stringify(rest.json));
  const entrar = await http("POST", "/auth/entrar", { usuarioId, pin }, String(rest.json?.tokenRestaurante));
  assert.equal(entrar.status, 200, JSON.stringify(entrar.json));
  return String(entrar.json?.token);
}

describe("flujo de servicio", { concurrency: 1 }, () => {
  let adminToken = "";
  let camareroToken = "";
  let mesaA = "";
  let mesaB = "";
  let productoId = "";
  let agotadoId = "";
  let turnoId = "";

  before(async () => {
    const ahora = new Date().toISOString();
    db.prepare(
      `INSERT INTO restaurantes (id, nombre, email, password_hash, creado_en)
       VALUES ('restaurante-demo', 'Demo', 'admin@demo.com', 'admin', ?)`
    ).run(ahora);
    db.prepare(
      `INSERT INTO usuarios (id, restaurante_id, nombre, rol, pin_hash, activo, creado_en)
       VALUES (?, 'restaurante-demo', 'Admin', 'admin', '1234', 1, ?)`
    ).run(ADMIN, ahora);
    db.prepare(
      `INSERT INTO usuarios (id, restaurante_id, nombre, rol, pin_hash, activo, creado_en)
       VALUES (?, 'restaurante-demo', 'Ana', 'camarero', '1111', 1, ?)`
    ).run(CAMARERO, ahora);

    const { httpServer, io } = crearServidor();
    await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", () => resolve()));
    base = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
    cerrar = () => {
      io.close();
      httpServer.close();
    };
  });

  after(() => {
    cerrar();
    db.close();
  });

  test("el login reescribe contraseña y PIN que estaban en claro, y el rol sale de la BD", async () => {
    adminToken = await tokenDe(ADMIN, "1234");
    camareroToken = await tokenDe(CAMARERO, "1111");

    const pass = db.prepare(`SELECT password_hash FROM restaurantes`).get() as { password_hash: string };
    const pin = db.prepare(`SELECT pin_hash FROM usuarios WHERE id = ?`).get(ADMIN) as { pin_hash: string };
    assert.equal(pass.password_hash.startsWith("scrypt$"), true);
    assert.equal(pin.pin_hash.startsWith("scrypt$"), true);

    const falso = firmarToken({
      usuarioId: CAMARERO,
      restauranteId: "restaurante-demo",
      rol: "admin",
      dispositivoId: "test",
    });
    const prohibido = await http("GET", "/usuarios", undefined, falso);
    assert.equal(prohibido.status, 403);

    const sinFirma = Buffer.from(JSON.stringify({
      usuarioId: ADMIN, restauranteId: "restaurante-demo", rol: "admin", dispositivoId: "test",
    })).toString("base64");
    assert.equal((await http("GET", "/usuarios", undefined, sinFirma)).status, 401);
  });

  test("una ronda repetida no se duplica, lo agotado se rechaza y anular baja la cuenta", async () => {
    const zona = await http("POST", "/espacios/zonas", { nombre: "Sala" }, adminToken);
    assert.equal(zona.status, 201);
    const a = await http("POST", "/espacios/mesas", { zonaId: zona.json?.id, nombre: "1" }, adminToken);
    const b = await http("POST", "/espacios/mesas", { zonaId: zona.json?.id, nombre: "2" }, adminToken);
    mesaA = String(a.json?.id);
    mesaB = String(b.json?.id);

    const menu = await http("POST", "/carta/menus", { nombre: "Carta" }, adminToken);
    const cat = await http("POST", "/carta/categorias", { menuId: menu.json?.id, nombre: "Cocina" }, adminToken);
    const producto = await http("POST", "/carta/productos", {
      categoriaId: cat.json?.id, nombre: "Hamburguesa", precio: 10, tipoIva: 10,
    }, adminToken);
    const agotado = await http("POST", "/carta/productos", {
      categoriaId: cat.json?.id, nombre: "Sopa", precio: 6, tipoIva: 10, disponible: false,
    }, adminToken);
    productoId = String(producto.json?.id);
    agotadoId = String(agotado.json?.id);

    const turno = await http("GET", "/turnos/activo", undefined, adminToken);
    assert.equal(turno.status, 200);
    turnoId = String(turno.json?.id);

    const comanda = await http("POST", "/comandas", {
      turnoId, mesaId: mesaA, tipo: "mesa",
    }, camareroToken);
    assert.equal(comanda.status, 201);
    const comandaId = String(comanda.json?.id);

    const rondaId = randomUUID();
    const r1 = await http("POST", `/comandas/${comandaId}/rondas`, {
      rondaId,
      lineas: [{ productoId, cantidad: 2 }],
    }, camareroToken);
    assert.equal(r1.status, 201);
    const r2 = await http("POST", `/comandas/${comandaId}/rondas`, {
      rondaId,
      lineas: [{ productoId, cantidad: 2 }],
    }, camareroToken);
    assert.equal(r2.status, 200);
    assert.equal(r2.json?.duplicada, true);

    const cuenta = await http("GET", `/comandas/${comandaId}/cuenta`, undefined, camareroToken);
    assert.equal(cuenta.json?.total, 20);

    const no = await http("POST", `/comandas/${comandaId}/rondas`, {
      lineas: [{ productoId: agotadoId, cantidad: 1 }],
    }, camareroToken);
    assert.equal(no.status, 400);

    const detalle = await http("GET", `/comandas/${comandaId}`, undefined, camareroToken);
    const lineas = detalle.json?.lineas as { id: string; anulada: number }[];
    assert.equal(lineas.length, 1);

    const anula = await http("POST", `/comandas/${comandaId}/lineas/${lineas[0].id}/anular`, {
      motivo: "Error al pedir", cantidad: 1,
    }, camareroToken);
    assert.equal(anula.status, 200, JSON.stringify(anula.json));
    assert.equal(anula.json?.total, 10);

    const dto = await http("PUT", `/comandas/${comandaId}/descuento`, {
      tipo: "porcentaje", valor: 10, motivo: "Cortesía",
    }, adminToken);
    assert.equal(dto.status, 200, JSON.stringify(dto.json));
    assert.equal(dto.json?.total, 9);
    assert.equal(dto.json?.pendiente, 9);

    const deMas = await http("POST", `/comandas/${comandaId}/pagos`, {
      metodo: "efectivo", importe: 50,
    }, camareroToken);
    assert.equal(deMas.status, 400);

    const pago = await http("POST", `/comandas/${comandaId}/pagos`, {
      metodo: "tarjeta", importe: 9,
    }, camareroToken);
    assert.equal(pago.status, 201);
    assert.equal(pago.json?.comandaCerrada, true);

    const mesa = db.prepare(`SELECT estado FROM mesas WHERE id = ?`).get(mesaA) as { estado: string };
    assert.equal(mesa.estado, "libre");

    const otra = await http("POST", `/comandas/${comandaId}/rondas`, {
      lineas: [{ productoId, cantidad: 1 }],
    }, camareroToken);
    assert.equal(otra.status, 409);

    const historial = await http("GET", "/historial", undefined, adminToken);
    assert.equal(historial.status, 200, JSON.stringify(historial.json));
  });

  test("mover una comanda vacía no ocupa la mesa destino, y cerrar a cero libera", async () => {
    const vacia = await http("POST", "/comandas", { turnoId, mesaId: mesaA, tipo: "mesa" }, camareroToken);
    assert.equal(vacia.status, 201);
    const movida = await http("POST", `/comandas/${vacia.json?.id}/mover`, { mesaDestinoId: mesaB }, camareroToken);
    assert.equal(movida.status, 200);
    assert.equal(movida.json?.modo, "movida");
    const destino = db.prepare(`SELECT estado FROM mesas WHERE id = ?`).get(mesaB) as { estado: string };
    assert.equal(destino.estado, "libre");

    const conAlgo = await http("POST", "/comandas", { turnoId, mesaId: mesaA, tipo: "mesa" }, camareroToken);
    const id = String(conAlgo.json?.id);
    await http("POST", `/comandas/${id}/rondas`, {
      imprimir: false,
      lineas: [{ productoId, cantidad: 1 }],
    }, camareroToken);
    const det = await http("GET", `/comandas/${id}`, undefined, camareroToken);
    const linea = (det.json?.lineas as { id: string }[])[0];
    const anula = await http("POST", `/comandas/${id}/lineas/${linea.id}/anular`, {
      motivo: "El cliente ya no lo quiere",
    }, camareroToken);
    assert.equal(anula.json?.pendiente, 0);
    const cierre = await http("POST", `/comandas/${id}/cerrar`, undefined, camareroToken);
    assert.equal(cierre.status, 200, JSON.stringify(cierre.json));
    const mesa = db.prepare(`SELECT estado FROM mesas WHERE id = ?`).get(mesaA) as { estado: string };
    assert.equal(mesa.estado, "libre");
  });
});
