import fs from "node:fs";
import type { Socket } from "socket.io-client";
import { EscPosBuilder } from "../escpos.js";
import type { DestinoDriver, PuntoDestinoRow, ResultadoEnvio, TicketData } from "../types.js";

/**
 * USB: en Linux una térmica USB suele exponerse como /dev/usb/lp0.
 * Escribir los bytes ESC/POS directamente al device file es suficiente
 * para la mayoría de modelos — sin librerías ni drivers adicionales.
 */
export const escposUsbDriver: DestinoDriver = {
  async enviar(destino: PuntoDestinoRow, ticket: TicketData): Promise<ResultadoEnvio> {
    const ruta = String(destino.config.rutaDispositivo ?? "");
    const b = new EscPosBuilder().init().align("center").sizeBig().bold(true);
    if (ticket.tipo === "cuenta") {
      b.line("CUENTA").sizeNormal().bold(false).line("PRECUENTA - NO ES FACTURA");
      b.line(ticket.mesa ? `MESA ${ticket.mesa}` : "PARA LLEVAR").align("left").separator();
      for (const l of ticket.lineas) {
        b.line(`${l.cantidad} x ${l.nombre}  ${((l.precio ?? 0) * l.cantidad).toFixed(2)}`);
        if (l.notas) b.line(`   >> ${l.notas}`);
        for (const ex of l.extras ?? []) b.line(ex.precio > 0 ? `   + ${ex.nombre} (${ex.precio.toFixed(2)})` : `   · ${ex.nombre}`);
      }
      if ((ticket.descuento ?? 0) > 0) b.line(`Descuento: -${ticket.descuento!.toFixed(2)} EUR`);
      b.separator().bold(true).line(`TOTAL: ${(ticket.total ?? 0).toFixed(2)} EUR`).bold(false);
      b.align("center").line("Pendiente de pago").feed(3).cut();
      try { fs.writeFileSync(ruta, b.build()); return { ok: true }; }
      catch (err) { return { ok: false, error: `usb: ${(err as Error).message}` }; }
    }
    if (ticket.anulacion) b.line("*** ANULADO ***");
    b.line(ticket.mesa ? `MESA ${ticket.mesa}` : "PARA LLEVAR");
    if (ticket.motivoAnulacion) b.bold(false).sizeNormal().line(ticket.motivoAnulacion).sizeBig().bold(true);
    b.bold(false).sizeNormal().align("left").separator();
    for (const l of ticket.lineas) {
      b.line(`${l.cantidad} x ${l.nombre}`);
      if (l.notas) b.line(`   >> ${l.notas}`);
    }
    b.feed(3).cut();

    try {
      fs.writeFileSync(ruta, b.build());
      return { ok: true };
    } catch (err) {
      return { ok: false, error: `usb: ${(err as Error).message}` };
    }
  },

  async ping(destino: PuntoDestinoRow): Promise<boolean> {
    try {
      fs.accessSync(String(destino.config.rutaDispositivo ?? ""), fs.constants.W_OK);
      return true;
    } catch {
      return false;
    }
  },
};

/**
 * KDS: no genera bytes — emite el ticket como JSON por Socket.IO a través
 * del backend, al canal que la pantalla tiene abierto. La pantalla renderiza
 * su propia UI y puede devolver eventos (linea.preparada) por el mismo canal.
 *
 * El worker no habla directamente con la pantalla: pasa por el backend,
 * que es quien mantiene las conexiones socket de todos los dispositivos.
 */
export function crearWebsocketKdsDriver(socketBackend: Socket): DestinoDriver {
  return {
    enviar(destino: PuntoDestinoRow, ticket: TicketData): Promise<ResultadoEnvio> {
      return new Promise((resolve) => {
        if (!socketBackend.connected) {
          return resolve({ ok: false, error: "kds: sin conexión con el backend" });
        }
        const canal = String(destino.config.canal ?? "");
        // ack con timeout: si el backend no confirma en 3s, tratamos como fallo.
        socketBackend
          .timeout(3000)
          .emit("worker:kds_ticket", { canal, ticket }, (err: unknown, ack: { ok: boolean }) => {
            if (err) return resolve({ ok: false, error: "kds: backend no confirma" });
            resolve(ack?.ok ? { ok: true } : { ok: false, error: "kds: pantalla no conectada" });
          });
      });
    },

    async ping(): Promise<boolean> {
      return socketBackend.connected;
    },
  };
}
