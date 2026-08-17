import { Router } from "express";
import { z } from "zod";
import { db } from "../../db/connection.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";

export const ajustesRouter = Router();
const RESTAURANTE_ID = process.env.RESTAURANTE_ID ?? "restaurante-demo";

/** Ajustes por defecto: si no están en BD, se devuelven estos. */
const DEFECTOS: Record<string, string> = {
  // Si es "false", los pedidos para llevar se registran pero NO se imprimen
  // (solo cuentan para caja y estadísticas).
  imprimir_llevar: "true",
  // Serie de las facturas simplificadas (los tickets). Distinta de la serie
  // de facturas completas para que ambas numeraciones sean independientes.
  fiscal_serie_simplificada: "SIM",
};

export function getAjuste(clave: string): string {
  const fila = db
    .prepare(`SELECT valor FROM ajustes WHERE restaurante_id = ? AND clave = ?`)
    .get(RESTAURANTE_ID, clave) as { valor: string } | undefined;
  return fila?.valor ?? DEFECTOS[clave] ?? "";
}

/** Guarda un ajuste desde otro módulo (p.ej. el fondo de caja fijo). */
export function setAjuste(clave: string, valor: string) {
  db.prepare(
    `INSERT INTO ajustes (restaurante_id, clave, valor) VALUES (?, ?, ?)
     ON CONFLICT(restaurante_id, clave) DO UPDATE SET valor = excluded.valor`
  ).run(RESTAURANTE_ID, clave, valor);
}

// Lectura abierta a cualquier rol: la PWA necesita saber cómo comportarse.
ajustesRouter.get("/", requireAuth, (_req, res) => {
  const filas = db
    .prepare(`SELECT clave, valor FROM ajustes WHERE restaurante_id = ?`)
    .all(RESTAURANTE_ID) as { clave: string; valor: string }[];
  const valores = { ...DEFECTOS };
  for (const f of filas) valores[f.clave] = f.valor;
  res.json(valores);
});

const putSchema = z.object({ clave: z.string().min(1), valor: z.string() });

ajustesRouter.put("/", requireAuth, requireRole("admin"), (req, res) => {
  const parsed = putSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());
  db.prepare(
    `INSERT INTO ajustes (restaurante_id, clave, valor) VALUES (?, ?, ?)
     ON CONFLICT(restaurante_id, clave) DO UPDATE SET valor = excluded.valor`
  ).run(RESTAURANTE_ID, parsed.data.clave, parsed.data.valor);
  res.json({ [parsed.data.clave]: parsed.data.valor });
});
