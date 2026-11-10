import { db } from "../db/connection.js";

export const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Euros a restar del bruto. El porcentaje se aplica sobre lo no anulado. */
export function importeDescuento(bruto: number, tipo: string | null, valor: number): number {
  if (!tipo || valor <= 0 || bruto <= 0) return 0;
  if (tipo === "porcentaje") return r2((bruto * Math.min(valor, 100)) / 100);
  if (tipo === "importe") return r2(Math.min(valor, bruto));
  return 0;
}

export interface ResumenCuenta {
  bruto: number;
  unidades: number;
  descuento: number;
  descuentoTipo: string | null;
  descuentoValor: number;
  descuentoMotivo: string | null;
  total: number;
  pagado: number;
  pendiente: number;
}

/** Total cobrable: líneas no anuladas menos el descuento de la comanda. */
export function resumenCuenta(comandaId: string): ResumenCuenta {
  const fila = db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN COALESCE(anulada, 0) = 0 THEN cantidad * precio_unitario ELSE 0 END), 0) AS bruto,
              COALESCE(SUM(CASE WHEN COALESCE(anulada, 0) = 0 THEN cantidad ELSE 0 END), 0) AS unidades
         FROM lineas_comanda WHERE comanda_id = ?`
    )
    .get(comandaId) as { bruto: number; unidades: number };

  const desc = db
    .prepare(
      `SELECT descuento_tipo AS tipo, COALESCE(descuento_valor, 0) AS valor, descuento_motivo AS motivo
         FROM comandas WHERE id = ?`
    )
    .get(comandaId) as { tipo: string | null; valor: number; motivo: string | null } | undefined;

  const bruto = r2(fila.bruto);
  const descuento = importeDescuento(bruto, desc?.tipo ?? null, desc?.valor ?? 0);
  const total = r2(Math.max(0, bruto - descuento));
  const pagadoFila = db
    .prepare(`SELECT COALESCE(SUM(importe), 0) AS total FROM pagos WHERE comanda_id = ?`)
    .get(comandaId) as { total: number };
  const pagado = r2(pagadoFila.total);

  return {
    bruto,
    unidades: fila.unidades,
    descuento,
    descuentoTipo: desc?.tipo ?? null,
    descuentoValor: desc?.valor ?? 0,
    descuentoMotivo: desc?.motivo ?? null,
    total,
    pagado,
    pendiente: r2(total - pagado),
  };
}
