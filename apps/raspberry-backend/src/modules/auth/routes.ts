import { Router } from "express";
import { z } from "zod";
import { db } from "../../db/connection.js";
import { firmarToken } from "../../middleware/auth.js";
import type { Request, Response, NextFunction } from "express";

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
  try {
    const raw = JSON.parse(Buffer.from(header.slice(7), "base64").toString("utf-8")) as TokenRestaurante;
    if (raw.nivel !== "restaurante") return res.status(401).json({ error: "Token inválido" });
    (req as Request & { restaurante?: TokenRestaurante }).restaurante = raw;
    next();
  } catch {
    return res.status(401).json({ error: "Token inválido" });
  }
}

// PASO 1: login del restaurante con email + contraseña.
const loginRestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  dispositivoId: z.string(),
});

authRouter.post("/restaurante", (req, res) => {
  const parsed = loginRestSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());
  const { email, password, dispositivoId } = parsed.data;

  // TODO producción: password con bcrypt en vez de texto plano.
  const rest = db
    .prepare(`SELECT id, nombre FROM restaurantes WHERE email = ? AND password_hash = ?`)
    .get(email.toLowerCase().trim(), password) as { id: string; nombre: string } | undefined;
  if (!rest) return res.status(401).json({ error: "Email o contraseña incorrectos" });

  const token = Buffer.from(
    JSON.stringify({ nivel: "restaurante", restauranteId: rest.id, dispositivoId } satisfies TokenRestaurante)
  ).toString("base64");

  res.json({ tokenRestaurante: token, restaurante: { id: rest.id, nombre: rest.nombre } });
});

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

authRouter.post("/entrar", requireRestaurante, (req, res) => {
  const parsed = entrarSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());
  const { restauranteId, dispositivoId } = (req as Request & { restaurante: TokenRestaurante }).restaurante;

  const usuario = db
    .prepare(
      `SELECT id, nombre, rol, pin_hash FROM usuarios
        WHERE id = ? AND restaurante_id = ? AND activo = 1`
    )
    .get(parsed.data.usuarioId, restauranteId) as
    | { id: string; nombre: string; rol: "admin" | "camarero"; pin_hash: string }
    | undefined;
  if (!usuario) return res.status(404).json({ error: "Perfil no encontrado" });

  if (usuario.pin_hash !== "" && usuario.pin_hash !== (parsed.data.pin ?? "")) {
    return res.status(401).json({ error: "PIN incorrecto" });
  }

  const token = firmarToken({
    usuarioId: usuario.id,
    restauranteId,
    rol: usuario.rol,
    dispositivoId,
  });
  res.json({ token, usuario: { id: usuario.id, nombre: usuario.nombre, rol: usuario.rol } });
});
