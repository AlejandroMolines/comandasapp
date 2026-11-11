import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Router, type Request, type Response } from "express";
import { db } from "../db/connection.js";
import { firmarToken } from "../middleware/auth.js";
import { firmarSesion } from "../lib/secretos.js";
import { esModoDemo, reiniciarDemo } from "./semilla.js";

const RESTAURANTE_ID = process.env.RESTAURANTE_ID ?? "restaurante-demo";
const entradas = new Map<string, { exp: number; html: string }>();

function puenteOk(header: string | undefined): boolean {
  const esperado = process.env.DEMO_BRIDGE_TOKEN ?? "";
  if (!esperado || !header?.startsWith("Bearer ")) return false;
  const recibido = header.slice(7);
  const a = Buffer.from(recibido);
  const b = Buffer.from(esperado);
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

function sesionDe(rol: "admin" | "camarero") {
  const usuario = db
    .prepare(
      `SELECT id, nombre, rol FROM usuarios
        WHERE restaurante_id = ? AND rol = ? AND activo = 1 ORDER BY nombre LIMIT 1`
    )
    .get(RESTAURANTE_ID, rol) as { id: string; nombre: string; rol: "admin" | "camarero" } | undefined;
  if (!usuario) return null;
  const rest = db.prepare(`SELECT nombre FROM restaurantes WHERE id = ?`).get(RESTAURANTE_ID) as
    | { nombre: string }
    | undefined;
  const dispositivoId = "demo-superadmin";
  return {
    token: firmarToken({
      usuarioId: usuario.id,
      restauranteId: RESTAURANTE_ID,
      rol: usuario.rol,
      dispositivoId,
    }),
    tokenRestaurante: firmarSesion({ nivel: "restaurante", restauranteId: RESTAURANTE_ID, dispositivoId }),
    usuario,
    nombre: rest?.nombre ?? "Restaurante demo",
  };
}

export const demoRouter = Router();

demoRouter.post("/entrada", (req, res) => {
  if (!esModoDemo()) return res.status(404).json({ error: "Este servidor no es el restaurante demo" });
  if (!puenteOk(req.headers.authorization)) return res.status(401).json({ error: "Puente demo no autorizado" });
  const destino = req.body?.destino;
  if (destino !== "camarero" && destino !== "admin" && destino !== "cocina") {
    return res.status(400).json({ error: "Destino no válido" });
  }
  const origen = `${req.protocol}://${req.get("host")}`;
  if (destino === "cocina") return res.json({ url: `${origen}/cocina` });

  const sesion = sesionDe(destino === "admin" ? "admin" : "camarero");
  if (!sesion) return res.status(409).json({ error: "Falta el perfil de ese rol en la semilla" });
  const t = crypto.randomBytes(24).toString("base64url");
  const script = `localStorage.setItem("token", ${JSON.stringify(sesion.token)});
localStorage.setItem("usuario", ${JSON.stringify(JSON.stringify(sesion.usuario))});
localStorage.setItem("tokenRestaurante", ${JSON.stringify(sesion.tokenRestaurante)});
localStorage.setItem("restauranteNombre", ${JSON.stringify(sesion.nombre)});
location.replace("/");`;
  entradas.set(t, { exp: Date.now() + 2 * 60_000, html: script });
  return res.json({ url: `${origen}/demo/entrar?t=${t}` });
});

demoRouter.get("/entrar", (req, res) => {
  if (!esModoDemo()) return res.status(404).type("text").send("No disponible");
  const t = String(req.query.t ?? "");
  const entrada = entradas.get(t);
  entradas.delete(t);
  if (!entrada || entrada.exp < Date.now()) {
    return res.status(401).type("html").send("<p>El enlace de demostración ha caducado. Vuelve a abrirlo desde el superadmin.</p>");
  }
  res.type("html").send(`<!doctype html><meta charset="utf-8"><title>Entrando al demo…</title><script>${entrada.html}</script>`);
});

demoRouter.post("/reiniciar", (req, res) => {
  if (!esModoDemo()) return res.status(404).json({ error: "Este servidor no es el restaurante demo" });
  if (!puenteOk(req.headers.authorization)) return res.status(401).json({ error: "Puente demo no autorizado" });
  try {
    reiniciarDemo();
    return res.json({ ok: true });
  } catch (err) {
    return res.status(400).json({ error: (err as Error).message });
  }
});

export function cocinaHandler(req: Request, res: Response) {
  if (!esModoDemo()) return res.status(404).type("html").send("<p>La pantalla de cocina de demostración no está activa en este servidor.</p>");
  if (req.method !== "GET") return res.status(405).end();
  const abiertas = db
    .prepare(
      `SELECT m.nombre AS mesa, c.tipo, p.nombre, l.cantidad, l.notas, c.creado_en
         FROM lineas_comanda l
         JOIN comandas c ON c.id = l.comanda_id
         JOIN productos p ON p.id = l.producto_id
        LEFT JOIN mesas m ON m.id = c.mesa_id
        WHERE c.restaurante_id = ? AND c.estado NOT IN ('cerrada','cancelada') AND COALESCE(l.anulada,0) = 0
        ORDER BY c.creado_en`
    )
    .all(RESTAURANTE_ID) as { mesa: string | null; tipo: string; nombre: string; cantidad: number; notas: string | null }[];
  const logPath = path.join(path.dirname(process.env.DB_PATH ?? path.join(process.cwd(), "data/local.sqlite")), "demo-tickets.log");
  const papel = fs.existsSync(logPath) ? fs.readFileSync(logPath, "utf8").trim().split("\n").slice(-12) : [];
  const filas = abiertas.map((l) =>
    `<li><b>${esc(l.mesa ? `Mesa ${l.mesa}` : "Para llevar")}</b> · ${l.cantidad}× ${esc(l.nombre)}${l.notas ? ` <em>(${esc(l.notas)})</em>` : ""}</li>`
  ).join("");
  const tickets = papel.map((linea) => `<li>${esc(linea)}</li>`).join("");
  res.type("html").send(`<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Cocina · demo</title>
<meta http-equiv="refresh" content="8">
<style>
  body { margin: 0; font-family: system-ui, sans-serif; background: #14110c; color: #f6f1e7; }
  main { max-width: 720px; margin: 0 auto; padding: 24px; }
  .aviso { background: #3a2a12; color: #f0d7a2; padding: 10px 12px; border-radius: 10px; }
  li { margin: 8px 0; }
</style></head>
<body><main>
  <p class="aviso">Pantalla de cocina de demostración. No imprime en papel real ni tiene validez fiscal.</p>
  <h1>Cocina</h1>
  <ul>${filas || "<li>No hay comandas abiertas.</li>"}</ul>
  <h2>Tickets simulados</h2>
  <ul>${tickets || "<li>Todavía no se ha simulado ningún ticket.</li>"}</ul>
</main></body></html>`);
}

function esc(valor: string) {
  return valor.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}
