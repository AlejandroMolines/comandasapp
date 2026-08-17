export type TipoEventoSync =
  | "ronda.creada"
  | "ronda.impresion_fallida"
  | "pago.registrado"
  | "mesa.estado_cambiado"
  | "producto.actualizado"
  | "turno.cerrado";

export interface EventoSync<TPayload = unknown> {
  id: string; // UUID del evento en sí, no de la entidad
  restauranteId: string;
  tipo: TipoEventoSync;
  entidadId: string;
  version: number;
  payload: TPayload;
  creadoEn: string;
  origenDispositivoId: string;
}

export interface RespuestaSync {
  aplicados: string[]; // ids de evento confirmados
  rechazados: { id: string; motivo: string }[];
}
