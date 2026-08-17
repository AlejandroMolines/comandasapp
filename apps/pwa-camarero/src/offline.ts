import { get, set } from "idb-keyval";
import { api, ApiError } from "./api";

// ---------------------------------------------------------------------------
// Cache de datos maestros (carta, mesas, zonas) para operar sin red
// ---------------------------------------------------------------------------

export interface CartaCompleta {
  menus: { id: string; nombre: string }[];
  categorias: { id: string; menu_id: string; categoria_padre_id: string | null; nombre: string; orden: number }[];
  productos: { id: string; categoria_id: string; nombre: string; precio: number; disponible: number }[];
}
export interface Zona { id: string; nombre: string; orden: number }
export interface Mesa { id: string; zona_id: string; nombre: string; estado: string }

export async function cargarMaestros(): Promise<{ carta: CartaCompleta; zonas: Zona[]; mesas: Mesa[] }> {
  try {
    const [carta, zonas, mesas] = await Promise.all([
      api<CartaCompleta>("/carta/completa"),
      api<Zona[]>("/espacios/zonas"),
      api<Mesa[]>("/espacios/mesas"),
    ]);
    // Red OK: refrescamos la copia local.
    await set("carta", carta);
    await set("zonas", zonas);
    await set("mesas", mesas);
    return { carta, zonas, mesas };
  } catch {
    // Sin red: servimos la última copia conocida (si existe).
    const carta = await get<CartaCompleta>("carta");
    const zonas = await get<Zona[]>("zonas");
    const mesas = await get<Mesa[]>("mesas");
    if (!carta || !zonas || !mesas) throw new Error("Sin conexión y sin datos cacheados");
    return { carta, zonas, mesas };
  }
}

// ---------------------------------------------------------------------------
// Cola outbox: acciones pendientes de entregar al backend
// ---------------------------------------------------------------------------
// FIFO estricta: una "abrir comanda" siempre viaja antes que sus rondas.
// Cada acción lleva UUID generado aquí, así el backend puede deduplicar
// reintentos (POST /comandas ya acepta `id` del cliente).

export type AccionPendiente =
  | { uuid: string; tipo: "abrir_comanda"; payload: { id: string; turnoId: string; mesaId: string | null; tipo: string } }
  | {
      uuid: string;
      tipo: "enviar_ronda";
      payload: {
        comandaId: string;
        lineas: { productoId: string; cantidad: number; notas?: string; extraIds?: string[] }[];
        /** false = solo guardar en la cuenta, sin sacar papel */
        imprimir?: boolean;
      };
    };

const KEY_COLA = "cola-acciones";

export async function encolar(accion: AccionPendiente) {
  const cola = (await get<AccionPendiente[]>(KEY_COLA)) ?? [];
  cola.push(accion);
  await set(KEY_COLA, cola);
  notificar(cola.length);
  void vaciarCola();
}

export async function pendientes(): Promise<number> {
  return ((await get<AccionPendiente[]>(KEY_COLA)) ?? []).length;
}

// Si ya hay un vaciado en marcha, devolvemos ESA misma promesa en vez de
// salir de vacío: así quien haga "await vaciarCola()" (p.ej. al pulsar
// Cobrar) espera de verdad a que la cola termine, y no recibe un falso
// "quedan acciones pendientes" solo porque coincidió con el ciclo de los 3s.
let vaciando: Promise<void> | null = null;

export function vaciarCola(): Promise<void> {
  if (vaciando) return vaciando;
  vaciando = vaciarColaInterno().finally(() => { vaciando = null; });
  return vaciando;
}

async function vaciarColaInterno(): Promise<void> {
  {
    let cola = (await get<AccionPendiente[]>(KEY_COLA)) ?? [];
    while (cola.length > 0) {
      const accion = cola[0];
      try {
        if (accion.tipo === "abrir_comanda") {
          const r = await api<{ id: string }>("/comandas", { method: "POST", body: accion.payload });
          // El servidor puede devolver OTRA comanda: si la mesa ya estaba
          // abierta (p.ej. otro camarero la abrió mientras estábamos sin red),
          // manda la que ya existe. Hay que adoptar ese id en las rondas que
          // quedan por enviar, o irían a una comanda que no existe -> 404.
          const idPedido = (accion.payload as { id?: string }).id;
          if (r?.id && idPedido && r.id !== idPedido) {
            for (const pendiente of cola) {
              if (pendiente.tipo === "enviar_ronda" && pendiente.payload.comandaId === idPedido) {
                pendiente.payload.comandaId = r.id;
              }
            }
          }
        } else {
          await api(`/comandas/${accion.payload.comandaId}/rondas`, {
            method: "POST",
            body: { lineas: accion.payload.lineas, imprimir: accion.payload.imprimir ?? true },
          });
        }
        cola.shift();
        await set(KEY_COLA, cola);
        notificar(cola.length);
      } catch (err) {
        // Error de negocio (400/404/409): la acción nunca va a poder aplicarse.
        // La descartamos y avisamos, para no bloquear el resto de la cola.
        if (err instanceof ApiError && err.status >= 400 && err.status < 500) {
          console.error("Acción descartada:", accion, err.message);
          cola.shift();
          await set(KEY_COLA, cola);
          notificar(cola.length, `Acción rechazada: ${err.message}`);
          continue;
        }
        // Error de red / 5xx: paramos y reintentamos en el próximo ciclo.
        break;
      }
    }
  }
}

// Reintento periódico + al recuperar conectividad.
setInterval(() => void vaciarCola(), 3000);
window.addEventListener("online", () => void vaciarCola());

// Suscripción ligera para que la UI muestre el contador de pendientes.
type Listener = (pendientes: number, aviso?: string) => void;
const listeners = new Set<Listener>();
export function onCola(l: Listener) {
  listeners.add(l);
  return () => listeners.delete(l);
}
function notificar(n: number, aviso?: string) {
  listeners.forEach((l) => l(n, aviso));
}
