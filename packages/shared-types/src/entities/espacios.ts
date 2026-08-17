export interface Zona {
  id: string;
  restauranteId: string;
  nombre: string;
  orden: number;
}

export type EstadoMesa = "libre" | "ocupada" | "reservada";

export interface Mesa {
  id: string;
  restauranteId: string;
  zonaId: string;
  nombre: string;
  capacidad: number;
  estado: EstadoMesa;
}
