import { Router } from "express";
import { z } from "zod";
import { db } from "../../db/connection.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { v4 as uuid } from "uuid";

export const empresasRouter = Router();
const RESTAURANTE_ID = process.env.RESTAURANTE_ID ?? "restaurante-demo";

/**
 * Valida NIF/CIF/NIE español comprobando el dígito de control.
 * No es un capricho: si el NIF está mal, el cliente NO puede deducir el IVA
 * y la factura es inútil para él — mejor avisar al darlo de alta que
 * descubrirlo cuando su contable la rechace.
 */
export function nifValido(valor: string): boolean {
  const nif = valor.toUpperCase().replace(/[\s-]/g, "");

  // DNI: 8 dígitos + letra de control
  if (/^\d{8}[A-Z]$/.test(nif)) {
    const letras = "TRWAGMYFPDXBNJZSQVHLCKE";
    return letras[parseInt(nif.slice(0, 8), 10) % 23] === nif[8];
  }

  // NIE: X/Y/Z + 7 dígitos + letra
  if (/^[XYZ]\d{7}[A-Z]$/.test(nif)) {
    const prefijo = { X: "0", Y: "1", Z: "2" }[nif[0] as "X" | "Y" | "Z"];
    const letras = "TRWAGMYFPDXBNJZSQVHLCKE";
    return letras[parseInt(prefijo + nif.slice(1, 8), 10) % 23] === nif[8];
  }

  // CIF: letra + 7 dígitos + dígito o letra de control
  if (/^[ABCDEFGHJNPQRSUVW]\d{7}[0-9A-J]$/.test(nif)) {
    const digitos = nif.slice(1, 8);
    let par = 0;
    let impar = 0;
    for (let i = 0; i < 7; i++) {
      const n = parseInt(digitos[i], 10);
      if (i % 2 === 0) {
        const doble = n * 2;
        impar += doble > 9 ? doble - 9 : doble;
      } else {
        par += n;
      }
    }
    const control = (10 - ((par + impar) % 10)) % 10;
    const ultimo = nif[8];
    // Según la letra inicial el control es número, letra, o cualquiera de los dos.
    if ("PQRSNW".includes(nif[0])) return "JABCDEFGHI"[control] === ultimo;
    if ("ABEH".includes(nif[0])) return String(control) === ultimo;
    return String(control) === ultimo || "JABCDEFGHI"[control] === ultimo;
  }

  return false;
}

const empresaSchema = z.object({
  razonSocial: z.string().min(1, "La razón social es obligatoria"),
  nif: z.string().min(8, "NIF/CIF demasiado corto"),
  direccion: z.string().min(1, "El domicilio fiscal es obligatorio"),
  codigoPostal: z.string().optional().nullable(),
  ciudad: z.string().optional().nullable(),
  provincia: z.string().optional().nullable(),
  pais: z.string().default("España"),
  email: z.string().email("Email no válido").optional().nullable().or(z.literal("")),
  telefono: z.string().optional().nullable(),
  personaContacto: z.string().optional().nullable(),
  notas: z.string().optional().nullable(),
});

// Cualquier rol puede LEER las empresas: el camarero necesita elegirla al cobrar.
empresasRouter.get("/", requireAuth, (req, res) => {
  const q = String(req.query.q ?? "").trim().toLowerCase();
  const todas = db
    .prepare(
      `SELECT * FROM empresas WHERE restaurante_id = ? AND activo = 1
        ORDER BY razon_social`
    )
    .all(RESTAURANTE_ID) as Record<string, string>[];
  if (!q) return res.json(todas);
  res.json(
    todas.filter(
      (e) =>
        e.razon_social.toLowerCase().includes(q) ||
        e.nif.toLowerCase().includes(q)
    )
  );
});

empresasRouter.post("/", requireAuth, requireRole("admin"), (req, res) => {
  const parsed = empresaSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());
  const d = parsed.data;
  const nif = d.nif.toUpperCase().replace(/[\s-]/g, "");

  if (!nifValido(nif)) {
    return res.status(400).json({
      error: `El NIF/CIF "${nif}" no es válido (dígito de control incorrecto). Compruébalo: si es erróneo, el cliente no podrá deducir el IVA.`,
    });
  }

  const duplicado = db
    .prepare(`SELECT razon_social FROM empresas WHERE restaurante_id = ? AND nif = ? AND activo = 1`)
    .get(RESTAURANTE_ID, nif) as { razon_social: string } | undefined;
  if (duplicado) {
    return res.status(409).json({ error: `Ese NIF ya está dado de alta como "${duplicado.razon_social}"` });
  }

  const id = uuid();
  db.prepare(
    `INSERT INTO empresas (id, restaurante_id, razon_social, nif, direccion, codigo_postal,
                           ciudad, provincia, pais, email, telefono, persona_contacto, notas,
                           activo, creado_en)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`
  ).run(
    id, RESTAURANTE_ID, d.razonSocial, nif, d.direccion, d.codigoPostal ?? null,
    d.ciudad ?? null, d.provincia ?? null, d.pais, d.email || null, d.telefono ?? null,
    d.personaContacto ?? null, d.notas ?? null, new Date().toISOString()
  );
  res.status(201).json({ id, ...d, nif });
});

empresasRouter.put("/:id", requireAuth, requireRole("admin"), (req, res) => {
  const parsed = empresaSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());
  const d = parsed.data;
  const nif = d.nif.toUpperCase().replace(/[\s-]/g, "");
  if (!nifValido(nif)) {
    return res.status(400).json({ error: `El NIF/CIF "${nif}" no es válido (dígito de control incorrecto)` });
  }

  const info = db
    .prepare(
      `UPDATE empresas SET razon_social = ?, nif = ?, direccion = ?, codigo_postal = ?,
              ciudad = ?, provincia = ?, pais = ?, email = ?, telefono = ?,
              persona_contacto = ?, notas = ?
        WHERE id = ? AND restaurante_id = ?`
    )
    .run(
      d.razonSocial, nif, d.direccion, d.codigoPostal ?? null, d.ciudad ?? null,
      d.provincia ?? null, d.pais, d.email || null, d.telefono ?? null,
      d.personaContacto ?? null, d.notas ?? null, req.params.id, RESTAURANTE_ID
    );
  if (info.changes === 0) return res.status(404).json({ error: "Empresa no encontrada" });
  res.json({ id: req.params.id });
});

// Baja lógica, NO borrado: las facturas ya emitidas apuntan a esta empresa y
// deben conservarse 4 años como mínimo (prescripción fiscal).
empresasRouter.delete("/:id", requireAuth, requireRole("admin"), (req, res) => {
  const info = db
    .prepare(`UPDATE empresas SET activo = 0 WHERE id = ? AND restaurante_id = ?`)
    .run(req.params.id, RESTAURANTE_ID);
  if (info.changes === 0) return res.status(404).json({ error: "Empresa no encontrada" });
  res.status(204).end();
});

// Historial de facturas de una empresa: lo típico que pide el cliente a fin de mes.
empresasRouter.get("/:id/facturas", requireAuth, requireRole("admin"), (req, res) => {
  const facturas = db
    .prepare(
      `SELECT id, serie, numero, ejercicio, fecha_expedicion, base_imponible,
              cuota_iva, total, metodo_pago, anulada
         FROM facturas WHERE empresa_id = ? ORDER BY ejercicio DESC, numero DESC`
    )
    .all(req.params.id);
  res.json(facturas);
});
