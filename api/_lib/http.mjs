import { clasificarPulso, tokenPresentado, tokenValido } from "./estado.mjs";
import { guardarPulso, leerMapa, modoPersistencia } from "./store.mjs";

export function enviar(res, codigo, datos) {
  if (typeof res.status === "function" && typeof res.json === "function") {
    res.status(codigo).json(datos);
    return;
  }
  res.writeHead(codigo, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(datos));
}

export async function leerCuerpo(req) {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === "string" && req.body) return JSON.parse(req.body);
  const trozos = [];
  for await (const trozo of req) trozos.push(trozo);
  if (trozos.length === 0) return {};
  const texto = Buffer.concat(trozos.map((t) => Buffer.from(t))).toString("utf8");
  if (!texto) return {};
  return JSON.parse(texto);
}

function texto(valor, max) {
  if (typeof valor !== "string") return "";
  return valor.trim().slice(0, max);
}

export function normalizarPulso(body) {
  const restauranteId = texto(body?.restauranteId, 80);
  if (!/^[A-Za-z0-9_-]+$/.test(restauranteId)) {
    return { error: "restauranteId inválido" };
  }
  const nombre = texto(body?.nombre, 120);
  if (!nombre) return { error: "Falta el nombre del local" };
  const impresoras = Array.isArray(body?.impresoras) ? body.impresoras.slice(0, 40) : [];
  return {
    pulso: {
      restauranteId,
      nombre,
      version: texto(body?.version, 40) || "local",
      mesasOcupadas: entero(body?.mesasOcupadas),
      comandasAbiertas: entero(body?.comandasAbiertas),
      impresoras: impresoras
        .map((i) => ({
          nombre: texto(i?.nombre, 80) || "Impresora",
          estado: texto(i?.estado, 20) || "desconocido",
        })),
      recibidoEn: new Date().toISOString(),
    },
  };
}

function entero(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v < 0) return 0;
  return Math.min(9999, Math.round(v));
}

export async function recibirPulso(req, res) {
  if (req.method === "OPTIONS") return enviar(res, 204, {});
  if (req.method !== "POST") return enviar(res, 405, { error: "Usa POST" });

  const esperado = process.env.NUBE_TOKEN ?? "";
  if (!esperado) {
    return enviar(res, 503, {
      error: "La central no tiene NUBE_TOKEN. Añádelo en las variables de Vercel y en el Raspberry.",
    });
  }
  if (!tokenValido(tokenPresentado(req), esperado)) {
    return enviar(res, 401, { error: "Token de la central incorrecto" });
  }

  let body;
  try {
    body = await leerCuerpo(req);
  } catch {
    return enviar(res, 400, { error: "JSON inválido" });
  }
  const parsed = normalizarPulso(body);
  if (parsed.error) return enviar(res, 400, { error: parsed.error });

  try {
    await guardarPulso(parsed.pulso);
  } catch (err) {
    console.error("[nube] no se pudo guardar el pulso:", err);
    return enviar(res, 500, { error: "No se pudo guardar el estado del local" });
  }
  return enviar(res, 200, { ok: true, persistencia: modoPersistencia() });
}

export async function listarRestaurantes(_req, res) {
  let mapa = {};
  let aviso = "";
  try {
    mapa = await leerMapa();
  } catch (err) {
    console.error("[nube] no se pudo leer el estado:", err);
    aviso = "No se pudo leer el almacén. Revisa DATABASE_URL o las claves de KV.";
  }
  const modo = modoPersistencia();
  if (!aviso && modo === "memoria") {
    aviso = "Sin base de datos el estado vive en memoria y se borra si Vercel apaga la función. Añade DATABASE_URL (Postgres) o KV_REST_API_URL y KV_REST_API_TOKEN.";
  }
  const ahora = Date.now();
  const restaurantes = Object.values(mapa)
    .map((p) => ({
      ...p,
      estado: clasificarPulso(p.recibidoEn, ahora),
      segundos: Math.max(0, Math.round((ahora - Date.parse(p.recibidoEn)) / 1000)),
    }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  return enviar(res, 200, {
    ahora: new Date(ahora).toISOString(),
    persistencia: modo,
    configurada: Boolean(process.env.NUBE_TOKEN),
    aviso,
    restaurantes,
  });
}
