import { Router } from "express";
import { v4 as uuid } from "uuid";
import { z } from "zod";
import { db } from "../../db/connection.js";
import { requireAuth } from "../../middleware/auth.js";
import { r2, resumenCuenta } from "../../lib/cuenta.js";
import { emitirFactura, ErrorFactura, type LineaFactura } from "../facturas/service.js";
import { getAjuste } from "../ajustes/routes.js";

export const pagosRouter = Router();
const RESTAURANTE_ID = process.env.RESTAURANTE_ID ?? "restaurante-demo";

/** Líneas vivas, con el descuento repartido para que el IVA salga sobre lo cobrado. */
function lineasFacturables(comandaId: string): LineaFactura[] {
  const lineas = db
    .prepare(
      `SELECT p.nombre, l.cantidad, l.precio_unitario, p.tipo_iva
         FROM lineas_comanda l JOIN productos p ON p.id = l.producto_id
        WHERE l.comanda_id = ? AND COALESCE(l.anulada, 0) = 0`
    )
    .all(comandaId) as LineaFactura[];
  const cuenta = resumenCuenta(comandaId);
  if (cuenta.descuento <= 0 || cuenta.bruto <= 0) return lineas;
  const factor = (cuenta.bruto - cuenta.descuento) / cuenta.bruto;
  return lineas.map((l) => ({ ...l, precio_unitario: r2(l.precio_unitario * factor) }));
}

// El total lo necesita el camarero ANTES de cobrar (para cantar la cuenta).
pagosRouter.get("/comandas/:comandaId/cuenta", requireAuth, (req, res) => {
  const comanda = db
    .prepare(`SELECT id, estado FROM comandas WHERE id = ? AND restaurante_id = ?`)
    .get(req.params.comandaId, RESTAURANTE_ID) as { id: string; estado: string } | undefined;
  if (!comanda) return res.status(404).json({ error: "Comanda no encontrada" });

  const productosPagados = db.prepare(
    `SELECT pl.linea_id, SUM(pl.cantidad) AS cantidad
       FROM pago_lineas pl JOIN pagos p ON p.id = pl.pago_id
      WHERE p.comanda_id = ? GROUP BY pl.linea_id`
  ).all(comanda.id) as { linea_id: string; cantidad: number }[];

  res.json({
    comandaId: comanda.id,
    ...resumenCuenta(comanda.id),
    productosPagados: productosPagados.map(({ linea_id, cantidad }) => ({ lineaId: linea_id, cantidad })),
  });
});

const pagoSchema = z.object({
  metodo: z.enum(["efectivo", "tarjeta", "otro"]),
  importe: z.number().positive().optional(),
  lineas: z.array(z.object({
    lineaId: z.string().min(1),
    cantidad: z.number().int().positive(),
  })).min(1).optional(),
  propina: z.number().nonnegative().default(0),
  // Qué caja imprime el ticket. Opcional: un pago parcial intermedio
  // puede registrarse sin imprimir nada.
  impresoraTicketId: z.string().nullable().optional().default(null),
  // Si viene una empresa, en vez de (o además de) el ticket simplificado se
  // emite una FACTURA COMPLETA a su nombre, con desglose de IVA.
  empresaId: z.string().nullable().optional().default(null),
}).refine((datos) => datos.importe !== undefined || datos.lineas !== undefined, {
  message: "Indica un importe o los productos que se van a pagar",
});

pagosRouter.post("/comandas/:comandaId/pagos", requireAuth, (req, res) => {
  const parsed = pagoSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());
  const { metodo, propina, impresoraTicketId, empresaId, lineas: lineasPago } = parsed.data;

  const comanda = db
    .prepare(`SELECT id, estado, mesa_id FROM comandas WHERE id = ? AND restaurante_id = ?`)
    .get(req.params.comandaId, RESTAURANTE_ID) as
    | { id: string; estado: string; mesa_id: string | null }
    | undefined;
  if (!comanda) return res.status(404).json({ error: "Comanda no encontrada" });
  if (comanda.estado === "cerrada" || comanda.estado === "cancelada") {
    return res.status(409).json({ error: `La comanda ya está ${comanda.estado}` });
  }

  const cuenta = resumenCuenta(comanda.id);
  const { total, pagado } = cuenta;
  const pendiente = cuenta.pendiente;

  let importe = parsed.data.importe ?? 0;
  if (lineasPago) {
    if (new Set(lineasPago.map((l) => l.lineaId)).size !== lineasPago.length) {
      return res.status(400).json({ error: "No repitas una misma línea de producto" });
    }

    const disponibles = db.prepare(
      `SELECT l.cantidad, l.precio_unitario
         FROM lineas_comanda l
        WHERE l.id = ? AND l.comanda_id = ? AND COALESCE(l.anulada, 0) = 0`
    );
    const cantidadPagada = db.prepare(
      `SELECT COALESCE(SUM(pl.cantidad), 0) AS cantidad
         FROM pago_lineas pl JOIN pagos p ON p.id = pl.pago_id
        WHERE p.comanda_id = ? AND pl.linea_id = ?`
    );
    let brutoSeleccionado = 0;
    let unidadesSeleccionadas = 0;
    for (const seleccion of lineasPago) {
      const linea = disponibles.get(seleccion.lineaId, comanda.id) as
        | { cantidad: number; precio_unitario: number }
        | undefined;
      if (!linea) return res.status(400).json({ error: "Uno de los productos ya no está disponible para cobrar" });
      const pagadas = cantidadPagada.get(comanda.id, seleccion.lineaId) as { cantidad: number };
      const unidadesPendientes = linea.cantidad - pagadas.cantidad;
      if (seleccion.cantidad > unidadesPendientes) {
        return res.status(400).json({ error: "Has seleccionado más unidades de las que quedan por cobrar" });
      }
      brutoSeleccionado += seleccion.cantidad * linea.precio_unitario;
      unidadesSeleccionadas += seleccion.cantidad;
    }

    const disponiblesTotales = db.prepare(
      `SELECT COALESCE(SUM(l.cantidad - COALESCE(pagadas.cantidad, 0)), 0) AS cantidad
         FROM lineas_comanda l
         LEFT JOIN (
           SELECT pl.linea_id, SUM(pl.cantidad) AS cantidad
             FROM pago_lineas pl JOIN pagos p ON p.id = pl.pago_id
            WHERE p.comanda_id = ? GROUP BY pl.linea_id
         ) pagadas ON pagadas.linea_id = l.id
        WHERE l.comanda_id = ? AND COALESCE(l.anulada, 0) = 0`
    ).get(comanda.id, comanda.id) as { cantidad: number };

    // Si se seleccionan todas las unidades restantes, cobra el saldo exacto
    // para absorber diferencias de céntimos del descuento prorrateado.
    importe = unidadesSeleccionadas === disponiblesTotales.cantidad
      ? pendiente
      : r2(brutoSeleccionado * (cuenta.bruto > 0 ? cuenta.total / cuenta.bruto : 0));
    if (importe <= 0) return res.status(400).json({ error: "Los productos seleccionados no tienen importe pendiente" });
  }

  if (!lineasPago && importe <= 0) {
    return res.status(400).json({ error: "Indica un importe de pago válido" });
  }

  // Toleramos 1 céntimo de redondeo, pero no cobrar de más "de verdad":
  // un importe mayor que lo pendiente casi siempre es un error de tecleo.
  if (importe > pendiente + 0.01) {
    return res.status(400).json({
      error: `El importe (${importe.toFixed(2)}) supera lo pendiente (${pendiente.toFixed(2)})`,
    });
  }
  if (impresoraTicketId && importe < pendiente - 0.01) {
    return res.status(400).json({ error: "El ticket de pago se puede imprimir al liquidar toda la cuenta" });
  }
  if (empresaId && importe + pagado < total - 0.01) {
    return res.status(400).json({ error: "La factura de empresa se emite al liquidar el saldo pendiente de la cuenta" });
  }
  if (impresoraTicketId && total > 3000 && !empresaId) {
    return res.status(400).json({ error: "Una factura simplificada de hostelería no puede superar 3.000 €. Registra los datos del cliente para emitir una factura completa." });
  }

  // Si viene impresora de ticket, validamos que exista y sea del tipo correcto.
  if (impresoraTicketId) {
    const impresora = db
      .prepare(
        `SELECT tipo FROM puntos_destino WHERE id = ? AND restaurante_id = ?`
      )
      .get(impresoraTicketId, RESTAURANTE_ID) as { tipo: string } | undefined;
    if (!impresora) return res.status(404).json({ error: "Impresora de ticket no encontrada" });
    if (impresora.tipo !== "impresora_ticket") {
      return res
        .status(400)
        .json({ error: "El destino indicado no es una impresora de ticket" });
    }
  }

  const pagoId = uuid();
  const ahora = new Date().toISOString();
  let comandaCerrada = false;
  let factura: ReturnType<typeof emitirFactura> | null = null;
  let numeroSimplCompleto: string | null = null;

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO pagos (id, comanda_id, metodo, importe, propina, impresora_ticket_id, creado_en)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(pagoId, comanda.id, metodo, importe, propina, impresoraTicketId, ahora);

    if (lineasPago) {
      const insertarLineaPago = db.prepare(
        `INSERT INTO pago_lineas (pago_id, linea_id, cantidad) VALUES (?, ?, ?)`
      );
      for (const linea of lineasPago) insertarLineaPago.run(pagoId, linea.lineaId, linea.cantidad);
    }

    // Factura a empresa: se emite DENTRO de la transacción para que no pueda
    // quedar un pago sin su factura (ni una factura sin su pago).
    if (empresaId) {
      const lineas = lineasFacturables(comanda.id);
      factura = emitirFactura({
        empresaId,
        comandaId: comanda.id,
        pagoId,
        lineas,
        metodoPago: metodo,
      });
    }

    // Encolamos el ticket de caja para el worker (mismo mecanismo que las comandas).
    if (impresoraTicketId) {
      db.prepare(
        `INSERT INTO log_impresion (id, pago_id, punto_destino_id, estado, intentos, creado_en)
         VALUES (?, ?, ?, 'pendiente', 0, ?)`
      ).run(uuid(), pagoId, impresoraTicketId, ahora);
    }

    // ¿Comanda saldada? -> cerrar y liberar mesa.
    const nuevoPendiente = Number((total - (pagado + importe)).toFixed(2));
    if (nuevoPendiente <= 0.01) {
      // Solo se numera al emitir un documento al cliente al cerrar la cuenta:
      // los pagos parciales no son facturas independientes. Una factura
      // completa sustituye a la simplificada para evitar duplicar documentos.
      if (impresoraTicketId && !empresaId) {
        const serieSimpl = getAjuste("fiscal_serie_simplificada") || "SIM";
        const ejercicioSimpl = new Date().getFullYear();
        const ultimoSimpl = db.prepare(
          `SELECT COALESCE(MAX(numero_simpl), 0) AS n FROM pagos WHERE serie_simpl = ? AND ejercicio_simpl = ?`
        ).get(serieSimpl, ejercicioSimpl) as { n: number };
        const numeroSimpl = ultimoSimpl.n + 1;
        db.prepare(`UPDATE pagos SET serie_simpl = ?, numero_simpl = ?, ejercicio_simpl = ? WHERE id = ?`)
          .run(serieSimpl, numeroSimpl, ejercicioSimpl, pagoId);
        numeroSimplCompleto = `${serieSimpl}-${ejercicioSimpl}/${String(numeroSimpl).padStart(5, "0")}`;
      }
      db.prepare(`UPDATE comandas SET estado = 'cerrada', cerrado_en = ? WHERE id = ?`).run(
        ahora,
        comanda.id
      );
      if (comanda.mesa_id) {
        db.prepare(`UPDATE mesas SET estado = 'libre' WHERE id = ?`).run(comanda.mesa_id);
      }
      comandaCerrada = true;
    }
  });

  try {
    tx();
  } catch (err) {
    if (err instanceof ErrorFactura) return res.status(400).json({ error: err.message });
    throw err;
  }

  const io = req.app.get("io");
  io?.to(RESTAURANTE_ID).emit("pago:registrado", {
    comandaId: comanda.id,
    pagoId,
    importe,
    comandaCerrada,
  });
  io?.to(RESTAURANTE_ID).emit("comanda:actualizada", { comandaId: comanda.id });
  io?.to(RESTAURANTE_ID).emit("sala:actualizada");
  if (comandaCerrada && comanda.mesa_id) {
    io?.to(RESTAURANTE_ID).emit("mesa:liberada", { mesaId: comanda.mesa_id });
  }

  res.status(201).json({
    pagoId,
    comandaCerrada,
    pendiente: Number((total - (pagado + importe)).toFixed(2)),
    numeroSimplificada: numeroSimplCompleto,
    factura,
  });
});
