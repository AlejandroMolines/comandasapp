import { Router } from "express";
import { v4 as uuid } from "uuid";
import { z } from "zod";
import { db } from "../../db/connection.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";

export const cartaRouter = Router();
const RESTAURANTE_ID = process.env.RESTAURANTE_ID ?? "restaurante-demo";

// ---------------------------------------------------------------------------
// MENÚS
// ---------------------------------------------------------------------------

// Lectura: cualquier usuario autenticado (el camarero necesita ver la carta).
cartaRouter.get("/menus", requireAuth, (_req, res) => {
  const menus = db
    .prepare(`SELECT * FROM menus WHERE restaurante_id = ? ORDER BY orden`)
    .all(RESTAURANTE_ID);
  res.json(menus);
});

const menuSchema = z.object({
  nombre: z.string().min(1),
  orden: z.number().int().default(0),
  activo: z.boolean().default(true),
});

cartaRouter.post("/menus", requireAuth, requireRole("admin"), (req, res) => {
  const parsed = menuSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());
  const id = uuid();
  db.prepare(
    `INSERT INTO menus (id, restaurante_id, nombre, orden, activo) VALUES (?, ?, ?, ?, ?)`
  ).run(id, RESTAURANTE_ID, parsed.data.nombre, parsed.data.orden, parsed.data.activo ? 1 : 0);
  res.status(201).json({ id, ...parsed.data });
});

cartaRouter.put("/menus/:id", requireAuth, requireRole("admin"), (req, res) => {
  const parsed = menuSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());
  const existente = db
    .prepare(`SELECT * FROM menus WHERE id = ? AND restaurante_id = ?`)
    .get(req.params.id, RESTAURANTE_ID) as Record<string, unknown> | undefined;
  if (!existente) return res.status(404).json({ error: "Menú no encontrado" });

  const d = parsed.data;
  db.prepare(`UPDATE menus SET nombre = ?, orden = ?, activo = ? WHERE id = ?`).run(
    d.nombre ?? existente.nombre,
    d.orden ?? existente.orden,
    d.activo === undefined ? existente.activo : d.activo ? 1 : 0,
    req.params.id
  );
  res.json({ id: req.params.id, ...d });
});

// Borrado con protección: no permitimos borrar un menú que aún tiene categorías
// (obligamos a vaciarlo antes) para que nadie destroce la carta por accidente.
cartaRouter.delete("/menus/:id", requireAuth, requireRole("admin"), (req, res) => {
  const tieneCategorias = db
    .prepare(`SELECT 1 FROM categorias WHERE menu_id = ? LIMIT 1`)
    .get(req.params.id);
  if (tieneCategorias) {
    return res
      .status(409)
      .json({ error: "El menú tiene categorías; elimínalas o muévelas antes de borrarlo" });
  }
  const info = db
    .prepare(`DELETE FROM menus WHERE id = ? AND restaurante_id = ?`)
    .run(req.params.id, RESTAURANTE_ID);
  if (info.changes === 0) return res.status(404).json({ error: "Menú no encontrado" });
  res.status(204).end();
});

// ---------------------------------------------------------------------------
// CATEGORÍAS
// ---------------------------------------------------------------------------

// Devuelve las categorías de un menú. La PWA puede montar el árbol
// con categoria_padre_id (aquí las damos planas, ordenadas).
cartaRouter.get("/menus/:menuId/categorias", requireAuth, (req, res) => {
  const categorias = db
    .prepare(
      `SELECT * FROM categorias WHERE menu_id = ? AND restaurante_id = ? ORDER BY orden`
    )
    .all(req.params.menuId, RESTAURANTE_ID);
  res.json(categorias);
});

const categoriaSchema = z.object({
  menuId: z.string(),
  categoriaPadreId: z.string().nullable().default(null),
  nombre: z.string().min(1),
  orden: z.number().int().default(0),
});

cartaRouter.post("/categorias", requireAuth, requireRole("admin"), (req, res) => {
  const parsed = categoriaSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());
  const { menuId, categoriaPadreId, nombre, orden } = parsed.data;

  const menu = db
    .prepare(`SELECT 1 FROM menus WHERE id = ? AND restaurante_id = ?`)
    .get(menuId, RESTAURANTE_ID);
  if (!menu) return res.status(404).json({ error: "El menú no existe" });

  if (categoriaPadreId) {
    const padre = db
      .prepare(`SELECT menu_id FROM categorias WHERE id = ?`)
      .get(categoriaPadreId) as { menu_id: string } | undefined;
    if (!padre) return res.status(404).json({ error: "La categoría padre no existe" });
    if (padre.menu_id !== menuId) {
      return res
        .status(400)
        .json({ error: "La categoría padre pertenece a otro menú" });
    }
  }

  const id = uuid();
  db.prepare(
    `INSERT INTO categorias (id, restaurante_id, menu_id, categoria_padre_id, nombre, orden)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, RESTAURANTE_ID, menuId, categoriaPadreId, nombre, orden);
  res.status(201).json({ id, ...parsed.data });
});

const categoriaUpdateSchema = z.object({
  categoriaPadreId: z.string().nullable().optional(),
  nombre: z.string().min(1).optional(),
  orden: z.number().int().optional(),
});

/**
 * Comprueba si moviendo `categoriaId` bajo `nuevoPadreId` se crearía un ciclo
 * (una categoría no puede acabar siendo descendiente de sí misma).
 */
function crearíaCiclo(categoriaId: string, nuevoPadreId: string): boolean {
  let actual: string | null = nuevoPadreId;
  while (actual) {
    if (actual === categoriaId) return true;
    const fila = db
      .prepare(`SELECT categoria_padre_id FROM categorias WHERE id = ?`)
      .get(actual) as { categoria_padre_id: string | null } | undefined;
    actual = fila?.categoria_padre_id ?? null;
  }
  return false;
}

cartaRouter.put("/categorias/:id", requireAuth, requireRole("admin"), (req, res) => {
  const parsed = categoriaUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());
  const existente = db
    .prepare(`SELECT * FROM categorias WHERE id = ? AND restaurante_id = ?`)
    .get(req.params.id, RESTAURANTE_ID) as Record<string, unknown> | undefined;
  if (!existente) return res.status(404).json({ error: "Categoría no encontrada" });

  const d = parsed.data;

  if (d.categoriaPadreId) {
    if (d.categoriaPadreId === req.params.id) {
      return res.status(400).json({ error: "Una categoría no puede ser su propio padre" });
    }
    const padre = db
      .prepare(`SELECT menu_id FROM categorias WHERE id = ?`)
      .get(d.categoriaPadreId) as { menu_id: string } | undefined;
    if (!padre) return res.status(404).json({ error: "La categoría padre no existe" });
    if (padre.menu_id !== existente.menu_id) {
      return res.status(400).json({ error: "La categoría padre pertenece a otro menú" });
    }
    if (crearíaCiclo(req.params.id, d.categoriaPadreId)) {
      return res
        .status(400)
        .json({ error: "Movimiento inválido: crearía un ciclo en el árbol de categorías" });
    }
  }

  db.prepare(
    `UPDATE categorias SET categoria_padre_id = ?, nombre = ?, orden = ? WHERE id = ?`
  ).run(
    d.categoriaPadreId === undefined ? existente.categoria_padre_id : d.categoriaPadreId,
    d.nombre ?? existente.nombre,
    d.orden ?? existente.orden,
    req.params.id
  );
  res.json({ id: req.params.id, ...d });
});

cartaRouter.delete("/categorias/:id", requireAuth, requireRole("admin"), (req, res) => {
  const tieneHijas = db
    .prepare(`SELECT 1 FROM categorias WHERE categoria_padre_id = ? LIMIT 1`)
    .get(req.params.id);
  if (tieneHijas) {
    return res
      .status(409)
      .json({ error: "La categoría tiene subcategorías; elimínalas o muévelas antes" });
  }
  const tieneProductos = db
    .prepare(`SELECT 1 FROM productos WHERE categoria_id = ? LIMIT 1`)
    .get(req.params.id);
  if (tieneProductos) {
    return res
      .status(409)
      .json({ error: "La categoría tiene productos; elimínalos o muévelos antes" });
  }
  // Limpieza del mapeo de destinos asociado a esta categoría.
  db.prepare(`DELETE FROM categoria_destino WHERE categoria_id = ?`).run(req.params.id);
  const info = db
    .prepare(`DELETE FROM categorias WHERE id = ? AND restaurante_id = ?`)
    .run(req.params.id, RESTAURANTE_ID);
  if (info.changes === 0) return res.status(404).json({ error: "Categoría no encontrada" });
  res.status(204).end();
});

// ---------------------------------------------------------------------------
// PRODUCTOS
// ---------------------------------------------------------------------------

cartaRouter.get("/categorias/:categoriaId/productos", requireAuth, (req, res) => {
  const productos = db
    .prepare(
      `SELECT * FROM productos WHERE categoria_id = ? AND restaurante_id = ? ORDER BY orden`
    )
    .all(req.params.categoriaId, RESTAURANTE_ID);
  res.json(productos);
});

// La PWA del camarero necesita la carta entera de una vez para cachearla
// offline en IndexedDB: menús + categorías + productos en una sola llamada.
cartaRouter.get("/completa", requireAuth, (_req, res) => {
  const menus = db
    .prepare(`SELECT * FROM menus WHERE restaurante_id = ? AND activo = 1 ORDER BY orden`)
    .all(RESTAURANTE_ID);
  const categorias = db
    .prepare(`SELECT * FROM categorias WHERE restaurante_id = ? ORDER BY orden`)
    .all(RESTAURANTE_ID);
  const productos = db
    .prepare(`SELECT * FROM productos WHERE restaurante_id = ? ORDER BY orden`)
    .all(RESTAURANTE_ID);
  res.json({ menus, categorias, productos });
});

const productoSchema = z.object({
  categoriaId: z.string(),
  nombre: z.string().min(1),
  precio: z.number().nonnegative(),
  descripcion: z.string().nullable().default(null),
  disponible: z.boolean().default(true),
  orden: z.number().int().default(0),
  // IVA: 10% comida y refrescos, 21% alcohol. Necesario para el desglose
  // legal de las facturas a empresa.
  tipoIva: z.number().refine((v) => [0, 4, 10, 21].includes(v), "Tipo de IVA no válido").default(10),
});

cartaRouter.post("/productos", requireAuth, requireRole("admin"), (req, res) => {
  const parsed = productoSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());
  const { categoriaId, nombre, precio, descripcion, disponible, orden, tipoIva } = parsed.data;

  const categoria = db
    .prepare(`SELECT 1 FROM categorias WHERE id = ? AND restaurante_id = ?`)
    .get(categoriaId, RESTAURANTE_ID);
  if (!categoria) return res.status(404).json({ error: "La categoría no existe" });

  const id = uuid();
  db.prepare(
    `INSERT INTO productos (id, restaurante_id, categoria_id, nombre, precio, descripcion, disponible, orden, tipo_iva)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, RESTAURANTE_ID, categoriaId, nombre, precio, descripcion, disponible ? 1 : 0, orden, tipoIva);
  res.status(201).json({ id, ...parsed.data });
});

cartaRouter.put("/productos/:id", requireAuth, requireRole("admin"), (req, res) => {
  const parsed = productoSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());
  const existente = db
    .prepare(`SELECT * FROM productos WHERE id = ? AND restaurante_id = ?`)
    .get(req.params.id, RESTAURANTE_ID) as Record<string, unknown> | undefined;
  if (!existente) return res.status(404).json({ error: "Producto no encontrado" });

  const d = parsed.data;
  if (d.categoriaId) {
    const categoria = db
      .prepare(`SELECT 1 FROM categorias WHERE id = ? AND restaurante_id = ?`)
      .get(d.categoriaId, RESTAURANTE_ID);
    if (!categoria) return res.status(404).json({ error: "La categoría destino no existe" });
  }

  db.prepare(
    `UPDATE productos SET categoria_id = ?, nombre = ?, precio = ?, descripcion = ?, disponible = ?, orden = ?, tipo_iva = ? WHERE id = ?`
  ).run(
    d.categoriaId ?? existente.categoria_id,
    d.nombre ?? existente.nombre,
    d.precio ?? existente.precio,
    d.descripcion === undefined ? existente.descripcion : d.descripcion,
    d.disponible === undefined ? existente.disponible : d.disponible ? 1 : 0,
    d.orden ?? existente.orden,
    d.tipoIva ?? existente.tipo_iva,
    req.params.id
  );
  res.json({ id: req.params.id, ...d });
});

// Marcar agotado/disponible: acción rápida separada del PUT completo porque
// la usa también el CAMARERO desde el móvil en pleno servicio (no solo admin).
cartaRouter.patch("/productos/:id/disponibilidad", requireAuth, (req, res) => {
  const parsed = z.object({ disponible: z.boolean() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());

  const info = db
    .prepare(`UPDATE productos SET disponible = ? WHERE id = ? AND restaurante_id = ?`)
    .run(parsed.data.disponible ? 1 : 0, req.params.id, RESTAURANTE_ID);
  if (info.changes === 0) return res.status(404).json({ error: "Producto no encontrado" });

  // Avisar en tiempo real a todos los dispositivos: si se agotó un plato,
  // los demás camareros deben verlo al instante para no seguir vendiéndolo.
  const io = req.app.get("io");
  io?.to(RESTAURANTE_ID).emit("producto:disponibilidad", {
    productoId: req.params.id,
    disponible: parsed.data.disponible,
  });

  res.json({ id: req.params.id, disponible: parsed.data.disponible });
});

// Borrado de producto: si ya aparece en comandas históricas NO se borra
// físicamente (perderíamos el histórico de ventas); se desactiva.
cartaRouter.delete("/productos/:id", requireAuth, requireRole("admin"), (req, res) => {
  const usadoEnComandas = db
    .prepare(`SELECT 1 FROM lineas_comanda WHERE producto_id = ? LIMIT 1`)
    .get(req.params.id);

  if (usadoEnComandas) {
    db.prepare(`UPDATE productos SET disponible = 0 WHERE id = ? AND restaurante_id = ?`).run(
      req.params.id,
      RESTAURANTE_ID
    );
    return res.json({
      id: req.params.id,
      borrado: false,
      desactivado: true,
      mensaje:
        "El producto aparece en comandas históricas: se ha desactivado en lugar de borrarse",
    });
  }

  db.prepare(`DELETE FROM producto_destino WHERE producto_id = ?`).run(req.params.id);
  const info = db
    .prepare(`DELETE FROM productos WHERE id = ? AND restaurante_id = ?`)
    .run(req.params.id, RESTAURANTE_ID);
  if (info.changes === 0) return res.status(404).json({ error: "Producto no encontrado" });
  res.status(204).end();
});
