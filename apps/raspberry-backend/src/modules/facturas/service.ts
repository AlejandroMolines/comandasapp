import { db } from "../../db/connection.js";
import { getAjuste } from "../ajustes/routes.js";
import { v4 as uuid } from "uuid";

const RESTAURANTE_ID = process.env.RESTAURANTE_ID ?? "restaurante-demo";

export interface LineaFactura {
  nombre: string;
  cantidad: number;
  precio_unitario: number; // CON IVA incluido (precio de carta)
  tipo_iva: number;
}

export interface DesgloseIva {
  tipo: number;
  base: number;
  cuota: number;
}

/** Redondeo a 2 decimales evitando los sustos del coma flotante. */
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Calcula el desglose de IVA a partir de precios CON IVA incluido.
 * En España el precio de carta debe mostrarse con IVA, así que hay que
 * "desandar" el cálculo: base = total / (1 + tipo/100).
 * Se agrupa por tipo porque una misma cuenta puede llevar comida al 10% y
 * bebidas alcohólicas al 21%, y la factura exige un desglose por cada tipo.
 */
export function calcularDesglose(lineas: LineaFactura[]): {
  desglose: DesgloseIva[];
  baseImponible: number;
  cuotaIva: number;
  total: number;
} {
  const porTipo = new Map<number, number>(); // tipo -> total con IVA

  for (const l of lineas) {
    const totalLinea = l.cantidad * l.precio_unitario;
    porTipo.set(l.tipo_iva, (porTipo.get(l.tipo_iva) ?? 0) + totalLinea);
  }

  const desglose: DesgloseIva[] = [];
  for (const [tipo, totalConIva] of [...porTipo.entries()].sort((a, b) => a[0] - b[0])) {
    const base = r2(totalConIva / (1 + tipo / 100));
    const cuota = r2(totalConIva - base);
    desglose.push({ tipo, base, cuota });
  }

  const baseImponible = r2(desglose.reduce((a, d) => a + d.base, 0));
  const cuotaIva = r2(desglose.reduce((a, d) => a + d.cuota, 0));
  return { desglose, baseImponible, cuotaIva, total: r2(baseImponible + cuotaIva) };
}

/** Datos fiscales del restaurante (emisor). Se guardan en ajustes. */
export function datosEmisor() {
  return {
    razonSocial: getAjuste("fiscal_razon_social"),
    nif: getAjuste("fiscal_nif"),
    direccion: getAjuste("fiscal_direccion"),
    serie: getAjuste("fiscal_serie") || "FAC",
  };
}

export class ErrorFactura extends Error {}

/**
 * Emite una factura completa. Pensado para llamarse DENTRO de la transacción
 * del pago, para que no pueda existir un pago con factura a medias.
 *
 * La numeración correlativa es el punto delicado: la ley exige que no haya
 * saltos ni duplicados dentro de una serie y ejercicio. Se calcula con
 * MAX(numero)+1 leyendo dentro de la misma transacción, y la restricción
 * UNIQUE de la tabla actúa de red de seguridad si algo se colara.
 */
export function emitirFactura(opts: {
  empresaId: string;
  comandaId: string;
  pagoId: string | null;
  lineas: LineaFactura[];
  metodoPago: string;
}) {
  const emisor = datosEmisor();
  if (!emisor.razonSocial || !emisor.nif || !emisor.direccion) {
    throw new ErrorFactura(
      "Faltan los datos fiscales del restaurante. Rellénalos en Panel → Ajustes → Datos fiscales antes de emitir facturas."
    );
  }

  const empresa = db
    .prepare(`SELECT * FROM empresas WHERE id = ? AND restaurante_id = ? AND activo = 1`)
    .get(opts.empresaId, RESTAURANTE_ID) as Record<string, string> | undefined;
  if (!empresa) throw new ErrorFactura("La empresa indicada no existe");

  if (opts.lineas.length === 0) throw new ErrorFactura("No se puede facturar una cuenta vacía");

  const { desglose, baseImponible, cuotaIva, total } = calcularDesglose(opts.lineas);
  const ahora = new Date();
  const ejercicio = ahora.getFullYear();

  const ultimo = db
    .prepare(
      `SELECT COALESCE(MAX(numero), 0) AS n FROM facturas
        WHERE restaurante_id = ? AND serie = ? AND ejercicio = ?`
    )
    .get(RESTAURANTE_ID, emisor.serie, ejercicio) as { n: number };
  const numero = ultimo.n + 1;

  const id = uuid();
  const direccionCliente = [
    empresa.direccion,
    empresa.codigo_postal,
    empresa.ciudad,
    empresa.provincia,
  ].filter(Boolean).join(", ");

  db.prepare(
    `INSERT INTO facturas (id, restaurante_id, serie, numero, ejercicio, empresa_id,
                           comanda_id, pago_id, fecha_expedicion,
                           emisor_razon_social, emisor_nif, emisor_direccion,
                           cliente_razon_social, cliente_nif, cliente_direccion,
                           base_imponible, cuota_iva, total, desglose_iva,
                           metodo_pago, anulada, creado_en)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`
  ).run(
    id, RESTAURANTE_ID, emisor.serie, numero, ejercicio, opts.empresaId,
    opts.comandaId, opts.pagoId, ahora.toISOString(),
    emisor.razonSocial, emisor.nif, emisor.direccion,
    empresa.razon_social, empresa.nif, direccionCliente,
    baseImponible, cuotaIva, total, JSON.stringify(desglose),
    opts.metodoPago, ahora.toISOString()
  );

  return {
    id,
    numeroCompleto: `${emisor.serie}-${ejercicio}/${String(numero).padStart(5, "0")}`,
    serie: emisor.serie,
    numero,
    ejercicio,
    fechaExpedicion: ahora.toISOString(),
    emisor,
    cliente: {
      razonSocial: empresa.razon_social,
      nif: empresa.nif,
      direccion: direccionCliente,
    },
    lineas: opts.lineas,
    desglose,
    baseImponible,
    cuotaIva,
    total,
    metodoPago: opts.metodoPago,
  };
}
