export type RolUsuario = "admin" | "camarero";

export interface Usuario {
  id: string;
  restauranteId: string;
  nombre: string;
  rol: RolUsuario;
  pin: string; // hash en BD, texto plano solo en tránsito de login
  activo: boolean;
  creadoEn: string; // ISO 8601
}

export type TipoDispositivo = "pc" | "movil";

export interface Dispositivo {
  id: string;
  restauranteId: string;
  tipo: TipoDispositivo;
  usuarioId: string;
  nombre: string;
  ultimoPing: string | null;
}
