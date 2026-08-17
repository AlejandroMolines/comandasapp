import Database from "better-sqlite3";
import path from "node:path";
import { io, type Socket } from "socket.io-client";
import { escposRedDriver } from "./drivers/escpos-red.js";
import { crearWebsocketKdsDriver, escposUsbDriver } from "./drivers/otros.js";
import type { DestinoDriver, PuntoDestinoRow, TicketData } from "./types.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const DB_PATH =
  process.env.DB_PATH ??
  path.resolve(process.cwd(), "../raspberry-backend/data/local.sqlite");
const BACKEND_URL = process.env.BACKEND_URL ?? "http://127.0.0.1:3000";
const RESTAURANTE_ID = process.env.RESTAURANTE_ID ?? "restaurante-demo";

const POLL_MS = 1500;
const HEALTH_MS = 30_000;
const MAX_INTENTOS = 4;
/** espera antes del intento n (índice = intentos ya hechos) */
const BACKOFF_MS = [0, 2_000, 5_000, 15_000];

// Misma BD que el backend: WAL permite que ambos procesos convivan.
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

// Conexión al backend para: alertas a los dispositivos + canal KDS.
const socketBackend: Socket = io(BACKEND_URL, {
  auth: { rol: "printer-worker" },
  reconnection: true,
});
socketBackend.on("connect", () => console.log("[worker] conectado al backend"));
socketBackend.on("disconnect", () => console.log("[worker] backend desconectado"));

const drivers: Record<string, DestinoDriver> = {
  escpos_red: escposRedDriver,
  escpos_usb: escposUsbDriver,
  websocket_kds: crearWebsocketKdsDriver(socketBackend),
};

// ---------------------------------------------------------------------------
// Construcción del ticket desde la BD
// ---------------------------------------------------------------------------
interface LogRow {
  id: string;
  ronda_id: string | null;
  pago_id: string | null;
  punto_destino_id: string;
  intentos: number;
  /** 1 si es una reimpresión: el papel saldrá marcado como COPIA */
  es_copia: number;
  ultimo_intento_en: string | null;
}

function construirTicket(log: LogRow, destinoId: string): TicketData | null {
  if (log.ronda_id) {
    const cab = db
      .prepare(
        `SELECT r.creado_en, u.nombre AS camarero, m.nombre AS mesa
           FROM rondas r
           JOIN usuarios u ON u.id = r.camarero_id
           JOIN comandas c ON c.id = r.comanda_id
           LEFT JOIN mesas m ON m.id = c.mesa_id
          WHERE r.id = ?`
      )
      .get(log.ronda_id) as { creado_en: string; camarero: string; mesa: string | null } | undefined;
    if (!cab) return null;

    // Solo las líneas de esta ronda que van a ESTE destino.
    const lineas = db
      .prepare(
        `SELECT l.id, l.cantidad, p.nombre, l.notas
           FROM lineas_comanda l
           JOIN productos p ON p.id = l.producto_id
          WHERE l.ronda_id = ? AND l.impresora_resuelta_id = ?`
      )
      .all(log.ronda_id, destinoId) as {
        id: string; cantidad: number; nombre: string; notas: string | null;
      }[];
    if (lineas.length === 0) return null;

    // Los extras van con la línea a cocina: son parte de la instrucción, no
    // un adorno. Un "sin gluten" que no llegue al cocinero es un problema.
    const getExtras = db.prepare(`SELECT nombre, precio FROM linea_extras WHERE linea_id = ?`);

    return {
      logId: log.id,
      tipo: "comanda",
      mesa: cab.mesa,
      camarero: cab.camarero,
      hora: cab.creado_en.slice(11, 16),
      lineas: lineas.map((l) => ({
        cantidad: l.cantidad,
        nombre: l.nombre,
        notas: l.notas,
        extras: getExtras.all(l.id) as { nombre: string; precio: number }[],
      })),
    };
  }

  if (log.pago_id) {
    const cab = db
      .prepare(
        `SELECT pg.creado_en, pg.importe, pg.metodo, m.nombre AS mesa, u.nombre AS camarero
           FROM pagos pg
           JOIN comandas c ON c.id = pg.comanda_id
           JOIN usuarios u ON u.id = c.camarero_id
           LEFT JOIN mesas m ON m.id = c.mesa_id
          WHERE pg.id = ?`
      )
      .get(log.pago_id) as
      | { creado_en: string; importe: number; metodo: string; mesa: string | null; camarero: string }
      | undefined;
    if (!cab) return null;

    const lineas = db
      .prepare(
        `SELECT l.id, l.cantidad, p.nombre, l.precio_unitario, p.tipo_iva
           FROM lineas_comanda l
           JOIN productos p ON p.id = l.producto_id
          WHERE l.comanda_id = (SELECT comanda_id FROM pagos WHERE id = ?)`
      )
      .all(log.pago_id) as {
        id: string; cantidad: number; nombre: string; precio_unitario: number; tipo_iva: number;
      }[];

    // Extras de cada línea, para detallarlos bajo el producto.
    const extrasDb = db
      .prepare(`SELECT linea_id, nombre, precio FROM linea_extras`)
      .all() as { linea_id: string; nombre: string; precio: number }[];
    const extrasDe = (lineaId: string) =>
      extrasDb.filter((e) => e.linea_id === lineaId).map(({ nombre, precio }) => ({ nombre, precio }));

    // El ticket que se entrega al cliente muestra el TOTAL de la cuenta,
    // no el importe del pago (que puede ser un parcial de un pago partido).
    const totalCuenta = lineas.reduce((acc, l) => acc + l.cantidad * l.precio_unitario, 0);

    // ¿Este pago generó una factura a empresa? Entonces el papel que sale
    // no es un simple ticket: es el documento fiscal completo.
    const fac = db
      .prepare(
        `SELECT serie, numero, ejercicio, fecha_expedicion,
                emisor_razon_social, emisor_nif, emisor_direccion,
                cliente_razon_social, cliente_nif, cliente_direccion,
                base_imponible, cuota_iva, desglose_iva
           FROM facturas WHERE pago_id = ? AND anulada = 0`
      )
      .get(log.pago_id) as Record<string, string | number> | undefined;

    // Datos fiscales del emisor y numeración de la factura simplificada.
    const aj = (clave: string) => {
      const f = db.prepare(`SELECT valor FROM ajustes WHERE clave = ?`).get(clave) as
        | { valor: string } | undefined;
      return f?.valor ?? "";
    };
    const pagoRow = db
      .prepare(`SELECT serie_simpl, numero_simpl, ejercicio_simpl FROM pagos WHERE id = ?`)
      .get(log.pago_id) as
      | { serie_simpl: string | null; numero_simpl: number | null; ejercicio_simpl: number | null }
      | undefined;

    // Desglose de IVA agrupado por tipo, calculado desde precios CON IVA.
    const porTipo = new Map<number, number>();
    for (const l of lineas) {
      const t = l.tipo_iva ?? 10;
      porTipo.set(t, (porTipo.get(t) ?? 0) + l.cantidad * l.precio_unitario);
    }
    const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
    const desgloseSimpl = [...porTipo.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([tipo, conIva]) => {
        const base = r2(conIva / (1 + tipo / 100));
        return { tipo, base, cuota: r2(conIva - base), total: r2(conIva) };
      });

    return {
      logId: log.id,
      tipo: "pago",
      mesa: cab.mesa,
      camarero: cab.camarero,
      hora: cab.creado_en.slice(11, 16),
      lineas: lineas.map((l) => ({
        cantidad: l.cantidad, nombre: l.nombre, notas: null,
        precio: l.precio_unitario, tipoIva: l.tipo_iva, extras: extrasDe(l.id),
      })),
      total: Number(totalCuenta.toFixed(2)),
      metodo: cab.metodo,
      esCopia: log.es_copia === 1,
      simplificada: pagoRow?.numero_simpl
        ? {
            numeroCompleto: `${pagoRow.serie_simpl}-${pagoRow.ejercicio_simpl}/${String(pagoRow.numero_simpl).padStart(5, "0")}`,
            fecha: cab.creado_en.slice(0, 10).split("-").reverse().join("/"),
            hora: cab.creado_en.slice(11, 16),
            emisor: {
              razonSocial: aj("fiscal_razon_social"),
              nif: aj("fiscal_nif"),
              direccion: aj("fiscal_direccion"),
            },
            desglose: desgloseSimpl,
            baseImponible: r2(desgloseSimpl.reduce((a, d) => a + d.base, 0)),
            cuotaIva: r2(desgloseSimpl.reduce((a, d) => a + d.cuota, 0)),
          }
        : undefined,
      factura: fac
        ? {
            numeroCompleto: `${fac.serie}-${fac.ejercicio}/${String(fac.numero).padStart(5, "0")}`,
            fecha: String(fac.fecha_expedicion).slice(0, 10).split("-").reverse().join("/"),
            emisor: {
              razonSocial: String(fac.emisor_razon_social),
              nif: String(fac.emisor_nif),
              direccion: String(fac.emisor_direccion),
            },
            cliente: {
              razonSocial: String(fac.cliente_razon_social),
              nif: String(fac.cliente_nif),
              direccion: String(fac.cliente_direccion),
            },
            desglose: JSON.parse(String(fac.desglose_iva)),
            baseImponible: Number(fac.base_imponible),
            cuotaIva: Number(fac.cuota_iva),
          }
        : undefined,
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Bucle principal
// ---------------------------------------------------------------------------
const destinosEnProceso = new Set<string>();

function listo(log: LogRow): boolean {
  if (log.intentos === 0 || !log.ultimo_intento_en) return true;
  const espera = BACKOFF_MS[Math.min(log.intentos, BACKOFF_MS.length - 1)];
  return Date.now() - Date.parse(log.ultimo_intento_en) >= espera;
}

async function procesarDestino(destinoId: string, logs: LogRow[]) {
  if (destinosEnProceso.has(destinoId)) return; // FIFO: un ticket a la vez por destino
  destinosEnProceso.add(destinoId);
  try {
    const destinoRaw = db
      .prepare(`SELECT * FROM puntos_destino WHERE id = ?`)
      .get(destinoId) as (Omit<PuntoDestinoRow, "config"> & { config: string }) | undefined;
    if (!destinoRaw) return;
    const destino: PuntoDestinoRow = { ...destinoRaw, config: JSON.parse(destinoRaw.config) };

    const driver = drivers[destino.protocolo];
    if (!driver) {
      console.error(`[worker] protocolo sin driver: ${destino.protocolo}`);
      return;
    }

    for (const log of logs) {
      if (!listo(log)) continue;

      const ticket = construirTicket(log, destinoId);
      if (!ticket) {
        // Ticket huérfano (datos borrados): lo cerramos para no bloquear la cola.
        db.prepare(`UPDATE log_impresion SET estado = 'error_definitivo', ultimo_error = 'ticket sin datos' WHERE id = ?`).run(log.id);
        continue;
      }

      const resultado = await driver.enviar(destino, ticket);
      const ahora = new Date().toISOString();

      if (resultado.ok) {
        db.prepare(`UPDATE log_impresion SET estado = 'ok', ultimo_intento_en = ? WHERE id = ?`).run(ahora, log.id);
        socketBackend.emit("worker:impresion_ok", {
          restauranteId: RESTAURANTE_ID,
          logId: log.id,
          rondaId: log.ronda_id,
          destino: destino.nombre,
        });
        console.log(`[worker] OK -> ${destino.nombre} (log ${log.id.slice(0, 8)})`);
      } else {
        const intentos = log.intentos + 1;
        const agotado = intentos >= MAX_INTENTOS;
        db.prepare(
          `UPDATE log_impresion SET intentos = ?, ultimo_error = ?, ultimo_intento_en = ?, estado = ? WHERE id = ?`
        ).run(intentos, resultado.error ?? "desconocido", ahora, agotado ? "error_definitivo" : "pendiente", log.id);

        console.log(`[worker] fallo ${intentos}/${MAX_INTENTOS} -> ${destino.nombre}: ${resultado.error}`);

        if (agotado) {
          // Alerta a TODOS los dispositivos del restaurante, no solo al origen.
          socketBackend.emit("worker:impresion_fallida", {
            restauranteId: RESTAURANTE_ID,
            logId: log.id,
            rondaId: log.ronda_id,
            destino: destino.nombre,
            error: resultado.error,
          });
        }
        // Si el destino falla, no seguimos machacando con el resto de su cola
        // en esta pasada: esperamos al siguiente ciclo (respeta el backoff).
        break;
      }
    }
  } finally {
    destinosEnProceso.delete(destinoId);
  }
}

function cicloCola() {
  const pendientes = db
    .prepare(
      `SELECT id, ronda_id, pago_id, punto_destino_id, intentos, es_copia, ultimo_intento_en
         FROM log_impresion WHERE estado = 'pendiente' ORDER BY creado_en`
    )
    .all() as LogRow[];

  const porDestino = new Map<string, LogRow[]>();
  for (const log of pendientes) {
    if (!porDestino.has(log.punto_destino_id)) porDestino.set(log.punto_destino_id, []);
    porDestino.get(log.punto_destino_id)!.push(log);
  }

  // Destinos en paralelo entre sí; secuencial dentro de cada destino.
  for (const [destinoId, logs] of porDestino) {
    void procesarDestino(destinoId, logs);
  }
}

// ---------------------------------------------------------------------------
// Health check proactivo
// ---------------------------------------------------------------------------
async function cicloSalud() {
  const destinos = db
    .prepare(`SELECT * FROM puntos_destino WHERE restaurante_id = ?`)
    .all(RESTAURANTE_ID) as (Omit<PuntoDestinoRow, "config"> & { config: string })[];

  for (const raw of destinos) {
    const destino: PuntoDestinoRow = { ...raw, config: JSON.parse(raw.config) };
    const driver = drivers[destino.protocolo];
    if (!driver) continue;
    const vivo = await driver.ping(destino);
    const nuevoEstado = vivo ? "ok" : "caido";

    const anterior = (raw as unknown as { estado_salud: string }).estado_salud;
    db.prepare(
      `UPDATE puntos_destino SET estado_salud = ?, ultimo_visto_en = COALESCE(?, ultimo_visto_en) WHERE id = ?`
    ).run(nuevoEstado, vivo ? new Date().toISOString() : null, destino.id);

    // Solo avisamos en las TRANSICIONES (ok->caido / caido->ok), no en cada ciclo.
    if (anterior !== nuevoEstado && anterior !== "desconocido") {
      socketBackend.emit("worker:salud_destino", {
        restauranteId: RESTAURANTE_ID,
        destinoId: destino.id,
        nombre: destino.nombre,
        estado: nuevoEstado,
      });
      console.log(`[worker] salud ${destino.nombre}: ${anterior} -> ${nuevoEstado}`);
    }
  }
}

console.log(`[worker] arrancando · BD: ${DB_PATH} · backend: ${BACKEND_URL}`);
setInterval(cicloCola, POLL_MS);
setInterval(() => void cicloSalud(), HEALTH_MS);
void cicloSalud();
