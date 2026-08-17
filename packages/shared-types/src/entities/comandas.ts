export type TipoComanda = "mesa" | "llevar" | "domicilio";
export type EstadoComanda = "abierta" | "en_cocina" | "servida" | "cerrada" | "cancelada";

export interface Comanda {
  id: string; // UUID generado en el dispositivo de origen
  restauranteId: string;
  turnoId: string;
  mesaId: string | null;
  tipo: TipoComanda;
  camareroId: string;
  estado: EstadoComanda;
  creadoEn: string;
  cerradoEn: string | null;
}

export type EstadoRonda = "pendiente_envio" | "enviada" | "confirmada" | "error_envio";

export interface Ronda {
  id: string;
  comandaId: string;
  camareroId: string;
  estado: EstadoRonda;
  creadoEn: string;
}

export type EstadoLinea = "pendiente" | "enviada" | "preparada" | "entregada";

export interface LineaComanda {
  id: string;
  comandaId: string;
  rondaId: string;
  productoId: string;
  cantidad: number;
  precioUnitario: number; // snapshot en el momento del pedido
  notas: string | null;
  estado: EstadoLinea;
  impresoraResueltaId: string | null; // punto_destino_id resuelto al enviar
  enviadoEn: string | null;
}

export type MetodoPago = "efectivo" | "tarjeta" | "otro";

export interface Pago {
  id: string;
  comandaId: string;
  metodo: MetodoPago;
  importe: number;
  propina: number;
  impresoraTicketId: string | null;
  creadoEn: string;
}

export interface Turno {
  id: string;
  restauranteId: string;
  usuarioAperturaId: string;
  abiertoEn: string;
  cerradoEn: string | null;
  cajaInicial: number;
  cajaFinal: number | null;
}
