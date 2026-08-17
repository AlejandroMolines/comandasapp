import { Router } from "express";
import { v4 as uuid } from "uuid";
import { z } from "zod";
import { db } from "../../db/connection.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { resolverDestinoProducto } from "../comandas/service.js";

export const destinosRouter = Router();
const RESTAURANTE_ID = process.env.RESTAURANTE_ID ?? "restaurante-demo";

// ---------------------------------------------------------------------------
// PUNTOS DE DESTINO (impresoras / pantallas KDS / impresoras de ticket)
// ---------------------------------------------------------------------------

destinosRouter.get("/", requireAuth, (_req, res) => {
  const destinos = db
    .prepare(`SELECT * FROM puntos_destino WHERE restaurante_id = ?`)
    .all(RESTAURANTE_ID) as Array<Record<string, unknown>>;
  // config se guarda como JSON string; lo devolvemos parseado.
  res.json(destinos.map((d) => ({ ...d, config: JSON.parse(String(d.config ?? "{}")) })));
});

// Cada protocolo exige su config concreta — validado con un discriminated union,
// así una impresora de red sin IP no puede ni crearse.
const configPorProtocolo = z.discriminatedUnion("protocolo", [
  z.object({
    protocolo: z.literal("escpos_red"),
    config: z.object({ ip: z.string().min(1), puerto: z.number().int().default(9100) }),
  }),
  z.object({
    protocolo: z.literal("escpos_usb"),
    config: z.object({ rutaDispositivo: z.string().min(1) }),
  }),
  z.object({
    protocolo: z.literal("websocket_kds"),
    config: z.object({ canal: z.string().min(1) }),
  }),
  z.object({
    protocolo: z.literal("api_generica"),
    config: z.object({ url: z.string().url() }),
  }),
]);

const destinoBaseSchema = z.object({
  nombre: z.string().min(1),
  tipo: z.enum(["impresora_termica", "pantalla_kds", "impresora_ticket"]),
});

destinosRouter.post("/", requireAuth, requireRole("admin"), (req, res) => {
  const base = destinoBaseSchema.safeParse(req.body);
  if (!base.success) return res.status(400).json(base.error.flatten());
  const proto = configPorProtocolo.safeParse(req.body);
  if (!proto.success) return res.status(400).json(proto.error.flatten());

  const id = uuid();
  db.prepare(
    `INSERT INTO puntos_destino (id, restaurante_id, nombre, tipo, protocolo, config, estado_salud)
     VALUES (?, ?, ?, ?, ?, ?, 'desconocido')`
  ).run(
    id,
    RESTAURANTE_ID,
    base.data.nombre,
    base.data.tipo,
    proto.data.protocolo,
    JSON.stringify(proto.data.config)
  );
  res.status(201).json({ id, ...base.data, protocolo: proto.data.protocolo, config: proto.data.config });
});

destinosRouter.put("/:id", requireAuth, requireRole("admin"), (req, res) => {
  const existente = db
    .prepare(`SELECT * FROM puntos_destino WHERE id = ? AND restaurante_id = ?`)
    .get(req.params.id, RESTAURANTE_ID) as Record<string, unknown> | undefined;
  if (!existente) return res.status(404).json({ error: "Punto de destino no encontrado" });

  const base = destinoBaseSchema.partial().safeParse(req.body);
  if (!base.success) return res.status(400).json(base.error.flatten());

  // Si cambia el protocolo (o la config), se valida el par completo.
  let protocolo = existente.protocolo as string;
  let config = String(existente.config ?? "{}");
  if (req.body.protocolo !== undefined || req.body.config !== undefined) {
    const proto = configPorProtocolo.safeParse({
      protocolo: req.body.protocolo ?? existente.protocolo,
      config: req.body.config ?? JSON.parse(config),
    });
    if (!proto.success) return res.status(400).json(proto.error.flatten());
    protocolo = proto.data.protocolo;
    config = JSON.stringify(proto.data.config);
  }

  db.prepare(
    `UPDATE puntos_destino SET nombre = ?, tipo = ?, protocolo = ?, config = ? WHERE id = ?`
  ).run(
    base.data.nombre ?? existente.nombre,
    base.data.tipo ?? existente.tipo,
    protocolo,
    config,
    req.params.id
  );
  res.json({ id: req.params.id });
});

// Borrar un destino que aún tiene productos/categorías apuntándole dejaría
// líneas sin sitio al que imprimirse: lo bloqueamos con aviso claro.
destinosRouter.delete("/:id", requireAuth, requireRole("admin"), (req, res) => {
  const enUsoProducto = db
    .prepare(`SELECT 1 FROM producto_destino WHERE punto_destino_id = ? LIMIT 1`)
    .get(req.params.id);
  const enUsoCategoria = db
    .prepare(`SELECT 1 FROM categoria_destino WHERE punto_destino_id = ? LIMIT 1`)
    .get(req.params.id);
  if (enUsoProducto || enUsoCategoria) {
    return res.status(409).json({
      error:
        "Hay productos o categorías que envían a este destino; reasígnalos antes de borrarlo",
    });
  }
  const info = db
    .prepare(`DELETE FROM puntos_destino WHERE id = ? AND restaurante_id = ?`)
    .run(req.params.id, RESTAURANTE_ID);
  if (info.changes === 0) return res.status(404).json({ error: "Punto de destino no encontrado" });
  res.status(204).end();
});

// ---------------------------------------------------------------------------
// MAPEOS producto→destino y categoría→destino
// ---------------------------------------------------------------------------

const asignacionSchema = z.object({ puntoDestinoId: z.string() });

/**
 * Comprueba que el destino existe Y que puede recibir COMANDAS.
 *
 * Las impresoras de tipo `impresora_ticket` son la caja: solo imprimen el
 * comprobante de pago del cliente. Enrutar productos ahí sería un error grave
 * y silencioso — la comanda no llegaría a cocina y saldría un papel absurdo
 * por la caja mientras el cocinero espera. Se rechaza al configurar, que es
 * cuando se puede corregir, en lugar de dejarlo fallar en plena hora punta.
 */
function destinoValidoParaComandas(id: string): { ok: true } | { ok: false; error: string } {
  const d = db
    .prepare(`SELECT nombre, tipo FROM puntos_destino WHERE id = ? AND restaurante_id = ?`)
    .get(id, RESTAURANTE_ID) as { nombre: string; tipo: string } | undefined;

  if (!d) return { ok: false, error: "Punto de destino no encontrado" };

  if (d.tipo === "impresora_ticket") {
    return {
      ok: false,
      error: `"${d.nombre}" es una impresora de tickets de caja: solo imprime los comprobantes de pago, no comandas. Asigna los productos a una impresora de cocina/barra o a una pantalla.`,
    };
  }
  return { ok: true };
}

// Asignar destino a una categoría (todas las Bebidas → Barra).
destinosRouter.post(
  "/categorias/:categoriaId/asignar",
  requireAuth,
  requireRole("admin"),
  (req, res) => {
    const parsed = asignacionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json(parsed.error.flatten());
    const valido = destinoValidoParaComandas(parsed.data.puntoDestinoId);
    if (!valido.ok) {
      return res.status(valido.error.includes("no encontrado") ? 404 : 400).json({ error: valido.error });
    }
    const categoria = db
      .prepare(`SELECT 1 FROM categorias WHERE id = ? AND restaurante_id = ?`)
      .get(req.params.categoriaId, RESTAURANTE_ID);
    if (!categoria) return res.status(404).json({ error: "Categoría no encontrada" });

    db.prepare(
      `INSERT OR IGNORE INTO categoria_destino (categoria_id, punto_destino_id) VALUES (?, ?)`
    ).run(req.params.categoriaId, parsed.data.puntoDestinoId);
    res.status(201).json({ categoriaId: req.params.categoriaId, ...parsed.data });
  }
);

destinosRouter.delete(
  "/categorias/:categoriaId/asignar/:puntoDestinoId",
  requireAuth,
  requireRole("admin"),
  (req, res) => {
    db.prepare(
      `DELETE FROM categoria_destino WHERE categoria_id = ? AND punto_destino_id = ?`
    ).run(req.params.categoriaId, req.params.puntoDestinoId);
    res.status(204).end();
  }
);

// Asignar destino a un producto concreto (override sobre su categoría).
destinosRouter.post(
  "/productos/:productoId/asignar",
  requireAuth,
  requireRole("admin"),
  (req, res) => {
    const parsed = asignacionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json(parsed.error.flatten());
    const valido = destinoValidoParaComandas(parsed.data.puntoDestinoId);
    if (!valido.ok) {
      return res.status(valido.error.includes("no encontrado") ? 404 : 400).json({ error: valido.error });
    }
    const producto = db
      .prepare(`SELECT 1 FROM productos WHERE id = ? AND restaurante_id = ?`)
      .get(req.params.productoId, RESTAURANTE_ID);
    if (!producto) return res.status(404).json({ error: "Producto no encontrado" });

    db.prepare(
      `INSERT OR IGNORE INTO producto_destino (producto_id, punto_destino_id) VALUES (?, ?)`
    ).run(req.params.productoId, parsed.data.puntoDestinoId);
    res.status(201).json({ productoId: req.params.productoId, ...parsed.data });
  }
);

destinosRouter.delete(
  "/productos/:productoId/asignar/:puntoDestinoId",
  requireAuth,
  requireRole("admin"),
  (req, res) => {
    db.prepare(
      `DELETE FROM producto_destino WHERE producto_id = ? AND punto_destino_id = ?`
    ).run(req.params.productoId, req.params.puntoDestinoId);
    res.status(204).end();
  }
);

// ---------------------------------------------------------------------------
// AUDITORÍA: productos sin destino resoluble
// ---------------------------------------------------------------------------

// Incidencias de impresión sin resolver + reintento manual desde el panel.
destinosRouter.get("/incidencias", requireAuth, requireRole("admin"), (_req, res) => {
  const incidencias = db
    .prepare(
      `SELECT li.id, li.ronda_id, li.pago_id, li.ultimo_error, li.ultimo_intento_en,
              pd.nombre AS destino
         FROM log_impresion li
         JOIN puntos_destino pd ON pd.id = li.punto_destino_id
        WHERE li.estado = 'error_definitivo'
        ORDER BY li.creado_en DESC LIMIT 50`
    )
    .all();
  res.json(incidencias);
});

// "Reintentar ahora": devuelve el ticket a la cola; el worker lo recoge en <2s.
destinosRouter.post("/incidencias/:logId/reintentar", requireAuth, (req, res) => {
  const info = db
    .prepare(
      `UPDATE log_impresion SET estado = 'pendiente', intentos = 0, ultimo_error = NULL
        WHERE id = ? AND estado = 'error_definitivo'`
    )
    .run(req.params.logId);
  if (info.changes === 0) return res.status(404).json({ error: "Incidencia no encontrada" });
  res.json({ id: req.params.logId, estado: "pendiente" });
});

// El panel del admin puede mostrar de un vistazo qué productos quedarían
// "huérfanos" al enviarse (ni destino propio, ni por categoría, ni heredado).
/**
 * Mapa de enrutado: qué impresora tiene asignada cada categoría y cada
 * producto, y qué impresora acaba RESOLVIENDO cada producto tras aplicar la
 * herencia. Es lo que permite ver en la carta si un producto imprime por
 * herencia de su categoría o por asignación propia.
 */
destinosRouter.get("/mapa", requireAuth, requireRole("admin"), (_req, res) => {
  const destinos = db
    .prepare(`SELECT id, nombre, tipo FROM puntos_destino WHERE restaurante_id = ?`)
    .all(RESTAURANTE_ID) as { id: string; nombre: string; tipo: string }[];
  const nombre = (id: string | null) => destinos.find((d) => d.id === id)?.nombre ?? null;

  const porCategoria = db
    .prepare(`SELECT categoria_id, punto_destino_id FROM categoria_destino`)
    .all() as { categoria_id: string; punto_destino_id: string }[];
  const porProducto = db
    .prepare(`SELECT producto_id, punto_destino_id FROM producto_destino`)
    .all() as { producto_id: string; punto_destino_id: string }[];

  const productos = db
    .prepare(`SELECT id FROM productos WHERE restaurante_id = ?`)
    .all(RESTAURANTE_ID) as { id: string }[];

  res.json({
    categorias: Object.fromEntries(
      porCategoria.map((c) => [c.categoria_id, nombre(c.punto_destino_id)])
    ),
    productos: Object.fromEntries(
      productos.map((p) => {
        const propio = porProducto.find((x) => x.producto_id === p.id);
        const resuelto = resolverDestinoProducto(p.id);
        return [
          p.id,
          {
            propio: propio ? nombre(propio.punto_destino_id) : null,
            resuelto: nombre(resuelto),
            // true = imprime porque lo hereda de su categoría, no por
            // asignación propia. Útil para explicarlo en la interfaz.
            heredado: !propio && resuelto !== null,
          },
        ];
      })
    ),
  });
});

destinosRouter.get("/sin-destino", requireAuth, requireRole("admin"), (_req, res) => {
  const productos = db
    .prepare(`SELECT id, nombre FROM productos WHERE restaurante_id = ? AND disponible = 1`)
    .all(RESTAURANTE_ID) as Array<{ id: string; nombre: string }>;

  const sinDestino = productos.filter((p) => resolverDestinoProducto(p.id) === null);
  res.json(sinDestino);
});
