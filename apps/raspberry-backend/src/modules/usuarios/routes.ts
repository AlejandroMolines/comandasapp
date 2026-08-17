import { Router } from "express";
import { v4 as uuid } from "uuid";
import { z } from "zod";
import { db } from "../../db/connection.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";

export const usuariosRouter = Router();

const RESTAURANTE_ID = process.env.RESTAURANTE_ID ?? "restaurante-demo";

const crearUsuarioSchema = z.object({
  nombre: z.string().min(1),
  rol: z.enum(["admin", "camarero"]),
  pin: z.string().min(3).max(6).optional(), // sin PIN = entra directo al elegir su perfil
});

// Solo el admin (PC) puede crear/gestionar perfiles.
usuariosRouter.post("/", requireAuth, requireRole("admin"), (req, res) => {
  const parsed = crearUsuarioSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());
  const { nombre, rol, pin } = parsed.data;

  if (rol === "admin") {
    const yaHayAdmin = db
      .prepare(`SELECT 1 FROM usuarios WHERE restaurante_id = ? AND rol = 'admin' AND activo = 1`)
      .get(RESTAURANTE_ID);
    if (yaHayAdmin) {
      return res.status(409).json({ error: "Ya existe un admin activo para este restaurante" });
    }
  }

  const id = uuid();
  db.prepare(
    `INSERT INTO usuarios (id, restaurante_id, nombre, rol, pin_hash, activo, creado_en)
     VALUES (?, ?, ?, ?, ?, 1, ?)`
  ).run(id, RESTAURANTE_ID, nombre, rol, pin ?? "", new Date().toISOString());

  res.status(201).json({ id, nombre, rol });
});

usuariosRouter.get("/", requireAuth, requireRole("admin"), (_req, res) => {
  const usuarios = db
    .prepare(`SELECT id, nombre, rol, activo FROM usuarios WHERE restaurante_id = ?`)
    .all(RESTAURANTE_ID);
  res.json(usuarios);
});

usuariosRouter.patch("/:id/activo", requireAuth, requireRole("admin"), (req, res) => {
  const parsed = z.object({ activo: z.boolean() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());
  const usuario = db
    .prepare(`SELECT rol FROM usuarios WHERE id = ? AND restaurante_id = ?`)
    .get(req.params.id, RESTAURANTE_ID) as { rol: string } | undefined;
  if (!usuario) return res.status(404).json({ error: "Usuario no encontrado" });
  if (usuario.rol === "admin" && !parsed.data.activo) {
    return res.status(400).json({ error: "El admin no puede desactivarse a sí mismo" });
  }
  db.prepare(`UPDATE usuarios SET activo = ? WHERE id = ?`).run(
    parsed.data.activo ? 1 : 0,
    req.params.id
  );
  res.json({ id: req.params.id, activo: parsed.data.activo });
});
