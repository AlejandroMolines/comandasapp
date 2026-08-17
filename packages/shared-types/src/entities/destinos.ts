export type TipoPuntoDestino = "impresora_termica" | "pantalla_kds" | "impresora_ticket";
export type ProtocoloDestino = "escpos_red" | "escpos_usb" | "websocket_kds" | "api_generica";

export interface PuntoDestino {
  id: string;
  restauranteId: string;
  nombre: string;
  tipo: TipoPuntoDestino;
  protocolo: ProtocoloDestino;
  // config depende del protocolo:
  // escpos_red -> { ip, puerto }
  // escpos_usb -> { rutaDispositivo }
  // websocket_kds -> { canal }
  config: Record<string, unknown>;
  estadoSalud: "ok" | "caido" | "desconocido";
  ultimoVistoEn: string | null;
}

export interface ProductoDestino {
  productoId: string;
  puntoDestinoId: string;
}

export interface CategoriaDestino {
  categoriaId: string;
  puntoDestinoId: string;
}
