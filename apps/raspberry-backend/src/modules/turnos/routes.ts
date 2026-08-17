import { Router } from "express";
import { v4 as uuid } from "uuid";
import { z } from "zod";
import { db } from "../../db/connection.js";
import { getAjuste, setAjuste } from "../ajustes/routes.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";

export const turnosRouter = Router();
const RESTAURANTE_ID = process.env.RESTAURANTE_ID ?? "restaurante-demo";

// ---------------------------------------------------------------------------
// Apertura / cierre
// ---------------------------------------------------------------------------

const abrirTurnoSchema = z.object({
  cajaInicial: z.number().nonnegative().default(0),
});

// Solo el admin abre turno. Regla: no puede haber dos turnos abiertos a la vez.
turnosRouter.post("/", requireAuth, requireRole("admin"), (req, res) => {
  const parsed = abrirTurnoSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());

  const abierto = db
    .prepare(`SELECT id FROM turnos WHERE restaurante_id = ? AND cerrado_en IS NULL`)
    .get(RESTAURANTE_ID) as { id: string } | undefined;
  if (abierto) {
    return res
      .status(409)
      .json({ error: "Ya hay un turno abierto; ciérralo antes de abrir otro", turnoId: abierto.id });
  }

  const id = uuid();
  db.prepare(
    `INSERT INTO turnos (id, restaurante_id, usuario_apertura_id, abierto_en, caja_inicial)
     VALUES (?, ?, ?, ?, ?)`
  ).run(id, RESTAURANTE_ID, req.auth!.usuarioId, new Date().toISOString(), parsed.data.cajaInicial);

  res.status(201).json({ id, cajaInicial: parsed.data.cajaInicial });
});

/**
 * El turno SIEMPRE está abierto: si no hay ninguno, se abre uno solo.
 *
 * La caja inicial NO se arrastra del turno anterior: es un valor FIJO que el
 * admin configura a mano (el fondo de caja con el que se empieza cada día).
 * Si pone 100 €, todos los turnos nacen con 100 € por más turnos que pasen,
 * hasta que él lo cambie explícitamente.
 */
function asegurarTurnoAbierto(): { id: string; abierto_en: string } | null {
  const abierto = db
    .prepare(`SELECT id, abierto_en FROM turnos WHERE restaurante_id = ? AND cerrado_en IS NULL`)
    .get(RESTAURANTE_ID) as { id: string; abierto_en: string } | undefined;
  if (abierto) return abierto;

  const admin = db
    .prepare(`SELECT id FROM usuarios WHERE restaurante_id = ? AND rol = 'admin' LIMIT 1`)
    .get(RESTAURANTE_ID) as { id: string } | undefined;
  if (!admin) return null; // BD recién creada, aún sin bootstrap

  const cajaInicial = Number(getAjuste("caja_inicial_fija") || 0);
  const id = uuid();
  const abiertoEn = new Date().toISOString();
  db.prepare(
    `INSERT INTO turnos (id, restaurante_id, usuario_apertura_id, abierto_en, caja_inicial)
     VALUES (?, ?, ?, ?, ?)`
  ).run(id, RESTAURANTE_ID, admin.id, abiertoEn, cajaInicial);
  return { id, abierto_en: abiertoEn };
}

/**
 * INFORME para exportar a Excel. Agrupa los cobros por día, semana o mes.
 * Devuelve datos ya calculados para que el cliente solo tenga que volcarlos
 * en la hoja: filas por periodo, totales, desglose por método y top productos.
 *
 * Se agrupa por la fecha del PAGO, no del turno: es lo que cuadra con la
 * contabilidad (lo que entró en caja ese día).
 */
turnosRouter.get("/informe", requireAuth, requireRole("admin"), (req, res) => {
  const parsed = z
    .object({
      desde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Formato de fecha AAAA-MM-DD"),
      hasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Formato de fecha AAAA-MM-DD"),
      agrupacion: z.enum(["dia", "semana", "mes"]).default("dia"),
    })
    .safeParse(req.query);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());
  const { desde, hasta, agrupacion } = parsed.data;

  // SQLite: %Y-%m-%d por día, %Y-W%W por semana, %Y-%m por mes.
  const formato =
    agrupacion === "dia" ? "%Y-%m-%d" : agrupacion === "semana" ? "%Y-S%W" : "%Y-%m";

  const filas = db
    .prepare(
      `SELECT strftime('${formato}', pg.creado_en) AS periodo,
              COUNT(DISTINCT pg.id) AS numPagos,
              COUNT(DISTINCT c.id) AS comandas,
              COUNT(DISTINCT CASE WHEN c.tipo = 'mesa' THEN c.id END) AS mesas,
              COUNT(DISTINCT CASE WHEN c.tipo = 'llevar' THEN c.id END) AS llevar,
              COALESCE(SUM(CASE WHEN pg.metodo = 'efectivo' THEN pg.importe END), 0) AS efectivo,
              COALESCE(SUM(CASE WHEN pg.metodo = 'tarjeta' THEN pg.importe END), 0) AS tarjeta,
              COALESCE(SUM(CASE WHEN pg.metodo = 'otro' THEN pg.importe END), 0) AS otro,
              COALESCE(SUM(pg.importe), 0) AS total,
              COALESCE(SUM(pg.propina), 0) AS propinas
         FROM pagos pg
         JOIN comandas c ON c.id = pg.comanda_id
        WHERE c.restaurante_id = ?
          AND date(pg.creado_en) BETWEEN ? AND ?
        GROUP BY periodo ORDER BY periodo`
    )
    .all(RESTAURANTE_ID, desde, hasta) as Record<string, number | string>[];

  // Turnos cerrados del rango: caja inicial, contada y descuadre.
  const turnos = db
    .prepare(
      `SELECT id, abierto_en, cerrado_en, caja_inicial, caja_final
         FROM turnos
        WHERE restaurante_id = ? AND cerrado_en IS NOT NULL
          AND date(abierto_en) BETWEEN ? AND ?
        ORDER BY abierto_en`
    )
    .all(RESTAURANTE_ID, desde, hasta) as {
    id: string; abierto_en: string; cerrado_en: string;
    caja_inicial: number; caja_final: number | null;
  }[];

  // Para cada turno, el efectivo que debería haber entrado (para el descuadre).
  const turnosDetalle = turnos.map((t) => {
    const efec = db
      .prepare(
        `SELECT COALESCE(SUM(pg.importe), 0) AS n FROM pagos pg
           JOIN comandas c ON c.id = pg.comanda_id
          WHERE c.turno_id = ? AND pg.metodo = 'efectivo'`
      )
      .get(t.id) as { n: number };
    const esperado = Number((t.caja_inicial + efec.n).toFixed(2));
    return {
      abierto_en: t.abierto_en,
      cerrado_en: t.cerrado_en,
      cajaInicial: t.caja_inicial,
      efectivoCobrado: Number(efec.n.toFixed(2)),
      efectivoEsperado: esperado,
      cajaContada: t.caja_final,
      descuadre: t.caja_final === null ? null : Number((t.caja_final - esperado).toFixed(2)),
    };
  });

  const productos = db
    .prepare(
      `SELECT p.nombre, p.tipo_iva, SUM(l.cantidad) AS unidades,
              SUM(l.cantidad * l.precio_unitario) AS importe
         FROM lineas_comanda l
         JOIN productos p ON p.id = l.producto_id
         JOIN comandas c ON c.id = l.comanda_id
        WHERE c.restaurante_id = ? AND c.estado = 'cerrada'
          AND date(c.cerrado_en) BETWEEN ? AND ?
        GROUP BY p.id ORDER BY importe DESC`
    )
    .all(RESTAURANTE_ID, desde, hasta);

  // Desglose de IVA del periodo: útil para la declaración trimestral.
  const iva = db
    .prepare(
      `SELECT p.tipo_iva AS tipo,
              SUM(l.cantidad * l.precio_unitario) AS totalConIva
         FROM lineas_comanda l
         JOIN productos p ON p.id = l.producto_id
         JOIN comandas c ON c.id = l.comanda_id
        WHERE c.restaurante_id = ? AND c.estado = 'cerrada'
          AND date(c.cerrado_en) BETWEEN ? AND ?
        GROUP BY p.tipo_iva ORDER BY p.tipo_iva`
    )
    .all(RESTAURANTE_ID, desde, hasta) as { tipo: number; totalConIva: number }[];

  const desgloseIva = iva.map((r) => {
    const base = Number((r.totalConIva / (1 + r.tipo / 100)).toFixed(2));
    return {
      tipo: r.tipo,
      base,
      cuota: Number((r.totalConIva - base).toFixed(2)),
      total: Number(r.totalConIva.toFixed(2)),
    };
  });

  const facturas = db
    .prepare(
      `SELECT f.serie, f.numero, f.ejercicio, f.fecha_expedicion,
              f.cliente_razon_social, f.cliente_nif,
              f.base_imponible, f.cuota_iva, f.total, f.metodo_pago
         FROM facturas f
        WHERE f.restaurante_id = ? AND f.anulada = 0
          AND date(f.fecha_expedicion) BETWEEN ? AND ?
        ORDER BY f.ejercicio, f.numero`
    )
    .all(RESTAURANTE_ID, desde, hasta);

  const totales = filas.reduce<{
    efectivo: number; tarjeta: number; otro: number; total: number;
    propinas: number; comandas: number; mesas: number; llevar: number;
  }>(
    (a, f) => ({
      efectivo: a.efectivo + Number(f.efectivo),
      tarjeta: a.tarjeta + Number(f.tarjeta),
      otro: a.otro + Number(f.otro),
      total: a.total + Number(f.total),
      propinas: a.propinas + Number(f.propinas),
      comandas: a.comandas + Number(f.comandas),
      mesas: a.mesas + Number(f.mesas),
      llevar: a.llevar + Number(f.llevar),
    }),
    { efectivo: 0, tarjeta: 0, otro: 0, total: 0, propinas: 0, comandas: 0, mesas: 0, llevar: 0 }
  );

  res.json({
    desde,
    hasta,
    agrupacion,
    filas,
    totales: {
      ...totales,
      ticketMedio: totales.comandas ? Number((totales.total / totales.comandas).toFixed(2)) : 0,
    },
    turnos: turnosDetalle,
    productos,
    desgloseIva,
    facturas,
  });
});

// Historial de turnos para la vista del admin.
turnosRouter.get("/", requireAuth, requireRole("admin"), (_req, res) => {
  const turnos = db
    .prepare(
      `SELECT id, abierto_en, cerrado_en, caja_inicial, caja_final
         FROM turnos WHERE restaurante_id = ? ORDER BY abierto_en DESC LIMIT 30`
    )
    .all(RESTAURANTE_ID);
  res.json(turnos);
});

// El turno activo lo necesita CUALQUIER dispositivo (el móvil lo usa
// para colgar las comandas del turno correcto) — sin datos económicos.
// El turno activo lo necesita CUALQUIER dispositivo. Si no existe, se abre
// automáticamente: en este sistema nunca hay un momento "sin turno".
turnosRouter.get("/activo", requireAuth, (_req, res) => {
  const turno = asegurarTurnoAbierto();
  if (!turno) return res.status(404).json({ error: "Aún no hay usuarios en el restaurante" });
  res.json(turno);
});

const cerrarTurnoSchema = z.object({
  cajaFinal: z.number().nonnegative(),
});

// La caja inicial se puede corregir mientras el turno está abierto: el admin
// suele contar el cajón un rato después de empezar el servicio.
turnosRouter.patch("/:id/caja-inicial", requireAuth, requireRole("admin"), (req, res) => {
  const parsed = z.object({ cajaInicial: z.number().nonnegative() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());

  const turno = db
    .prepare(`SELECT cerrado_en FROM turnos WHERE id = ? AND restaurante_id = ?`)
    .get(req.params.id, RESTAURANTE_ID) as { cerrado_en: string | null } | undefined;
  if (!turno) return res.status(404).json({ error: "Turno no encontrado" });
  if (turno.cerrado_en)
    return res.status(409).json({ error: "El turno ya está cerrado; su caja no se puede cambiar" });

  db.prepare(`UPDATE turnos SET caja_inicial = ? WHERE id = ?`).run(
    parsed.data.cajaInicial,
    req.params.id
  );
  // Se guarda como fondo de caja FIJO: los turnos siguientes nacerán con
  // este mismo valor hasta que se vuelva a cambiar aquí.
  setAjuste("caja_inicial_fija", String(parsed.data.cajaInicial));
  res.json({ id: req.params.id, cajaInicial: parsed.data.cajaInicial });
});

turnosRouter.post("/:id/cerrar", requireAuth, requireRole("admin"), (req, res) => {
  const parsed = cerrarTurnoSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());

  const turno = db
    .prepare(`SELECT * FROM turnos WHERE id = ? AND restaurante_id = ?`)
    .get(req.params.id, RESTAURANTE_ID) as
    | { id: string; cerrado_en: string | null; caja_inicial: number }
    | undefined;
  if (!turno) return res.status(404).json({ error: "Turno no encontrado" });
  if (turno.cerrado_en) return res.status(409).json({ error: "El turno ya está cerrado" });

  // Aviso (no bloqueo) si quedan comandas abiertas: puede haber una mesa
  // rezagada legítima, pero el admin debe saberlo al cerrar caja.
  const comandasAbiertas = db
    .prepare(
      `SELECT COUNT(*) AS n FROM comandas WHERE turno_id = ? AND estado NOT IN ('cerrada','cancelada')`
    )
    .get(req.params.id) as { n: number };

  // Efectivo esperado = caja inicial + cobros en efectivo del turno.
  const efectivo = db
    .prepare(
      `SELECT COALESCE(SUM(pg.importe), 0) AS total
         FROM pagos pg JOIN comandas c ON c.id = pg.comanda_id
        WHERE c.turno_id = ? AND pg.metodo = 'efectivo'`
    )
    .get(req.params.id) as { total: number };
  const esperado = turno.caja_inicial + efectivo.total;
  const descuadre = parsed.data.cajaFinal - esperado;

  db.prepare(`UPDATE turnos SET cerrado_en = ?, caja_final = ? WHERE id = ?`).run(
    new Date().toISOString(),
    parsed.data.cajaFinal,
    req.params.id
  );

  // El siguiente turno se abre al instante, con la caja inicial FIJA
  // configurada (no con lo contado: el fondo de caja es un valor estable
  // que solo cambia el admin a mano).
  const nuevo = asegurarTurnoAbierto();

  res.json({
    id: req.params.id,
    cajaFinal: parsed.data.cajaFinal,
    efectivoEsperado: esperado,
    descuadre,
    comandasAbiertas: comandasAbiertas.n,
    nuevoTurnoId: nuevo?.id ?? null,
  });
});

// ---------------------------------------------------------------------------
// Resumen — EXCLUSIVO admin (regla de negocio: los camareros no ven facturación)
// ---------------------------------------------------------------------------

turnosRouter.get("/:id/resumen", requireAuth, requireRole("admin"), (req, res) => {
  const turno = db
    .prepare(`SELECT * FROM turnos WHERE id = ? AND restaurante_id = ?`)
    .get(req.params.id, RESTAURANTE_ID);
  if (!turno) return res.status(404).json({ error: "Turno no encontrado" });

  const facturacion = db
    .prepare(
      `SELECT COALESCE(SUM(pg.importe), 0) AS total,
              COALESCE(SUM(pg.propina), 0) AS propinas,
              COUNT(pg.id) AS numPagos
         FROM pagos pg JOIN comandas c ON c.id = pg.comanda_id
        WHERE c.turno_id = ?`
    )
    .get(req.params.id) as { total: number; propinas: number; numPagos: number };

  const porMetodo = db
    .prepare(
      `SELECT pg.metodo, COALESCE(SUM(pg.importe), 0) AS total
         FROM pagos pg JOIN comandas c ON c.id = pg.comanda_id
        WHERE c.turno_id = ? GROUP BY pg.metodo`
    )
    .all(req.params.id);

  const comandasPorTipo = db
    .prepare(
      `SELECT tipo, COUNT(*) AS n FROM comandas WHERE turno_id = ? GROUP BY tipo`
    )
    .all(req.params.id);

  const mesasSentadas = db
    .prepare(
      `SELECT COUNT(DISTINCT mesa_id) AS n FROM comandas
        WHERE turno_id = ? AND mesa_id IS NOT NULL`
    )
    .get(req.params.id) as { n: number };

  const comandasCerradas = db
    .prepare(
      `SELECT COUNT(*) AS n FROM comandas WHERE turno_id = ? AND estado = 'cerrada'`
    )
    .get(req.params.id) as { n: number };

  const ticketMedio =
    comandasCerradas.n > 0 ? facturacion.total / comandasCerradas.n : 0;

  const topProductos = db
    .prepare(
      `SELECT p.nombre, SUM(l.cantidad) AS unidades,
              SUM(l.cantidad * l.precio_unitario) AS importe
         FROM lineas_comanda l
         JOIN productos p ON p.id = l.producto_id
         JOIN comandas c ON c.id = l.comanda_id
        WHERE c.turno_id = ?
        GROUP BY p.id ORDER BY unidades DESC LIMIT 10`
    )
    .all(req.params.id);

  // Cuántas mesas/pedidos ha atendido cada camarero (y admin) y cuánto suman.
  const porCamarero = db
    .prepare(
      `SELECT u.nombre, u.rol,
              COUNT(DISTINCT c.id) AS comandas,
              COUNT(DISTINCT CASE WHEN c.tipo = 'mesa' THEN c.id END) AS mesas,
              COUNT(DISTINCT CASE WHEN c.tipo = 'llevar' THEN c.id END) AS llevar,
              COALESCE(SUM(l.cantidad * l.precio_unitario), 0) AS importe
         FROM comandas c
         JOIN usuarios u ON u.id = c.camarero_id
         LEFT JOIN lineas_comanda l ON l.comanda_id = c.id
        WHERE c.turno_id = ?
        GROUP BY u.id ORDER BY importe DESC`
    )
    .all(req.params.id);

  // Tiempo medio de mesa: desde que se abre la comanda hasta que se cobra.
  // julianday() en SQLite da días, así que x1440 -> minutos.
  const duracion = db
    .prepare(
      `SELECT AVG((julianday(cerrado_en) - julianday(creado_en)) * 1440) AS minutos,
              MAX((julianday(cerrado_en) - julianday(creado_en)) * 1440) AS maxMinutos
         FROM comandas
        WHERE turno_id = ? AND tipo = 'mesa' AND estado = 'cerrada' AND cerrado_en IS NOT NULL`
    )
    .get(req.params.id) as { minutos: number | null; maxMinutos: number | null };

  res.json({
    turno,
    facturacion: { ...facturacion, ticketMedio: Number(ticketMedio.toFixed(2)) },
    porMetodo,
    comandasPorTipo,
    mesasSentadas: mesasSentadas.n,
    comandasCerradas: comandasCerradas.n,
    topProductos,
    porCamarero,
    duracionMesa: {
      media: duracion.minutos ? Math.round(duracion.minutos) : null,
      maxima: duracion.maxMinutos ? Math.round(duracion.maxMinutos) : null,
    },
  });
});
