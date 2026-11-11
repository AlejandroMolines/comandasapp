export interface InterfazRed {
  nombre: string;
  direccion: string;
  interna: boolean;
  familia: string;
}

const VIRTUAL = /^(lo|docker|veth|virbr|br-|cni|flannel|cali|tun|tap|tailscale|zt|wg|utun)/i;

function esPrivada(ip: string): boolean {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n))) return false;
  if (p[0] === 10) return true;
  if (p[0] === 192 && p[1] === 168) return true;
  if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
  return false;
}

/**
 * Elige la IPv4 que un móvil en la WiFi del local puede abrir.
 * Ignora loopback, Docker y túneles. Si el Raspberry hace de punto de acceso,
 * su WiFi suele ser la interfaz wlan con dirección .1: esa gana. Si no, se
 * prefiere la WiFi del cliente y, en último caso, el cable (el router hace
 * de puente y el móvil llega igual).
 */
export function elegirIpLan(interfaces: InterfazRed[]): string | null {
  const fisicas = interfaces.filter((i) => {
    const v4 = i.familia === "IPv4" || i.familia === "4";
    return v4 && !i.interna && !i.direccion.startsWith("169.254.") && !VIRTUAL.test(i.nombre);
  });
  const privadas = fisicas.filter((i) => esPrivada(i.direccion));
  const pool = privadas.length > 0 ? privadas : fisicas;
  if (pool.length === 0) return null;

  const puntoDeAcceso = pool.find(
    (i) => /^(wlan|wlx|wlp|wl|ap|uap)/i.test(i.nombre) && i.direccion.endsWith(".1")
  );
  if (puntoDeAcceso) return puntoDeAcceso.direccion;

  const wifi = pool.find((i) => /^(wlan|wlx|wlp|wl|ap|uap)/i.test(i.nombre));
  if (wifi) return wifi.direccion;

  const cable = pool.find((i) => /^(eth|en|end)/i.test(i.nombre));
  return (cable ?? pool[0]).direccion;
}
