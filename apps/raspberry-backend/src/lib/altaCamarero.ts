import { firmarPayload, leerToken } from "./secretos.js";

/** El QR cambia al terminar esta ventana. El anterior sigue valiendo 30 s. */
export const VENTANA_ALTA_SEGUNDOS = 180;
const GRACIA_SEGUNDOS = 30;

export interface AltaFirmada {
  token: string;
  exp: number;
  expiraEn: string;
}

export function firmarAlta(restauranteId: string, ahora = Date.now()): AltaFirmada {
  const exp = Math.ceil(ahora / 1000 / VENTANA_ALTA_SEGUNDOS) * VENTANA_ALTA_SEGUNDOS;
  const token = firmarPayload({ tipo: "alta-camarero", restauranteId, exp });
  return { token, exp, expiraEn: new Date(exp * 1000).toISOString() };
}

export function leerAlta(
  token: string,
  restauranteId: string,
  ahora = Date.now()
): { restauranteId: string; exp: number } | null {
  const payload = leerToken<{ tipo?: string; restauranteId?: string; exp?: number }>(token);
  if (!payload || payload.tipo !== "alta-camarero" || payload.restauranteId !== restauranteId) return null;
  if (typeof payload.exp !== "number" || !Number.isFinite(payload.exp)) return null;
  const ahoraS = Math.floor(ahora / 1000);
  if (payload.exp + GRACIA_SEGUNDOS < ahoraS) return null;
  if (payload.exp > ahoraS + VENTANA_ALTA_SEGUNDOS) return null;
  return { restauranteId: payload.restauranteId, exp: payload.exp };
}
