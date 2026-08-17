import { Router } from "express";
import { v4 as uuid } from "uuid";
import { z } from "zod";
import { db } from "../../db/connection.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";

export const espaciosRouter = Router();
const RESTAURANTE_ID = process.env.RESTAURANTE_ID ?? "restaurante-demo";

espaciosRouter.get("/zonas", requireAuth, (_req, res) => {
  const zonas = db
    .prepare(`SELECT * FROM zonas WHERE restaurante_id = ? ORDER BY orden`)
    .all(RESTAURANTE_ID);
  res.json(zonas);
});

const zonaSchema = z.object({ nombre: z.string().min(1), orden: z.number().default(0) });

espaciosRouter.post("/zonas", requireAuth, requireRole("admin"), (req, res) => {
  const parsed = zonaSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());
  const id = uuid();
  db.prepare(`INSERT INTO zonas (id, restaurante_id, nombre, orden) VALUES (?, ?, ?, ?)`).run(
    id,
    RESTAURANTE_ID,
    parsed.data.nombre,
    parsed.data.orden
  );
  res.status(201).json({ id, ...parsed.data });
});

espaciosRouter.put("/zonas/:id", requireAuth, requireRole("admin"), (req, res) => {
  const parsed = zonaSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());
  const existente = db
    .prepare(`SELECT * FROM zonas WHERE id = ? AND restaurante_id = ?`)
    .get(req.params.id, RESTAURANTE_ID) as Record<string, unknown> | undefined;
  if (!existente) return res.status(404).json({ error: "Zona no encontrada" });
  db.prepare(`UPDATE zonas SET nombre = ?, orden = ? WHERE id = ?`).run(
    parsed.data.nombre ?? existente.nombre,
    parsed.data.orden ?? existente.orden,
    req.params.id
  );
  res.json({ id: req.params.id });
});

espaciosRouter.delete("/zonas/:id", requireAuth, requireRole("admin"), (req, res) => {
  const tieneMesas = db.prepare(`SELECT 1 FROM mesas WHERE zona_id = ? LIMIT 1`).get(req.params.id);
  if (tieneMesas) {
    return res.status(409).json({ error: "La zona tiene mesas; muévelas o elimínalas antes" });
  }
  const info = db
    .prepare(`DELETE FROM zonas WHERE id = ? AND restaurante_id = ?`)
    .run(req.params.id, RESTAURANTE_ID);
  if (info.changes === 0) return res.status(404).json({ error: "Zona no encontrada" });
  res.status(204).end();
});

espaciosRouter.get("/mesas", requireAuth, (_req, res) => {
  const mesas = db
    .prepare(`SELECT * FROM mesas WHERE restaurante_id = ?`)
    .all(RESTAURANTE_ID);
  res.json(mesas);
});

const mesaSchema = z.object({
  zonaId: z.string(),
  nombre: z.string().min(1),
  capacidad: z.number().default(4),
});

espaciosRouter.post("/mesas", requireAuth, requireRole("admin"), (req, res) => {
  const parsed = mesaSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());
  const id = uuid();
  db.prepare(
    `INSERT INTO mesas (id, restaurante_id, zona_id, nombre, capacidad, estado)
     VALUES (?, ?, ?, ?, ?, 'libre')`
  ).run(id, RESTAURANTE_ID, parsed.data.zonaId, parsed.data.nombre, parsed.data.capacidad);
  res.status(201).json({ id, ...parsed.data, estado: "libre" });
});

// Creación EN LOTE: prefijo opcional + cantidad. Ej: prefijo "T", cantidad 12
// -> T1..T12. Sin prefijo -> 1..12. Salta las que ya existan con ese nombre.
const mesasLoteSchema = z.object({
  zonaId: z.string(),
  prefijo: z.string().max(4).optional().default(""),
  cantidad: z.number().int().min(1).max(200),
  desde: z.number().int().min(1).optional().default(1),
  capacidad: z.number().int().min(1).default(4),
});

espaciosRouter.post("/mesas/lote", requireAuth, requireRole("admin"), (req, res) => {
  const parsed = mesasLoteSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());
  const { zonaId, prefijo, cantidad, desde, capacidad } = parsed.data;

  const zona = db
    .prepare(`SELECT 1 FROM zonas WHERE id = ? AND restaurante_id = ?`)
    .get(zonaId, RESTAURANTE_ID);
  if (!zona) return res.status(404).json({ error: "La zona no existe" });

  // La unicidad es POR ZONA: puede haber una mesa "1" en Sala y otra "1" en
  // Terraza; se distinguen por la zona a la que pertenecen.
  const existentes = new Set(
    (db.prepare(`SELECT nombre FROM mesas WHERE zona_id = ?`).all(zonaId) as {
      nombre: string;
    }[]).map((m) => m.nombre)
  );

  const insert = db.prepare(
    `INSERT INTO mesas (id, restaurante_id, zona_id, nombre, capacidad, estado)
     VALUES (?, ?, ?, ?, ?, 'libre')`
  );
  const creadas: string[] = [];
  const omitidas: string[] = [];

  db.transaction(() => {
    for (let i = 0; i < cantidad; i++) {
      const nombre = `${prefijo}${desde + i}`;
      if (existentes.has(nombre)) {
        omitidas.push(nombre);
        continue;
      }
      insert.run(uuid(), RESTAURANTE_ID, zonaId, nombre, capacidad);
      creadas.push(nombre);
    }
  })();

  res.status(201).json({ creadas, omitidas });
});

espaciosRouter.put("/mesas/:id", requireAuth, requireRole("admin"), (req, res) => {
  const parsed = mesaSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());
  const existente = db
    .prepare(`SELECT * FROM mesas WHERE id = ? AND restaurante_id = ?`)
    .get(req.params.id, RESTAURANTE_ID) as Record<string, unknown> | undefined;
  if (!existente) return res.status(404).json({ error: "Mesa no encontrada" });
  db.prepare(`UPDATE mesas SET zona_id = ?, nombre = ?, capacidad = ? WHERE id = ?`).run(
    parsed.data.zonaId ?? existente.zona_id,
    parsed.data.nombre ?? existente.nombre,
    parsed.data.capacidad ?? existente.capacidad,
    req.params.id
  );
  res.json({ id: req.params.id });
});

espaciosRouter.delete("/mesas/:id", requireAuth, requireRole("admin"), (req, res) => {
  const enUso = db
    .prepare(`SELECT 1 FROM comandas WHERE mesa_id = ? AND estado NOT IN ('cerrada','cancelada') LIMIT 1`)
    .get(req.params.id);
  if (enUso) return res.status(409).json({ error: "La mesa tiene una comanda abierta" });
  const historico = db
    .prepare(`SELECT 1 FROM comandas WHERE mesa_id = ? LIMIT 1`)
    .get(req.params.id);
  if (historico) {
    return res.status(409).json({
      error: "La mesa aparece en comandas históricas; renómbrala en lugar de borrarla",
    });
  }
  const info = db
    .prepare(`DELETE FROM mesas WHERE id = ? AND restaurante_id = ?`)
    .run(req.params.id, RESTAURANTE_ID);
  if (info.changes === 0) return res.status(404).json({ error: "Mesa no encontrada" });
  res.status(204).end();
});
