import * as XLSX from "xlsx";
import { api } from "./api";

export type Agrupacion = "dia" | "semana" | "mes";

interface Informe {
  desde: string;
  hasta: string;
  agrupacion: Agrupacion;
  filas: {
    periodo: string; numPagos: number; comandas: number; mesas: number; llevar: number;
    efectivo: number; tarjeta: number; otro: number; total: number; propinas: number;
  }[];
  totales: {
    efectivo: number; tarjeta: number; otro: number; total: number; propinas: number;
    comandas: number; mesas: number; llevar: number; ticketMedio: number;
  };
  turnos: {
    abierto_en: string; cerrado_en: string; cajaInicial: number;
    efectivoCobrado: number; efectivoEsperado: number;
    cajaContada: number | null; descuadre: number | null;
  }[];
  productos: { nombre: string; tipo_iva: number; unidades: number; importe: number }[];
  desgloseIva: { tipo: number; base: number; cuota: number; total: number }[];
  facturas: {
    serie: string; numero: number; ejercicio: number; fecha_expedicion: string;
    cliente_razon_social: string; cliente_nif: string;
    base_imponible: number; cuota_iva: number; total: number; metodo_pago: string | null;
  }[];
}

const ETIQUETA_PERIODO: Record<Agrupacion, string> = {
  dia: "Día",
  semana: "Semana",
  mes: "Mes",
};

/** dd/mm/aaaa a partir de un ISO o de un AAAA-MM-DD */
const fechaCorta = (v: string) => v.slice(0, 10).split("-").reverse().join("/");
const horaCorta = (v: string) => v.slice(11, 16);

/**
 * Descarga un .xlsx con el resumen del periodo.
 * Se genera en el navegador (SheetJS) en vez de en el Raspberry: así no
 * cargamos la Pi con generación de ficheros y funciona igual sin internet.
 */
export async function descargarInforme(desde: string, hasta: string, agrupacion: Agrupacion) {
  const d = await api<Informe>(
    `/turnos/informe?desde=${desde}&hasta=${hasta}&agrupacion=${agrupacion}`
  );

  const libro = XLSX.utils.book_new();
  const etiqueta = ETIQUETA_PERIODO[agrupacion];

  // ── Hoja 1: Ingresos por periodo ──
  const ingresos: (string | number)[][] = [
    ["INFORME DE INGRESOS"],
    [`Del ${fechaCorta(desde)} al ${fechaCorta(hasta)}`, "", `Agrupado por: ${etiqueta.toLowerCase()}`],
    [],
    [etiqueta, "Efectivo", "Tarjeta", "Otros", "TOTAL", "Propinas", "Comandas", "Mesas", "Para llevar", "Ticket medio"],
  ];
  for (const f of d.filas) {
    ingresos.push([
      agrupacion === "dia" ? fechaCorta(f.periodo) : f.periodo,
      f.efectivo, f.tarjeta, f.otro, f.total, f.propinas,
      f.comandas, f.mesas, f.llevar,
      f.comandas ? Number((f.total / f.comandas).toFixed(2)) : 0,
    ]);
  }
  ingresos.push([]);
  ingresos.push([
    "TOTAL",
    d.totales.efectivo, d.totales.tarjeta, d.totales.otro, d.totales.total,
    d.totales.propinas, d.totales.comandas, d.totales.mesas, d.totales.llevar,
    d.totales.ticketMedio,
  ]);

  const hIngresos = XLSX.utils.aoa_to_sheet(ingresos);
  hIngresos["!cols"] = [{ wch: 14 }, { wch: 11 }, { wch: 11 }, { wch: 10 }, { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 8 }, { wch: 12 }, { wch: 13 }];
  XLSX.utils.book_append_sheet(libro, hIngresos, "Ingresos");

  // ── Hoja 2: Cierres de caja (con la caja inicial, que es lo que pediste) ──
  const cajas: (string | number)[][] = [
    ["CIERRES DE CAJA"],
    [],
    ["Fecha", "Apertura", "Cierre", "Caja inicial", "Efectivo cobrado", "Efectivo esperado", "Caja contada", "Descuadre"],
  ];
  for (const t of d.turnos) {
    cajas.push([
      fechaCorta(t.abierto_en),
      horaCorta(t.abierto_en),
      horaCorta(t.cerrado_en),
      t.cajaInicial,
      t.efectivoCobrado,
      t.efectivoEsperado,
      t.cajaContada ?? "",
      t.descuadre ?? "",
    ]);
  }
  if (d.turnos.length === 0) cajas.push(["(sin turnos cerrados en el periodo)"]);
  else {
    cajas.push([]);
    cajas.push([
      "TOTAL", "", "",
      d.turnos.reduce((a, t) => a + t.cajaInicial, 0),
      d.turnos.reduce((a, t) => a + t.efectivoCobrado, 0),
      d.turnos.reduce((a, t) => a + t.efectivoEsperado, 0),
      d.turnos.reduce((a, t) => a + (t.cajaContada ?? 0), 0),
      d.turnos.reduce((a, t) => a + (t.descuadre ?? 0), 0),
    ]);
  }
  const hCajas = XLSX.utils.aoa_to_sheet(cajas);
  hCajas["!cols"] = [{ wch: 12 }, { wch: 9 }, { wch: 9 }, { wch: 13 }, { wch: 16 }, { wch: 17 }, { wch: 13 }, { wch: 11 }];
  XLSX.utils.book_append_sheet(libro, hCajas, "Cierres de caja");

  // ── Hoja 3: IVA (para el trimestre) ──
  const ivaFilas: (string | number)[][] = [
    ["DESGLOSE DE IVA DEL PERIODO"],
    ["Calculado sobre precios con IVA incluido"],
    [],
    ["Tipo IVA", "Base imponible", "Cuota IVA", "Total con IVA"],
  ];
  for (const i of d.desgloseIva) {
    ivaFilas.push([`${i.tipo}%`, i.base, i.cuota, i.total]);
  }
  ivaFilas.push([]);
  ivaFilas.push([
    "TOTAL",
    d.desgloseIva.reduce((a, i) => a + i.base, 0),
    d.desgloseIva.reduce((a, i) => a + i.cuota, 0),
    d.desgloseIva.reduce((a, i) => a + i.total, 0),
  ]);
  const hIva = XLSX.utils.aoa_to_sheet(ivaFilas);
  hIva["!cols"] = [{ wch: 10 }, { wch: 15 }, { wch: 12 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(libro, hIva, "IVA");

  // ── Hoja 4: Productos vendidos ──
  const prods: (string | number)[][] = [
    ["PRODUCTOS VENDIDOS"],
    [],
    ["Producto", "IVA", "Unidades", "Importe"],
  ];
  for (const p of d.productos) prods.push([p.nombre, `${p.tipo_iva}%`, p.unidades, Number(p.importe.toFixed(2))]);
  if (d.productos.length === 0) prods.push(["(sin ventas en el periodo)"]);
  const hProds = XLSX.utils.aoa_to_sheet(prods);
  hProds["!cols"] = [{ wch: 30 }, { wch: 7 }, { wch: 10 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(libro, hProds, "Productos");

  // ── Hoja 5: Facturas emitidas (solo si hay) ──
  if (d.facturas.length > 0) {
    const facs: (string | number)[][] = [
      ["FACTURAS EMITIDAS A EMPRESAS"],
      [],
      ["Número", "Fecha", "Cliente", "NIF", "Base imponible", "Cuota IVA", "Total", "Forma de pago"],
    ];
    for (const f of d.facturas) {
      facs.push([
        `${f.serie}-${f.ejercicio}/${String(f.numero).padStart(5, "0")}`,
        fechaCorta(f.fecha_expedicion),
        f.cliente_razon_social,
        f.cliente_nif,
        f.base_imponible,
        f.cuota_iva,
        f.total,
        f.metodo_pago ?? "",
      ]);
    }
    facs.push([]);
    facs.push([
      "TOTAL", "", "", "",
      d.facturas.reduce((a, f) => a + f.base_imponible, 0),
      d.facturas.reduce((a, f) => a + f.cuota_iva, 0),
      d.facturas.reduce((a, f) => a + f.total, 0),
      "",
    ]);
    const hFacs = XLSX.utils.aoa_to_sheet(facs);
    hFacs["!cols"] = [{ wch: 17 }, { wch: 12 }, { wch: 32 }, { wch: 12 }, { wch: 15 }, { wch: 11 }, { wch: 11 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(libro, hFacs, "Facturas");
  }

  const sufijo = agrupacion === "dia" ? "diario" : agrupacion === "semana" ? "semanal" : "mensual";
  XLSX.writeFile(libro, `informe-${sufijo}-${desde}_${hasta}.xlsx`);
}

/** Rangos de fecha habituales, ya calculados. */
export function rangoPreset(preset: "hoy" | "ayer" | "semana" | "mes" | "mes-pasado") {
  const hoy = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);

  if (preset === "hoy") return { desde: iso(hoy), hasta: iso(hoy) };

  if (preset === "ayer") {
    const a = new Date(hoy);
    a.setDate(a.getDate() - 1);
    return { desde: iso(a), hasta: iso(a) };
  }

  if (preset === "semana") {
    // Semana en curso empezando en lunes (como se cuenta en España).
    const l = new Date(hoy);
    const dia = (l.getDay() + 6) % 7; // 0 = lunes
    l.setDate(l.getDate() - dia);
    return { desde: iso(l), hasta: iso(hoy) };
  }

  if (preset === "mes") {
    return { desde: iso(new Date(hoy.getFullYear(), hoy.getMonth(), 1)), hasta: iso(hoy) };
  }

  // mes-pasado: del 1 al último día del mes anterior
  const primero = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1);
  const ultimo = new Date(hoy.getFullYear(), hoy.getMonth(), 0);
  return { desde: iso(primero), hasta: iso(ultimo) };
}
