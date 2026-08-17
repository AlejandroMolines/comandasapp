import { Router } from "express";
import { v4 as uuid } from "uuid";
import { z } from "zod";
import { db } from "../../db/connection.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";

export const extrasRouter = Router();
const RESTAURANTE_ID = process.env.RESTAURANTE_ID ?? "restaurante-demo";

/**
 * Extras aplicables a un producto concreto. Devuelve:
 *   · todos los de ámbito 'general'
 *   · los vinculados directamente al producto
 *   · los vinculados a su categoría o a cualquier ANTECESOR de esa categoría
 *
 * Lo último es lo que hace el sistema usable: se cuelga "sin hielo" de la
 * categoría Bebidas y lo heredan Refrescos, Cervezas y todo lo que haya
 * debajo, sin configurar producto por producto.
 */
export function extrasDeProducto(productoId: string) {
  const prod = db
    .prepare(`SELECT categoria_id FROM productos WHERE id = ? AND restaurante_id = ?`)
    .get(productoId, RESTAURANTE_ID) as { categoria_id: string } | undefined;
  if (!prod) return null;

  // Cadena de categorías hacia arriba (con tope por si hubiera un ciclo).
  const cadena: string[] = [];
  let actual: string | null = prod.categoria_id;
  for (let i = 0; i < 20 && actual; i++) {
    cadena.push(actual);
    const padre = db
      .prepare(`SELECT categoria_padre_id FROM categorias WHERE id = ?`)
      .get(actual) as { categoria_padre_id: string | null } | undefined;
    actual = padre?.categoria_padre_id ?? null;
  }

  const marcas = cadena.map(() => "?").join(",") || "''";
  return db
    .prepare(
      `SELECT DISTINCT e.id, e.nombre, e.precio, e.ambito, e.grupo, e.orden
         FROM extras e
         LEFT JOIN extra_producto ep ON ep.extra_id = e.id
         LEFT JOIN extra_categoria ec ON ec.extra_id = e.id
        WHERE e.restaurante_id = ? AND e.activo = 1
          AND (
            e.ambito = 'general'
            OR ep.producto_id = ?
            OR ec.categoria_id IN (${marcas})
          )
        ORDER BY e.precio > 0, e.grupo, e.orden, e.nombre`
    )
    .all(RESTAURANTE_ID, productoId, ...cadena);
}

// ---------------------------------------------------------------------------
// Lectura: abierta a cualquier rol (el camarero los necesita al pedir)
// ---------------------------------------------------------------------------

extrasRouter.get("/", requireAuth, (_req, res) => {
  const extras = db
    .prepare(
      `SELECT * FROM extras WHERE restaurante_id = ? AND activo = 1
        ORDER BY ambito, grupo, orden, nombre`
    )
    .all(RESTAURANTE_ID) as Record<string, unknown>[];

  // Con qué está vinculado cada uno, para poder pintarlo en el panel.
  const vinculosProd = db
    .prepare(`SELECT extra_id, producto_id FROM extra_producto`)
    .all() as { extra_id: string; producto_id: string }[];
  const vinculosCat = db
    .prepare(`SELECT extra_id, categoria_id FROM extra_categoria`)
    .all() as { extra_id: string; categoria_id: string }[];

  res.json(
    extras.map((e) => ({
      ...e,
      productos: vinculosProd.filter((v) => v.extra_id === e.id).map((v) => v.producto_id),
      categorias: vinculosCat.filter((v) => v.extra_id === e.id).map((v) => v.categoria_id),
    }))
  );
});

/** Los extras que se pueden ofrecer para un producto concreto. */
extrasRouter.get("/producto/:productoId", requireAuth, (req, res) => {
  const extras = extrasDeProducto(req.params.productoId);
  if (extras === null) return res.status(404).json({ error: "Producto no encontrado" });
  res.json(extras);
});

// ---------------------------------------------------------------------------
// Escritura: solo admin
// ---------------------------------------------------------------------------

const extraSchema = z.object({
  nombre: z.string().min(1),
  precio: z.number().nonnegative().default(0),
  ambito: z.enum(["general", "especifico"]).default("especifico"),
  grupo: z.string().optional().nullable(),
  orden: z.number().int().default(0),
  productos: z.array(z.string()).optional().default([]),
  categorias: z.array(z.string()).optional().default([]),
});

extrasRouter.post("/", requireAuth, requireRole("admin"), (req, res) => {
  const parsed = extraSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());
  const d = parsed.data;

  if (d.ambito === "especifico" && d.productos.length === 0 && d.categorias.length === 0) {
    return res.status(400).json({
      error: "Un extra específico necesita al menos un producto o una categoría; si quieres que valga para todo, márcalo como general",
    });
  }

  const id = uuid();
  db.transaction(() => {
    db.prepare(
      `INSERT INTO extras (id, restaurante_id, nombre, precio, ambito, grupo, activo, orden, creado_en)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`
    ).run(id, RESTAURANTE_ID, d.nombre, d.precio, d.ambito, d.grupo ?? null, d.orden, new Date().toISOString());
    for (const p of d.productos) {
      db.prepare(`INSERT OR IGNORE INTO extra_producto (extra_id, producto_id) VALUES (?, ?)`).run(id, p);
    }
    for (const c of d.categorias) {
      db.prepare(`INSERT OR IGNORE INTO extra_categoria (extra_id, categoria_id) VALUES (?, ?)`).run(id, c);
    }
  })();

  res.status(201).json({ id, ...d });
});

extrasRouter.put("/:id", requireAuth, requireRole("admin"), (req, res) => {
  const parsed = extraSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());
  const d = parsed.data;

  const existe = db
    .prepare(`SELECT 1 FROM extras WHERE id = ? AND restaurante_id = ?`)
    .get(req.params.id, RESTAURANTE_ID);
  if (!existe) return res.status(404).json({ error: "Extra no encontrado" });

  db.transaction(() => {
    db.prepare(
      `UPDATE extras SET nombre = ?, precio = ?, ambito = ?, grupo = ?, orden = ? WHERE id = ?`
    ).run(d.nombre, d.precio, d.ambito, d.grupo ?? null, d.orden, req.params.id);
    // Se reescriben los vínculos: es más simple y predecible que diferenciar.
    db.prepare(`DELETE FROM extra_producto WHERE extra_id = ?`).run(req.params.id);
    db.prepare(`DELETE FROM extra_categoria WHERE extra_id = ?`).run(req.params.id);
    for (const p of d.productos) {
      db.prepare(`INSERT OR IGNORE INTO extra_producto (extra_id, producto_id) VALUES (?, ?)`).run(req.params.id, p);
    }
    for (const c of d.categorias) {
      db.prepare(`INSERT OR IGNORE INTO extra_categoria (extra_id, categoria_id) VALUES (?, ?)`).run(req.params.id, c);
    }
  })();

  res.json({ id: req.params.id, ...d });
});

/**
 * Baja lógica: las líneas ya servidas guardan el nombre y precio del extra
 * como snapshot, así que desactivarlo no rompe el histórico.
 */
extrasRouter.delete("/:id", requireAuth, requireRole("admin"), (req, res) => {
  const info = db
    .prepare(`UPDATE extras SET activo = 0 WHERE id = ? AND restaurante_id = ?`)
    .run(req.params.id, RESTAURANTE_ID);
  if (info.changes === 0) return res.status(404).json({ error: "Extra no encontrado" });
  res.status(204).end();
});
