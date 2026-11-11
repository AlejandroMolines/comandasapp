import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { db } from "../../db/connection.js";
import { firmarToken } from "../../middleware/auth.js";
import { firmarSesion, hashSecreto, hashSecretoAsync, leerToken, sesionVigente, verificarSecretoAsync } from "../../lib/secretos.js";
import { loginCorrecto, loginFallido, segundosBloqueo } from "../../middleware/login-limit.js";
import type { Request, Response, NextFunction } from "express";

async function aceptarSecreto(plano: string, almacenado: string, alCambiar: (nuevo: string) => void): Promise<boolean> {
  const resultado = await verificarSecretoAsync(plano, almacenado);
  if (!resultado.ok) return false;
  if (resultado.legacy) alCambiar(await hashSecretoAsync(plano));
  return true;
}

function rutaAsync(handler: (req: Request, res: Response) => Promise<unknown>): RequestHandler {
  return (req, res, next) => { void handler(req, res).catch(next); };
}

const HASH_FICTICIO = hashSecreto("credencial-ficticia-no-valida");

export const authRouter = Router();
const RESTAURANTE_ID = process.env.RESTAURANTE_ID ?? "restaurante-demo";

// Token de nivel RESTAURANTE: identifica al dispositivo dentro del local,
// pero aún no a una persona. Solo sirve para listar perfiles y entrar en uno.
interface TokenRestaurante {
  nivel: "restaurante";
  restauranteId: string;
  dispositivoId: string;
}

function requireRestaurante(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return res.status(401).json({ error: "Falta token" });
  const raw = leerToken<TokenRestaurante>(header.slice(7));
  if (
    !raw || raw.nivel !== "restaurante" || raw.restauranteId !== RESTAURANTE_ID ||
    !raw.dispositivoId || !sesionVigente(raw) ||
    !db.prepare(`SELECT 1 FROM restaurantes WHERE id = ?`).get(RESTAURANTE_ID)
  ) {
    return res.status(401).json({ error: "Token inválido" });
  }
  (req as Request & { restaurante?: TokenRestaurante }).restaurante = raw;
  next();
}

// PASO 1: login del restaurante con email + contraseña.
const loginRestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  dispositivoId: z.string().min(1).max(128),
});

authRouter.post("/restaurante", rutaAsync(async (req, res) => {
  const parsed = loginRestSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());
  const { email, password, dispositivoId } = parsed.data;
  const ip = req.ip || "desconocida";
  const credencial = `restaurante:${email.toLowerCase().trim()}`;
  const espera = segundosBloqueo(ip, credencial);
  if (espera) {
    res.setHeader("Retry-After", String(espera));
    return res.status(429).json({ error: "Demasiados intentos. Espera antes de volver a intentarlo." });
  }

  const rest = db
    .prepare(`SELECT id, nombre, password_hash FROM restaurantes WHERE email = ? AND id = ?`)
    .get(email.toLowerCase().trim(), RESTAURANTE_ID) as { id: string; nombre: string; password_hash: string } | undefined;
  let ok = false;
  if (rest) {
    ok = await aceptarSecreto(password, rest.password_hash, (nuevo) => {
      db.prepare(`UPDATE restaurantes SET password_hash = ? WHERE id = ?`).run(nuevo, rest.id);
    });
  } else {
    await verificarSecretoAsync(password, HASH_FICTICIO);
  }
  if (!rest || !ok) {
    loginFallido(ip, credencial);
    return res.status(401).json({ error: "Email o contraseña incorrectos" });
  }
  loginCorrecto(ip, credencial);

  const token = firmarSesion({
    nivel: "restaurante",
    restauranteId: rest.id,
    dispositivoId,
  } satisfies TokenRestaurante);

  res.json({ tokenRestaurante: token, restaurante: { id: rest.id, nombre: rest.nombre } });
}));

// PASO 2: perfiles del restaurante (nombre, rol y si piden PIN — nunca el PIN en sí).
authRouter.get("/usuarios", requireRestaurante, (req, res) => {
  const { restauranteId } = (req as Request & { restaurante: TokenRestaurante }).restaurante;
  const usuarios = db
    .prepare(
      `SELECT id, nombre, rol, (pin_hash != '') AS tienePin
         FROM usuarios WHERE restaurante_id = ? AND activo = 1 ORDER BY rol, nombre`
    )
    .all(restauranteId) as { id: string; nombre: string; rol: string; tienePin: number }[];
  res.json(usuarios.map((u) => ({ ...u, tienePin: !!u.tienePin })));
});

// PASO 3: entrar en un perfil. PIN obligatorio solo si el perfil lo tiene.
const entrarSchema = z.object({
  usuarioId: z.string(),
  pin: z.string().optional(),
});

authRouter.post("/entrar", requireRestaurante, rutaAsync(async (req, res) => {
  const parsed = entrarSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());
  const { restauranteId, dispositivoId } = (req as Request & { restaurante: TokenRestaurante }).restaurante;
  const ip = req.ip || "desconocida";
  const credencial = `usuario:${restauranteId}:${parsed.data.usuarioId}`;
  const espera = segundosBloqueo(ip, credencial);
  if (espera) {
    res.setHeader("Retry-After", String(espera));
    return res.status(429).json({ error: "Demasiados intentos. Espera antes de volver a intentarlo." });
  }

  const usuario = db
    .prepare(
      `SELECT id, nombre, rol, pin_hash FROM usuarios
        WHERE id = ? AND restaurante_id = ? AND activo = 1`
    )
    .get(parsed.data.usuarioId, restauranteId) as
    | { id: string; nombre: string; rol: "admin" | "camarero"; pin_hash: string }
    | undefined;
  if (!usuario) {
    await verificarSecretoAsync(parsed.data.pin ?? "", HASH_FICTICIO);
    loginFallido(ip, credencial);
    return res.status(401).json({ error: "Perfil o PIN incorrecto" });
  }

  if (usuario.pin_hash !== "") {
    const pinOk = await aceptarSecreto(parsed.data.pin ?? "", usuario.pin_hash, (nuevo) => {
      db.prepare(`UPDATE usuarios SET pin_hash = ? WHERE id = ?`).run(nuevo, usuario.id);
    });
    if (!pinOk) {
      loginFallido(ip, credencial);
      return res.status(401).json({ error: "Perfil o PIN incorrecto" });
    }
  }
  loginCorrecto(ip, credencial);

  const token = firmarToken({
    usuarioId: usuario.id,
    restauranteId,
    rol: usuario.rol,
    dispositivoId,
  });
  res.json({ token, usuario: { id: usuario.id, nombre: usuario.nombre, rol: usuario.rol } });
}));
