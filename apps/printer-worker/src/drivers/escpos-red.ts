import net from "node:net";
import { EscPosBuilder } from "../escpos.js";
import type { DestinoDriver, PuntoDestinoRow, ResultadoEnvio, TicketData } from "../types.js";

const TIMEOUT_MS = 5000;

/** Caracteres por línea. 32 es lo estándar en papel de 58mm y también
 *  cuadra en 80mm; el separador usa este mismo ancho. */
const ANCHO = 32;

function renderTicket(ticket: TicketData): Buffer {
  const b = new EscPosBuilder().init();

  // ── FACTURA COMPLETA (cliente empresa) ─────────────────────────────────
  // Formato pensado para papel de 80mm. Lleva todo lo que exige el
  // RD 1619/2012: número correlativo de serie, fecha, datos fiscales de
  // emisor y destinatario, desglose por tipo de IVA, base y cuota.
  if (ticket.factura) {
    const f = ticket.factura;
    b.align("center").bold(true).sizeBig();
    if (ticket.esCopia) {
      b.line("*** COPIA ***");
      b.sizeNormal().line("(duplicado del original)").sizeBig();
    }
    b.line("FACTURA");
    b.sizeNormal();
    b.line(f.numeroCompleto);
    b.bold(false);
    b.line(`Fecha: ${f.fecha}`);
    b.align("left").separator();

    // Emisor
    b.bold(true).line(f.emisor.razonSocial).bold(false);
    b.line(`NIF: ${f.emisor.nif}`);
    for (const trozo of trocear(f.emisor.direccion, ANCHO)) b.line(trozo);
    b.separator();

    // Destinatario
    b.line("CLIENTE:");
    b.bold(true).line(f.cliente.razonSocial).bold(false);
    b.line(`NIF: ${f.cliente.nif}`);
    for (const trozo of trocear(f.cliente.direccion, ANCHO)) b.line(trozo);
    b.separator();

    // Conceptos con su importe
    for (const l of ticket.lineas) {
      const importe = (l.precio ?? 0) * l.cantidad;
      b.line(columnas(`${l.cantidad} x ${l.nombre}`, importe.toFixed(2), ANCHO));
      for (const ex of l.extras ?? []) {
        b.line(ex.precio > 0
          ? `   + ${ex.nombre} (${ex.precio.toFixed(2)})`
          : `   · ${ex.nombre}`);
      }
      if (l.notas) b.line(`   ${l.notas}`);
    }
    b.separator();

    // Desglose de IVA: obligatorio y por cada tipo aplicado
    b.line("DESGLOSE DE IVA");
    b.line(columnas("Tipo   Base", "Cuota", ANCHO));
    for (const d of f.desglose) {
      b.line(columnas(`${d.tipo}%  ${d.base.toFixed(2)}`, d.cuota.toFixed(2), ANCHO));
    }
    b.separator();
    b.line(columnas("Base imponible", f.baseImponible.toFixed(2), ANCHO));
    b.line(columnas("Total IVA", f.cuotaIva.toFixed(2), ANCHO));
    b.bold(true).sizeBig();
    b.line(`TOTAL: ${(ticket.total ?? 0).toFixed(2)} EUR`);
    b.sizeNormal().bold(false);
    if (ticket.metodo) b.line(`Forma de pago: ${ticket.metodo.toUpperCase()}`);
    b.separator();
    b.align("center").line("Conserve esta factura");
    b.align("left");
    return b.feed(3).cut().build();
  }

  // ── Ticket de caja = FACTURA SIMPLIFICADA ──────────────────────────────
  // Ojo: lo que llamamos "ticket" es legalmente una factura simplificada
  // (RD 1619/2012) y necesita como mínimo: número correlativo de serie,
  // fecha, NIF y nombre del emisor, descripción, tipo de IVA e importe total.
  if (ticket.tipo === "pago" && ticket.simplificada) {
    const s = ticket.simplificada;

    // Cabecera: nombre del restaurante, dirección y NIF
    b.align("center").bold(true).sizeBig();
    b.line(s.emisor.razonSocial || "RESTAURANTE");
    b.sizeNormal().bold(false);
    for (const trozo of trocear(s.emisor.direccion, ANCHO)) b.line(trozo);
    if (s.emisor.nif) b.line(`NIF: ${s.emisor.nif}`);
    b.separator();

    // Identificación del documento
    if (ticket.esCopia) {
      // Obligatorio: el mismo número no puede circular dos veces como
      // original. La copia se identifica sin ambigüedad.
      b.bold(true).sizeBig().line("*** COPIA ***").sizeNormal().bold(false);
      b.line("(no es el original)");
    }
    b.line("FACTURA SIMPLIFICADA");
    b.bold(true).line(s.numeroCompleto).bold(false);
    b.align("left");
    b.line(`Fecha: ${s.fecha}    Hora: ${s.hora}`);
    b.line(`${ticket.mesa ? `Mesa ${ticket.mesa}` : "Para llevar"} · ${ticket.camarero}`);
    b.separator();

    // Conceptos con su importe
    for (const l of ticket.lineas) {
      const importe = (l.precio ?? 0) * l.cantidad;
      b.line(columnas(`${l.cantidad} x ${l.nombre}`, importe.toFixed(2), ANCHO));
      // Los extras se detallan bajo el producto: los que cuestan con su
      // precio (ya incluido en el importe de arriba), los gratuitos sin nada.
      for (const ex of l.extras ?? []) {
        b.line(ex.precio > 0
          ? `   + ${ex.nombre} (${ex.precio.toFixed(2)})`
          : `   · ${ex.nombre}`);
      }
      if (l.notas) b.line(`   ${l.notas}`);
    }
    b.separator();

    // Desglose de IVA: el tipo aplicado es obligatorio. Se desglosa por tipos
    // porque una cuenta puede llevar comida al 10% y alcohol al 21%.
    b.line("IVA     BASE    CUOTA    TOTAL");
    for (const d of s.desglose) {
      b.line(
        `${(d.tipo + "%").padEnd(5)} ${d.base.toFixed(2).padStart(7)} ` +
        `${d.cuota.toFixed(2).padStart(7)} ${d.total.toFixed(2).padStart(7)}`
      );
    }
    b.separator();
    b.line(columnas("Base imponible", `${s.baseImponible.toFixed(2)}`, ANCHO));
    b.line(columnas("Total IVA", `${s.cuotaIva.toFixed(2)}`, ANCHO));

    b.align("center").bold(true).sizeBig();
    b.line(`TOTAL: ${(ticket.total ?? 0).toFixed(2)} EUR`);
    b.sizeNormal().bold(false).align("left");
    b.line("(IVA incluido)");
    b.separator();
    if (ticket.metodo) b.line(`Forma de pago: ${ticket.metodo.toUpperCase()}`);
    b.separator();
    b.align("center");
    b.line("Gracias por su visita");
    b.line("Conserve este ticket");
    b.align("left");
    return b.feed(3).cut().build();
  }

  // ── Comanda de cocina ──────────────────────────────────────────────────
  b.align("center").sizeBig().bold(true);
  b.line(ticket.mesa ? `MESA ${ticket.mesa}` : "PARA LLEVAR");
  b.bold(false).sizeNormal();
  b.line(`${ticket.hora}  ·  ${ticket.camarero}`);
  b.align("left").separator();

  for (const l of ticket.lineas) {
    b.sizeBig().line(`${l.cantidad} x ${l.nombre}`).sizeNormal();
    // En cocina los extras importan tanto como el plato: van en negrita y
    // sin precios (al cocinero el precio le da igual, lo que necesita es
    // saber qué lleva y qué no).
    for (const ex of l.extras ?? []) {
      b.bold(true).line(`   >> ${ex.nombre}`).bold(false);
    }
    if (l.notas) b.bold(true).line(`   >> ${l.notas}`).bold(false);
  }

  // Salvaguarda: si por lo que sea un pago llega sin datos fiscales
  // (p.ej. el admin aún no los rellenó), al menos sale el total.
  if (ticket.tipo === "pago" && ticket.total !== undefined) {
    b.separator().align("right").sizeBig().bold(true);
    b.line(`TOTAL: ${ticket.total.toFixed(2)} EUR`);
    b.bold(false).sizeNormal().align("left");
    if (ticket.metodo) b.line(`Forma de pago: ${ticket.metodo.toUpperCase()}`);
    b.line("(IVA incluido)");
  }

  return b.separator().feed(3).cut().build();
}

/** Parte un texto largo en líneas que quepan en el papel. */
function trocear(texto: string, ancho: number): string[] {
  const palabras = texto.split(" ");
  const lineas: string[] = [];
  let actual = "";
  for (const p of palabras) {
    if ((actual + " " + p).trim().length > ancho) {
      if (actual) lineas.push(actual.trim());
      actual = p;
    } else {
      actual += " " + p;
    }
  }
  if (actual.trim()) lineas.push(actual.trim());
  return lineas.length ? lineas : [""];
}

/** Texto a la izquierda, importe a la derecha, rellenando con espacios. */
function columnas(izq: string, der: string, ancho: number): string {
  const espacio = Math.max(1, ancho - izq.length - der.length);
  const izqCortada = izq.length > ancho - der.length - 1 ? izq.slice(0, ancho - der.length - 2) + "." : izq;
  return izqCortada + " ".repeat(Math.max(1, ancho - izqCortada.length - der.length)) + der;
}

export const escposRedDriver: DestinoDriver = {
  enviar(destino: PuntoDestinoRow, ticket: TicketData): Promise<ResultadoEnvio> {
    const ip = String(destino.config.ip ?? "");
    const puerto = Number(destino.config.puerto ?? 9100);
    const payload = renderTicket(ticket);

    return new Promise((resolve) => {
      const socket = new net.Socket();
      let terminado = false;
      const fin = (r: ResultadoEnvio) => {
        if (terminado) return;
        terminado = true;
        socket.destroy();
        resolve(r);
      };

      socket.setTimeout(TIMEOUT_MS);
      socket.once("timeout", () => fin({ ok: false, error: "timeout: la impresora no responde" }));
      socket.once("error", (err) => fin({ ok: false, error: `conexion: ${err.message}` }));

      socket.connect(puerto, ip, () => {
        socket.write(payload, (err) => {
          if (err) return fin({ ok: false, error: `escritura: ${err.message}` });
          // Damos un respiro mínimo para que el buffer llegue antes de cerrar.
          socket.end(() => fin({ ok: true }));
        });
      });
    });
  },

  ping(destino: PuntoDestinoRow): Promise<boolean> {
    const ip = String(destino.config.ip ?? "");
    const puerto = Number(destino.config.puerto ?? 9100);
    return new Promise((resolve) => {
      const socket = new net.Socket();
      let terminado = false;
      const fin = (ok: boolean) => {
        if (terminado) return;
        terminado = true;
        socket.destroy();
        resolve(ok);
      };
      socket.setTimeout(2000);
      socket.once("timeout", () => fin(false));
      socket.once("error", () => fin(false));
      socket.connect(puerto, ip, () => fin(true));
    });
  },
};
