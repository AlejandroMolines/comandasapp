import { Router } from "express";
import { v4 as uuid } from "uuid";
import { z } from "zod";
import { db } from "../../db/connection.js";
import { requireAuth } from "../../middleware/auth.js";
import { crearRonda } from "./service.js";

export const comandasRouter = Router();
const RESTAURANTE_ID = process.env.RESTAURANTE_ID ?? "restaurante-demo";

const abrirComandaSchema = z.object({
  id: z.string().uuid().optional(), // permite que el cliente offline ya traiga su UUID
  turnoId: z.string(),
  mesaId: z.string().nullable().optional().default(null), // llevar/domicilio no llevan mesa
  tipo: z.enum(["mesa", "llevar", "domicilio"]),
});

// Abrir una comanda (mesa nueva, o pedido para llevar/domicilio).
comandasRouter.post("/", requireAuth, (req, res) => {
  const parsed = abrirComandaSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());
  const { turnoId, mesaId, tipo } = parsed.data;
  const id = parsed.data.id ?? uuid();
  const camareroId = req.auth!.usuarioId;
  const ahora = new Date().toISOString();

  // Si el turno ya no existe (p.ej. la cola offline traía uno de una BD anterior)
  // rechazamos con 404 en vez de reventar con FOREIGN KEY constraint —
  // así el cliente lo descarta de su cola en lugar de reintentar para siempre.
  const turnoExiste = db.prepare(`SELECT 1 FROM turnos WHERE id = ?`).get(turnoId);
  if (!turnoExiste) return res.status(404).json({ error: "El turno indicado no existe" });

  if (mesaId) {
    const mesaExiste = db.prepare(`SELECT 1 FROM mesas WHERE id = ?`).get(mesaId);
    if (!mesaExiste) return res.status(404).json({ error: "La mesa indicada no existe" });
  }

  // Si es tipo "mesa", comprobamos que no esté ya abierta por otro camarero
  // (caso de conflicto que vimos: dos móviles abriendo la misma mesa offline).
  if (tipo === "mesa" && mesaId) {
    const abierta = db
      .prepare(
        `SELECT id, camarero_id FROM comandas WHERE mesa_id = ? AND estado NOT IN ('cerrada','cancelada')`
      )
      .get(mesaId) as { id: string; camarero_id: string } | undefined;
    if (abierta) {
      return res.status(200).json({
        id: abierta.id,
        yaAbiertaPor: abierta.camarero_id,
        mensaje: "La mesa ya estaba abierta, tus líneas se añadirán a esa comanda",
      });
    }
    // OJO: la mesa NO se marca ocupada aquí. Solo pasa a "ocupada" cuando
    // se envía la primera ronda (ver crearRonda). Así, si un camarero entra
    // en una mesa por error y sale sin pedir nada, la mesa sigue libre.
  }

  db.prepare(
    `INSERT INTO comandas (id, restaurante_id, turno_id, mesa_id, tipo, camarero_id, estado, creado_en)
     VALUES (?, ?, ?, ?, ?, ?, 'abierta', ?)`
  ).run(id, RESTAURANTE_ID, turnoId, mesaId, tipo, camareroId, ahora);

  res.status(201).json({ id, tipo, mesaId, estado: "abierta" });
});

// Comandas abiertas con su total: la vista de sala lo usa para mostrar
// cuánto lleva cada mesa antes de entrar en ella.
comandasRouter.get("/abiertas", requireAuth, (_req, res) => {
  const filas = db
    .prepare(
      `SELECT c.id, c.mesa_id, c.tipo, c.creado_en, u.nombre AS camarero,
              COALESCE(SUM(l.cantidad * l.precio_unitario), 0) AS total,
              COALESCE(SUM(l.cantidad), 0) AS unidades
         FROM comandas c
         JOIN usuarios u ON u.id = c.camarero_id
         LEFT JOIN lineas_comanda l ON l.comanda_id = c.id
        WHERE c.restaurante_id = ? AND c.estado NOT IN ('cerrada','cancelada')
        GROUP BY c.id`
    )
    .all(RESTAURANTE_ID);
  res.json(filas);
});

/**
 * MOVER o UNIR una comanda a otra mesa.
 * - Si la mesa destino está libre: la comanda entera cambia de mesa y la
 *   mesa de origen se libera.
 * - Si la mesa destino ya tiene comanda abierta: las líneas de la de origen
 *   se traspasan a la de destino, la de origen se marca como cancelada y su
 *   mesa se libera. Los precios y la impresora resuelta NO se recalculan:
 *   son un snapshot histórico de lo que ya se pidió y se imprimió.
 */
comandasRouter.post("/:id/mover", requireAuth, (req, res) => {
  const parsed = z.object({ mesaDestinoId: z.string() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());
  const { mesaDestinoId } = parsed.data;

  const origen = db
    .prepare(`SELECT id, mesa_id, estado, turno_id FROM comandas WHERE id = ? AND restaurante_id = ?`)
    .get(req.params.id, RESTAURANTE_ID) as
    | { id: string; mesa_id: string | null; estado: string; turno_id: string }
    | undefined;
  if (!origen) return res.status(404).json({ error: "Comanda no encontrada" });
  if (origen.estado === "cerrada" || origen.estado === "cancelada") {
    return res.status(409).json({ error: `La comanda ya está ${origen.estado}` });
  }
  if (origen.mesa_id === mesaDestinoId) {
    return res.status(400).json({ error: "La comanda ya está en esa mesa" });
  }

  const destino = db
    .prepare(`SELECT id, nombre FROM mesas WHERE id = ? AND restaurante_id = ?`)
    .get(mesaDestinoId, RESTAURANTE_ID) as { id: string; nombre: string } | undefined;
  if (!destino) return res.status(404).json({ error: "La mesa destino no existe" });

  // ¿Tiene la mesa destino una comanda abierta? Eso decide mover vs unir.
  const comandaDestino = db
    .prepare(
      `SELECT id FROM comandas
        WHERE mesa_id = ? AND estado NOT IN ('cerrada','cancelada') AND id != ?`
    )
    .get(mesaDestinoId, origen.id) as { id: string } | undefined;

  const ahora = new Date().toISOString();
  let modo: "movida" | "unida";
  let comandaFinalId = origen.id;

  const tx = db.transaction(() => {
    if (comandaDestino) {
      // UNIR: traspasar líneas y rondas a la comanda de destino.
      db.prepare(`UPDATE lineas_comanda SET comanda_id = ? WHERE comanda_id = ?`)
        .run(comandaDestino.id, origen.id);
      db.prepare(`UPDATE rondas SET comanda_id = ? WHERE comanda_id = ?`)
        .run(comandaDestino.id, origen.id);
      // Los pagos parciales que hubiera también viajan con la cuenta.
      db.prepare(`UPDATE pagos SET comanda_id = ? WHERE comanda_id = ?`)
        .run(comandaDestino.id, origen.id);
      db.prepare(`UPDATE comandas SET estado = 'cancelada', cerrado_en = ? WHERE id = ?`)
        .run(ahora, origen.id);
      db.prepare(`UPDATE mesas SET estado = 'ocupada' WHERE id = ?`).run(mesaDestinoId);
      modo = "unida";
      comandaFinalId = comandaDestino.id;
    } else {
      // MOVER: la comanda cambia de mesa.
      db.prepare(`UPDATE comandas SET mesa_id = ? WHERE id = ?`).run(mesaDestinoId, origen.id);
      db.prepare(`UPDATE mesas SET estado = 'ocupada' WHERE id = ?`).run(mesaDestinoId);
      modo = "movida";
    }
    // La mesa de origen queda libre en ambos casos.
    if (origen.mesa_id) {
      db.prepare(`UPDATE mesas SET estado = 'libre' WHERE id = ?`).run(origen.mesa_id);
    }
  });
  tx();

  const io = req.app.get("io");
  io?.to(RESTAURANTE_ID).emit("mesa:liberada", { mesaId: origen.mesa_id });
  io?.to(RESTAURANTE_ID).emit("comanda:movida", {
    comandaId: comandaFinalId,
    mesaDestinoId,
    modo: modo!,
  });

  res.json({
    modo: modo!,
    comandaId: comandaFinalId,
    mesaDestino: destino.nombre,
  });
});

comandasRouter.get("/:id", requireAuth, (req, res) => {
  const comanda = db.prepare(`SELECT * FROM comandas WHERE id = ?`).get(req.params.id) as
    | Record<string, unknown>
    | undefined;
  if (!comanda) return res.status(404).json({ error: "Comanda no encontrada" });

  // Con el nombre del producto ya resuelto: la PWA no tiene que cruzar la carta.
  const lineas = db
    .prepare(
      `SELECT l.id, l.cantidad, l.producto_id, l.precio_unitario, l.notas, l.estado,
              l.enviado_en, p.nombre, p.tipo_iva
         FROM lineas_comanda l
         JOIN productos p ON p.id = l.producto_id
        WHERE l.comanda_id = ?
        ORDER BY l.enviado_en`
    )
    .all(req.params.id) as { id: string; cantidad: number; precio_unitario: number }[];

  // Extras aplicados, agrupados por línea.
  const extras = db
    .prepare(
      `SELECT le.linea_id, le.nombre, le.precio FROM linea_extras le
         JOIN lineas_comanda l ON l.id = le.linea_id
        WHERE l.comanda_id = ?`
    )
    .all(req.params.id) as { linea_id: string; nombre: string; precio: number }[];
  const conExtras = lineas.map((l) => ({
    ...l,
    extras: extras.filter((e) => e.linea_id === l.id).map(({ nombre, precio }) => ({ nombre, precio })),
  }));

  const total = Number(
    lineas.reduce((a, l) => a + l.cantidad * l.precio_unitario, 0).toFixed(2)
  );
  res.json({ comanda, lineas: conExtras, total });
});

const enviarRondaSchema = z.object({
  lineas: z
    .array(
      z.object({
        productoId: z.string(),
        cantidad: z.number().int().positive(),
        notas: z.string().optional(),
        // Extras aplicados a esta línea. Los que tengan precio > 0 se suman
        // al precio unitario; los de precio 0 son modificaciones.
        extraIds: z.array(z.string()).optional(),
      })
    )
    .min(1),
  // true (por defecto) = guardar e imprimir. false = solo guardar.
  imprimir: z.boolean().optional().default(true),
});

// Enviar una ronda: crea las líneas, resuelve destinos y encola tickets.
comandasRouter.post("/:id/rondas", requireAuth, (req, res) => {
  const parsed = enviarRondaSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());

  const comanda = db.prepare(`SELECT id FROM comandas WHERE id = ?`).get(req.params.id);
  if (!comanda) return res.status(404).json({ error: "Comanda no encontrada" });

  try {
    const resultado = crearRonda(
      req.params.id,
      req.auth!.usuarioId,
      parsed.data.lineas,
      parsed.data.imprimir
    );

    // Avisar en tiempo real a cocina/pantallas y al resto de dispositivos del restaurante.
    const io = req.app.get("io");
    io?.to(RESTAURANTE_ID).emit("ronda:creada", {
      comandaId: req.params.id,
      rondaId: resultado.rondaId,
      destinos: resultado.destinos,
    });

    if (resultado.avisosSinDestino.length > 0) {
      io?.to(RESTAURANTE_ID).emit("alerta:producto_sin_destino", {
        productos: resultado.avisosSinDestino,
      });
    }

    res.status(201).json(resultado);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});
