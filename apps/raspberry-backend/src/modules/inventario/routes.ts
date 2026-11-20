import { Router } from "express";
import { v4 as uuid } from "uuid";
import { z } from "zod";
import { db } from "../../db/connection.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";

export const inventarioRouter = Router();
const RESTAURANTE_ID = process.env.RESTAURANTE_ID ?? "restaurante-demo";

inventarioRouter.get("/", requireAuth, requireRole("admin"), (_req, res) => {
  res.json(db.prepare(`SELECT * FROM inventario_items WHERE restaurante_id = ? AND activo = 1 ORDER BY nombre`).all(RESTAURANTE_ID));
});

inventarioRouter.get("/:id/movimientos", requireAuth, requireRole("admin"), (req, res) => {
  const item = db.prepare(`SELECT id FROM inventario_items WHERE id = ? AND restaurante_id = ?`).get(req.params.id, RESTAURANTE_ID);
  if (!item) return res.status(404).json({ error: "Artículo no encontrado" });
  const movimientos = db.prepare(`SELECT m.id, m.tipo, m.cantidad, m.motivo, m.creado_en, u.nombre AS usuario
    FROM inventario_movimientos m JOIN usuarios u ON u.id = m.usuario_id
    WHERE m.item_id = ? AND m.restaurante_id = ? ORDER BY m.creado_en DESC LIMIT 50`).all(req.params.id, RESTAURANTE_ID);
  res.json(movimientos);
});

inventarioRouter.post("/", requireAuth, requireRole("admin"), (req, res) => {
  const parsed = z.object({
    nombre: z.string().trim().min(1).max(100),
    unidad: z.string().trim().min(1).max(24),
    stockActual: z.number().finite().nonnegative().default(0),
    stockMinimo: z.number().finite().nonnegative().default(0),
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());
  const id = uuid();
  const creadoEn = new Date().toISOString();
  db.prepare(`INSERT INTO inventario_items (id, restaurante_id, nombre, unidad, stock_actual, stock_minimo, creado_en)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id, RESTAURANTE_ID, parsed.data.nombre, parsed.data.unidad, parsed.data.stockActual, parsed.data.stockMinimo, creadoEn);
  if (parsed.data.stockActual > 0) {
    db.prepare(`INSERT INTO inventario_movimientos (id, restaurante_id, item_id, usuario_id, tipo, cantidad, motivo, creado_en)
      VALUES (?, ?, ?, ?, 'entrada', ?, 'Stock inicial', ?)`).run(uuid(), RESTAURANTE_ID, id, req.auth!.usuarioId, parsed.data.stockActual, creadoEn);
  }
  res.status(201).json({ id, ...parsed.data, creado_en: creadoEn });
});

inventarioRouter.post("/:id/movimientos", requireAuth, requireRole("admin"), (req, res) => {
  const parsed = z.object({
    tipo: z.enum(["entrada", "salida"]),
    cantidad: z.number().finite().positive(),
    motivo: z.string().trim().min(3).max(200),
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());
  const item = db.prepare(`SELECT stock_actual FROM inventario_items WHERE id = ? AND restaurante_id = ? AND activo = 1`)
    .get(req.params.id, RESTAURANTE_ID) as { stock_actual: number } | undefined;
  if (!item) return res.status(404).json({ error: "Artículo no encontrado" });
  const siguiente = item.stock_actual + (parsed.data.tipo === "entrada" ? parsed.data.cantidad : -parsed.data.cantidad);
  if (siguiente < -0.000001) return res.status(409).json({ error: "La salida supera las existencias actuales" });
  const id = uuid();
  const creadoEn = new Date().toISOString();
  const tx = db.transaction(() => {
    db.prepare(`UPDATE inventario_items SET stock_actual = ? WHERE id = ? AND restaurante_id = ?`).run(Math.max(0, siguiente), req.params.id, RESTAURANTE_ID);
    db.prepare(`INSERT INTO inventario_movimientos (id, restaurante_id, item_id, usuario_id, tipo, cantidad, motivo, creado_en)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(id, RESTAURANTE_ID, req.params.id, req.auth!.usuarioId, parsed.data.tipo, parsed.data.cantidad, parsed.data.motivo, creadoEn);
  });
  tx();
  req.app.get("io")?.to(RESTAURANTE_ID).emit("inventario:actualizado", { itemId: req.params.id });
  res.status(201).json({ id, ...parsed.data, stockActual: Math.max(0, siguiente), creado_en: creadoEn });
});
