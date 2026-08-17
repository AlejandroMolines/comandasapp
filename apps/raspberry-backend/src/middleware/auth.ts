import type { Request, Response, NextFunction } from "express";
import type { RolUsuario } from "@comandas/shared-types";
import { db } from "../db/connection.js";

// NOTA: para el esqueleto, el "token" es un JSON en base64 sin firmar.
// TODO antes de producción: sustituir por JWT firmado (jsonwebtoken) y
// pin_hash con bcrypt en vez de comparación en texto plano (ver usuarios/routes.ts).

export interface TokenPayload {
  usuarioId: string;
  restauranteId: string;
  rol: RolUsuario;
  dispositivoId: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: TokenPayload;
    }
  }
}

export function firmarToken(payload: TokenPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString("base64");
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Falta token de autenticación" });
  }
  let payload: TokenPayload;
  try {
    const raw = Buffer.from(header.slice(7), "base64").toString("utf-8");
    payload = JSON.parse(raw) as TokenPayload;
  } catch {
    return res.status(401).json({ error: "Token inválido" });
  }

  // El token no lleva firma, así que su contenido no es de fiar por sí solo.
  // Comprobamos que ese usuario SIGUE existiendo y activo — si no, cualquier
  // insert que referencie camarero_id (rondas, comandas, pagos...) reventaría
  // con un "FOREIGN KEY constraint failed" sin control. Esto pasa sobre todo
  // tras borrar/recrear la base de datos con el navegador aún con un token
  // antiguo guardado: se corta aquí, limpio, en vez de crashear más abajo.
  const usuario = db
    .prepare(`SELECT 1 FROM usuarios WHERE id = ? AND restaurante_id = ? AND activo = 1`)
    .get(payload.usuarioId, payload.restauranteId);
  if (!usuario) {
    return res.status(401).json({ error: "Tu sesión ya no es válida, vuelve a iniciar sesión" });
  }

  req.auth = payload;
  next();
}

export function requireRole(...roles: RolUsuario[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth || !roles.includes(req.auth.rol)) {
      return res.status(403).json({ error: "No tienes permiso para esta acción" });
    }
    next();
  };
}
