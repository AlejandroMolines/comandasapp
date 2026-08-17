/**
 * crypto.randomUUID() solo existe en contextos seguros (HTTPS o localhost).
 * Desde el móvil accedemos por http://192.168.x.x — no es "seguro" para el
 * navegador aunque estemos en la LAN — así que randomUUID no existe ahí.
 * Este helper usa el nativo si está disponible y si no, genera un v4 a mano
 * con crypto.getRandomValues (eso sí funciona siempre, con o sin HTTPS).
 */
export function uuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // versión 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variante
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
