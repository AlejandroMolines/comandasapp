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

  res.json({ comandaId: comanda.id, ...resumenCuenta(comanda.id) });
});

const pagoSchema = z.object({
  metodo: z.enum(["efectivo", "tarjeta", "otro"]),
  importe: z.number().positive(),
  propina: z.number().nonnegative().default(0),
  // Qué caja imprime el ticket. Opcional: un pago parcial intermedio
  // puede registrarse sin imprimir nada.
  impresoraTicketId: z.string().nullable().optional().default(null),
  // Si viene una empresa, en vez de (o además de) el ticket simplificado se
  // emite una FACTURA COMPLETA a su nombre, con desglose de IVA.
  empresaId: z.string().nullable().optional().default(null),
});

pagosRouter.post("/comandas/:comandaId/pagos", requireAuth, (req, res) => {
  const parsed = pagoSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());
  const { metodo, importe, propina, impresoraTicketId, empresaId } = parsed.data;

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

  // Toleramos 1 céntimo de redondeo, pero no cobrar de más "de verdad":
  // un importe mayor que lo pendiente casi siempre es un error de tecleo.
  if (importe > pendiente + 0.01) {
    return res.status(400).json({
      error: `El importe (${importe.toFixed(2)}) supera lo pendiente (${pendiente.toFixed(2)})`,
    });
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
  let numeroSimpl = 0;
  let numeroSimplCompleto = "";

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO pagos (id, comanda_id, metodo, importe, propina, impresora_ticket_id, creado_en)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(pagoId, comanda.id, metodo, importe, propina, impresoraTicketId, ahora);

    // NUMERACIÓN DE FACTURA SIMPLIFICADA.
    // Todo ticket que se entrega al cliente es, legalmente, una factura
    // simplificada (RD 1619/2012) y necesita serie + número correlativo sin
    // saltos. Se numera aquí, dentro de la misma transacción que el pago,
    // usando una serie DISTINTA a la de las facturas completas para que las
    // dos numeraciones sean independientes y ninguna tenga huecos.
    const serieSimpl = getAjuste("fiscal_serie_simplificada") || "SIM";
    const ejercicioSimpl = new Date().getFullYear();
    const ultimoSimpl = db
      .prepare(
        `SELECT COALESCE(MAX(numero_simpl), 0) AS n FROM pagos
          WHERE serie_simpl = ? AND ejercicio_simpl = ?`
      )
      .get(serieSimpl, ejercicioSimpl) as { n: number };
    numeroSimpl = ultimoSimpl.n + 1;
    db.prepare(
      `UPDATE pagos SET serie_simpl = ?, numero_simpl = ?, ejercicio_simpl = ? WHERE id = ?`
    ).run(serieSimpl, numeroSimpl, ejercicioSimpl, pagoId);
    numeroSimplCompleto = `${serieSimpl}-${ejercicioSimpl}/${String(numeroSimpl).padStart(5, "0")}`;

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
