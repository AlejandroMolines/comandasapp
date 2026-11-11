const VENTANA_MS = 15 * 60 * 1000;
const MAX_POR_CREDENCIAL = 5;
const MAX_POR_IP = 100;
const MAX_BUCKETS = 10_000;

type Bucket = { intentos: number; reiniciaEn: number };
const buckets = new Map<string, Bucket>();

function podar(ahora: number) {
  if (buckets.size < MAX_BUCKETS) return;
  for (const [clave, bucket] of buckets) {
    if (bucket.reiniciaEn <= ahora) buckets.delete(clave);
  }
  while (buckets.size >= MAX_BUCKETS) {
    const primero = buckets.keys().next().value as string | undefined;
    if (!primero) break;
    buckets.delete(primero);
  }
}

function bucket(clave: string, ahora: number): Bucket {
  let actual = buckets.get(clave);
  if (!actual || actual.reiniciaEn <= ahora) {
    podar(ahora);
    actual = { intentos: 0, reiniciaEn: ahora + VENTANA_MS };
    buckets.set(clave, actual);
  }
  return actual;
}

export function segundosBloqueo(ip: string, credencial: string): number {
  const ahora = Date.now();
  const porCredencial = bucket(`credencial:${ip}:${credencial}`, ahora);
  const porIp = bucket(`ip:${ip}`, ahora);
  if (porCredencial.intentos < MAX_POR_CREDENCIAL && porIp.intentos < MAX_POR_IP) return 0;
  return Math.max(1, Math.ceil((Math.max(porCredencial.reiniciaEn, porIp.reiniciaEn) - ahora) / 1000));
}

export function loginFallido(ip: string, credencial: string) {
  const ahora = Date.now();
  bucket(`credencial:${ip}:${credencial}`, ahora).intentos++;
  bucket(`ip:${ip}`, ahora).intentos++;
}

export function loginCorrecto(ip: string, credencial: string) {
  buckets.delete(`credencial:${ip}:${credencial}`);
}
