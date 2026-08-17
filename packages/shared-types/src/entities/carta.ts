export interface Menu {
  id: string;
  restauranteId: string;
  nombre: string;
  orden: number;
  activo: boolean;
}

export interface Categoria {
  id: string;
  restauranteId: string;
  menuId: string;
  categoriaPadreId: string | null;
  nombre: string;
  orden: number;
}

export interface Producto {
  id: string;
  restauranteId: string;
  categoriaId: string;
  nombre: string;
  precio: number;
  descripcion: string | null;
  disponible: boolean;
  orden: number;
}
