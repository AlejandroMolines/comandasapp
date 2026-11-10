import type { Request, Response, NextFunction } from "express";
import type { RolUsuario } from "@comandas/shared-types";
import { db } from "../db/connection.js";
import { firmarPayload, leerToken } from "../lib/secretos.js";

// Token HMAC-SHA256 (no es un JWT de terceros: no hace falta ninguna
// dependencia ni salir de la máquina). El rol NO se fía del token: se lee
// de la base de datos en cada petición, así que cambiar o desactivar a
// alguien tiene efecto al momento.

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
  return firmarPayload(payload);
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Falta token de autenticación" });
  }
  const payload = leerToken<TokenPayload>(header.slice(7));
  if (!payload?.usuarioId || !payload.restauranteId) {
    return res.status(401).json({ error: "Token inválido" });
  }

  const usuario = db
    .prepare(`SELECT rol FROM usuarios WHERE id = ? AND restaurante_id = ? AND activo = 1`)
    .get(payload.usuarioId, payload.restauranteId) as { rol: RolUsuario } | undefined;
  if (!usuario) {
    return res.status(401).json({ error: "Tu sesión ya no es válida, vuelve a iniciar sesión" });
  }

  // El rol efectivo es el de la BD, no el que viniera escrito en el token.
  req.auth = { ...payload, rol: usuario.rol };
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
