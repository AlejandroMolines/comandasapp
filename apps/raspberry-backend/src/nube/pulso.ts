import { db } from "../db/connection.js";

const CADA_MS = 30_000;

type Impresora = { nombre: string; estado: string };

/** Foto corta del local. No lleva ventas ni datos de clientes. */
export function fotoLocal() {
  const rest = db.prepare(`SELECT id, nombre FROM restaurantes LIMIT 1`).get() as
    | { id: string; nombre: string }
    | undefined;
  const mesas = db.prepare(`SELECT COUNT(*) AS n FROM mesas WHERE estado = 'ocupada'`).get() as { n: number };
  const comandas = db
    .prepare(`SELECT COUNT(*) AS n FROM comandas WHERE estado NOT IN ('cerrada','cancelada')`)
    .get() as { n: number };
  const impresoras = db
    .prepare(`SELECT nombre, estado_salud AS estado FROM puntos_destino ORDER BY nombre`)
    .all() as Impresora[];

  return {
    restauranteId: process.env.RESTAURANTE_ID ?? rest?.id ?? "restaurante-demo",
    nombre: rest?.nombre ?? "Restaurante",
    version: "local",
    mesasOcupadas: mesas.n,
    comandasAbiertas: comandas.n,
    impresoras,
  };
}

/**
 * Avisa a la central de Vercel de que este local sigue vivo.
 * Si NUBE_URL o NUBE_TOKEN no están, no hace nada: el bar no depende de internet.
 */
export function iniciarPulso() {
  const base = (process.env.NUBE_URL ?? "").replace(/\/$/, "");
  const token = process.env.NUBE_TOKEN ?? "";
  if (!base || !token) return;

  let fallos = 0;
  const tick = async () => {
    try {
      const res = await fetch(`${base}/api/pulso`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(fotoLocal()),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (fallos > 0) console.log("[nube] la central vuelve a recibir avisos");
      fallos = 0;
    } catch (err) {
      fallos += 1;
      if (fallos === 1 || fallos % 10 === 0) {
        console.warn(`[nube] no se pudo avisar a la central (${fallos}): ${(err as Error).message}`);
      }
    }
  };

  setTimeout(() => void tick(), 5000);
  setInterval(() => void tick(), CADA_MS);
  console.log(`[nube] avisando a ${base} cada ${CADA_MS / 1000}s`);
}
