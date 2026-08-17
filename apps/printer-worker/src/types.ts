/** Datos ya resueltos de un ticket listo para entregar a un destino. */
export interface TicketData {
  logId: string;
  tipo: "comanda" | "pago";
  /**
   * Reimpresión. Legalmente no se puede emitir dos veces el mismo número de
   * factura como original, así que el papel sale marcado como COPIA.
   */
  esCopia?: boolean;
  mesa: string | null;
  camarero: string;
  hora: string;
  lineas: {
    cantidad: number; nombre: string; notas: string | null; precio?: number; tipoIva?: number;
    /** extras aplicados: precio 0 = modificación, > 0 = extra con coste */
    extras?: { nombre: string; precio: number }[];
  }[];
  /** solo para tipo pago */
  total?: number;
  metodo?: string;
  /**
   * Datos del ticket como FACTURA SIMPLIFICADA (RD 1619/2012): todo ticket
   * entregado al cliente lo es legalmente, y necesita numeración correlativa
   * y los datos fiscales del emisor.
   */
  simplificada?: {
    numeroCompleto: string;
    fecha: string;
    hora: string;
    emisor: { razonSocial: string; nif: string; direccion: string };
    desglose: { tipo: number; base: number; cuota: number; total: number }[];
    baseImponible: number;
    cuotaIva: number;
  };
  /**
   * Si el cobro generó una FACTURA COMPLETA a nombre de una empresa, el
   * ticket pasa a ser el documento fiscal: lleva numeración, datos de
   * emisor y destinatario, y desglose de IVA (RD 1619/2012).
   */
  factura?: {
    numeroCompleto: string;
    fecha: string;
    emisor: { razonSocial: string; nif: string; direccion: string };
    cliente: { razonSocial: string; nif: string; direccion: string };
    desglose: { tipo: number; base: number; cuota: number }[];
    baseImponible: number;
    cuotaIva: number;
  };
}

export interface PuntoDestinoRow {
  id: string;
  nombre: string;
  tipo: string;
  protocolo: string;
  config: Record<string, unknown>;
}

export interface ResultadoEnvio {
  ok: boolean;
  /** mensaje de error corto para guardar en log_impresion.ultimo_error */
  error?: string;
}

export interface DestinoDriver {
  enviar(destino: PuntoDestinoRow, ticket: TicketData): Promise<ResultadoEnvio>;
  /** comprobación ligera de salud (abrir/cerrar socket, ping...) */
  ping(destino: PuntoDestinoRow): Promise<boolean>;
}
