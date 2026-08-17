import { Router } from "express";
import { v4 as uuid } from "uuid";
import { z } from "zod";
import { db } from "../../db/connection.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";

export const historialRouter = Router();
const RESTAURANTE_ID = process.env.RESTAURANTE_ID ?? "restaurante-demo";

/**
 * POLÍTICA DE RETENCIÓN
 *
 * Los datos de negocio NO se borran en años, y por dos motivos:
 *   1. Legalmente hay obligación de conservar la facturación 4 años
 *      (plazo de prescripción fiscal).
 *   2. Ocupan poquísimo: un restaurante de 120 comandas al día genera unos
 *      57 MB al año. Cinco años son menos del 1% de una tarjeta de 32 GB.
 *      Borrar el historial de ventas para "ahorrar espacio" sería tirar
 *      información valiosa a cambio de nada.
 *
 * Lo que SÍ hay que limpiar es log_impresion, porque guarda los bytes de cada
 * ticket generado (unos 75 MB al año) y no tiene ningún valor pasadas unas
 * horas: si un ticket se imprimió bien, su contenido se puede reconstruir
 * desde la comanda cuando haga falta.
 */
export const RETENCION = {
  /** Años que se conservan comandas, pagos y facturas. */
  datosNegocioAnios: 5,
  /** Días que se conserva la cola de impresión ya procesada. */
  colaImpresionDias: 7,
  /** Días hacia atrás que se pueden reimprimir tickets. */
  reimpresionDias: 90,
};

// ---------------------------------------------------------------------------
// Listado
// ---------------------------------------------------------------------------

const listadoSchema = z.object({
  desde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  hasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  /** Busca por número de ticket, mesa o camarero */
  q: z.string().optional(),
  metodo: z.enum(["efectivo", "tarjeta", "otro"]).optional(),
  soloFacturas: z.coerce.boolean().optional(),
  limite: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

historialRouter.get("/", requireAuth, requireRole("admin"), (req, res) => {
  const parsed = listadoSchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());
  const { desde, hasta, q, metodo, soloFacturas, limite, offset } = parsed.data;

  const filtros: string[] = [`c.restaurante_id = ?`];
  const params: unknown[] = [RESTAURANTE_ID];

  if (desde) { filtros.push(`date(pg.creado_en) >= ?`); params.push(desde); }
  if (hasta) { filtros.push(`date(pg.creado_en) <= ?`); params.push(hasta); }
  if (metodo) { filtros.push(`pg.metodo = ?`); params.push(metodo); }
  if (soloFacturas) filtros.push(`f.id IS NOT NULL`);
  if (q) {
    filtros.push(`(
      COALESCE(pg.serie_simpl, '') || '-' || COALESCE(pg.numero_simpl, '') LIKE ?
      OR COALESCE(m.nombre, '') LIKE ?
      OR u.nombre LIKE ?
      OR COALESCE(f.cliente_razon_social, '') LIKE ?
    )`);
    const like = `%${q}%`;
    params.push(like, like, like, like);
  }

  const where = filtros.join(" AND ");

  const total = db
    .prepare(
      `SELECT COUNT(*) AS n FROM pagos pg
         JOIN comandas c ON c.id = pg.comanda_id
         JOIN usuarios u ON u.id = c.camarero_id
         LEFT JOIN mesas m ON m.id = c.mesa_id
         LEFT JOIN facturas f ON f.pago_id = pg.id AND f.anulada = 0
        WHERE ${where}`
    )
    .get(...params) as { n: number };

  const tickets = db
    .prepare(
      `SELECT pg.id AS pagoId,
              pg.serie_simpl, pg.numero_simpl, pg.ejercicio_simpl,
              pg.creado_en AS cobrado_en, pg.metodo, pg.importe, pg.propina,
              c.id AS comandaId, c.tipo, c.creado_en AS abierto_en,
              m.nombre AS mesa, u.nombre AS camarero,
              f.id AS facturaId, f.serie AS factura_serie, f.numero AS factura_numero,
              f.ejercicio AS factura_ejercicio, f.cliente_razon_social,
              (SELECT COALESCE(SUM(l.cantidad), 0) FROM lineas_comanda l WHERE l.comanda_id = c.id) AS unidades,
              (SELECT COALESCE(SUM(l.cantidad * l.precio_unitario), 0) FROM lineas_comanda l WHERE l.comanda_id = c.id) AS total_cuenta
         FROM pagos pg
         JOIN comandas c ON c.id = pg.comanda_id
         JOIN usuarios u ON u.id = c.camarero_id
         LEFT JOIN mesas m ON m.id = c.mesa_id
         LEFT JOIN facturas f ON f.pago_id = pg.id AND f.anulada = 0
        WHERE ${where}
        ORDER BY pg.creado_en DESC
        LIMIT ? OFFSET ?`
    )
    .all(...params, limite, offset) as Record<string, unknown>[];

  res.json({
    total: total.n,
    limite,
    offset,
    tickets: tickets.map((t) => ({
      ...t,
      // Minutos que estuvo la mesa ocupada: de abrir la comanda a cobrarla.
      minutos:
        t.abierto_en && t.cobrado_en
          ? Math.round(
              (Date.parse(String(t.cobrado_en)) - Date.parse(String(t.abierto_en))) / 60000
            )
          : null,
      numeroTicket: t.numero_simpl
        ? `${t.serie_simpl}-${t.ejercicio_simpl}/${String(t.numero_simpl).padStart(5, "0")}`
        : null,
      numeroFactura: t.factura_numero
        ? `${t.factura_serie}-${t.factura_ejercicio}/${String(t.factura_numero).padStart(5, "0")}`
        : null,
    })),
  });
});

// ---------------------------------------------------------------------------
// Detalle de un ticket
// ---------------------------------------------------------------------------

historialRouter.get("/:pagoId", requireAuth, requireRole("admin"), (req, res) => {
  const cab = db
    .prepare(
      `SELECT pg.id AS pagoId, pg.serie_simpl, pg.numero_simpl, pg.ejercicio_simpl,
              pg.creado_en AS cobrado_en, pg.metodo, pg.importe, pg.propina,
              c.id AS comandaId, c.tipo, c.creado_en AS abierto_en, c.cerrado_en,
              m.nombre AS mesa, z.nombre AS zona, u.nombre AS camarero
         FROM pagos pg
         JOIN comandas c ON c.id = pg.comanda_id
         JOIN usuarios u ON u.id = c.camarero_id
         LEFT JOIN mesas m ON m.id = c.mesa_id
         LEFT JOIN zonas z ON z.id = m.zona_id
        WHERE pg.id = ? AND c.restaurante_id = ?`
    )
    .get(req.params.pagoId, RESTAURANTE_ID) as Record<string, unknown> | undefined;
  if (!cab) return res.status(404).json({ error: "Ticket no encontrado" });

  const lineas = db
    .prepare(
      `SELECT l.id, l.cantidad, p.nombre, l.precio_unitario, p.tipo_iva, l.notas
         FROM lineas_comanda l
         JOIN productos p ON p.id = l.producto_id
        WHERE l.comanda_id = ?
        ORDER BY l.enviado_en`
    )
    .all(cab.comandaId) as {
    id: string; cantidad: number; precio_unitario: number; tipo_iva: number;
  }[];

  const extras = db
    .prepare(
      `SELECT le.linea_id, le.nombre, le.precio FROM linea_extras le
         JOIN lineas_comanda l ON l.id = le.linea_id
        WHERE l.comanda_id = ?`
    )
    .all(cab.comandaId) as { linea_id: string; nombre: string; precio: number }[];

  // Desglose de IVA reconstruido igual que en el ticket original.
  const porTipo = new Map<number, number>();
  for (const l of lineas) {
    porTipo.set(l.tipo_iva, (porTipo.get(l.tipo_iva) ?? 0) + l.cantidad * l.precio_unitario);
  }
  const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
  const desgloseIva = [...porTipo.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([tipo, conIva]) => {
      const base = r2(conIva / (1 + tipo / 100));
      return { tipo, base, cuota: r2(conIva - base), total: r2(conIva) };
    });

  const factura = db
    .prepare(`SELECT * FROM facturas WHERE pago_id = ? AND anulada = 0`)
    .get(req.params.pagoId);

  // Todos los pagos de esa cuenta (puede haber sido partida).
  const pagos = db
    .prepare(`SELECT id, metodo, importe, propina, creado_en FROM pagos WHERE comanda_id = ? ORDER BY creado_en`)
    .all(cab.comandaId);

  const reimpresiones = db
    .prepare(
      `SELECT COUNT(*) AS n FROM log_impresion WHERE pago_id = ? AND es_copia = 1`
    )
    .get(req.params.pagoId) as { n: number };

  res.json({
    ...cab,
    numeroTicket: cab.numero_simpl
      ? `${cab.serie_simpl}-${cab.ejercicio_simpl}/${String(cab.numero_simpl).padStart(5, "0")}`
      : null,
    minutos:
      cab.abierto_en && cab.cobrado_en
        ? Math.round((Date.parse(String(cab.cobrado_en)) - Date.parse(String(cab.abierto_en))) / 60000)
        : null,
    lineas: lineas.map((l) => ({
      ...l,
      extras: extras.filter((e) => e.linea_id === l.id).map(({ nombre, precio }) => ({ nombre, precio })),
    })),
    desgloseIva,
    totalCuenta: r2(lineas.reduce((a, l) => a + l.cantidad * l.precio_unitario, 0)),
    pagos,
    factura: factura ?? null,
    vecesReimpreso: reimpresiones.n,
  });
});

// ---------------------------------------------------------------------------
// Reimpresión
// ---------------------------------------------------------------------------

historialRouter.post("/:pagoId/reimprimir", requireAuth, requireRole("admin"), (req, res) => {
  const parsed = z.object({ impresoraId: z.string() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());

  const pago = db
    .prepare(
      `SELECT pg.id, pg.creado_en FROM pagos pg
         JOIN comandas c ON c.id = pg.comanda_id
        WHERE pg.id = ? AND c.restaurante_id = ?`
    )
    .get(req.params.pagoId, RESTAURANTE_ID) as { id: string; creado_en: string } | undefined;
  if (!pago) return res.status(404).json({ error: "Ticket no encontrado" });

  const dias = (Date.now() - Date.parse(pago.creado_en)) / 86400000;
  if (dias > RETENCION.reimpresionDias) {
    return res.status(409).json({
      error: `Solo se pueden reimprimir tickets de los últimos ${RETENCION.reimpresionDias} días. Para uno más antiguo, consulta el detalle y expórtalo.`,
    });
  }

  const impresora = db
    .prepare(`SELECT id FROM puntos_destino WHERE id = ? AND restaurante_id = ?`)
    .get(parsed.data.impresoraId, RESTAURANTE_ID);
  if (!impresora) return res.status(404).json({ error: "Impresora no encontrada" });

  // es_copia = 1: el papel saldrá marcado como COPIA. No se puede emitir dos
  // veces el mismo número de factura como original.
  const id = uuid();
  db.prepare(
    `INSERT INTO log_impresion (id, pago_id, punto_destino_id, estado, intentos, es_copia, creado_en)
     VALUES (?, ?, ?, 'pendiente', 0, 1, ?)`
  ).run(id, pago.id, parsed.data.impresoraId, new Date().toISOString());

  res.status(201).json({ logId: id, esCopia: true });
});

// ---------------------------------------------------------------------------
// Mantenimiento
// ---------------------------------------------------------------------------

/** Estado de ocupación y qué se limpiaría. Informativo, no borra nada. */
historialRouter.get("/mantenimiento/estado", requireAuth, requireRole("admin"), (_req, res) => {
  const cuenta = (sql: string, ...p: unknown[]) =>
    (db.prepare(sql).get(...p) as { n: number }).n;

  res.json({
    retencion: RETENCION,
    comandas: cuenta(`SELECT COUNT(*) n FROM comandas WHERE restaurante_id = ?`, RESTAURANTE_ID),
    pagos: cuenta(`SELECT COUNT(*) n FROM pagos`),
    facturas: cuenta(`SELECT COUNT(*) n FROM facturas WHERE restaurante_id = ?`, RESTAURANTE_ID),
    colaImpresion: cuenta(`SELECT COUNT(*) n FROM log_impresion`),
    colaPurgable: cuenta(
      `SELECT COUNT(*) n FROM log_impresion
        WHERE estado = 'ok' AND julianday('now') - julianday(creado_en) > ?`,
      RETENCION.colaImpresionDias
    ),
    ticketMasAntiguo: (
      db.prepare(`SELECT MIN(creado_en) AS f FROM pagos`).get() as { f: string | null }
    ).f,
  });
});

/** Purga la cola de impresión ya procesada. Los datos de negocio NO se tocan. */
historialRouter.post("/mantenimiento/purgar", requireAuth, requireRole("admin"), (_req, res) => {
  const info = db
    .prepare(
      `DELETE FROM log_impresion
        WHERE estado = 'ok' AND julianday('now') - julianday(creado_en) > ?`
    )
    .run(RETENCION.colaImpresionDias);
  res.json({ borrados: info.changes, dias: RETENCION.colaImpresionDias });
});
