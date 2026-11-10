import crypto from "node:crypto";

/** Por debajo de esto, con un aviso cada 30 s, el local está al día. */
export const UMBRAL_EN_LINEA_S = 90;
/** Entre 90 s y 10 min: llegó tarde. Más de 10 min: no hay línea. */
export const UMBRAL_ATENCION_S = 10 * 60;

export function clasificarPulso(recibidoEn, ahora = Date.now()) {
  if (!recibidoEn) return "sin_conexion";
  const t = Date.parse(recibidoEn);
  if (Number.isNaN(t)) return "sin_conexion";
  const segundos = Math.max(0, Math.round((ahora - t) / 1000));
  if (segundos <= UMBRAL_EN_LINEA_S) return "en_linea";
  if (segundos <= UMBRAL_ATENCION_S) return "atencion";
  return "sin_conexion";
}

export function tokenPresentado(req) {
  const headers = req.headers ?? {};
  const auth = header(headers, "authorization");
  if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return header(headers, "x-nube-token").trim();
}

export function tokenValido(recibido, esperado) {
  if (!esperado || !recibido) return false;
  const a = Buffer.from(String(recibido));
  const b = Buffer.from(String(esperado));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function header(headers, nombre) {
  const valor = headers[nombre] ?? headers[nombre.toLowerCase()] ?? "";
  return Array.isArray(valor) ? String(valor[0] ?? "") : String(valor);
}
