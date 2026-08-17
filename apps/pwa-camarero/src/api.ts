export const API = import.meta.env.VITE_API ?? "";

export function getToken(): string | null {
  return localStorage.getItem("token");
}

export function getTokenRestaurante(): string | null {
  return localStorage.getItem("tokenRestaurante");
}

export function setSesionRestaurante(token: string, nombre: string) {
  localStorage.setItem("tokenRestaurante", token);
  localStorage.setItem("restauranteNombre", nombre);
}

export function getRestauranteNombre(): string | null {
  return localStorage.getItem("restauranteNombre");
}

export function cerrarSesionRestaurante() {
  localStorage.removeItem("tokenRestaurante");
  localStorage.removeItem("restauranteNombre");
  cerrarSesion();
}

export function setSesion(token: string, usuario: { id: string; nombre: string; rol: string }) {
  localStorage.setItem("token", token);
  localStorage.setItem("usuario", JSON.stringify(usuario));
}

export function getUsuario(): { id: string; nombre: string; rol: string } | null {
  const raw = localStorage.getItem("usuario");
  return raw ? JSON.parse(raw) : null;
}

export function cerrarSesion() {
  localStorage.removeItem("token");
  localStorage.removeItem("usuario");
}

export async function api<T = unknown>(
  path: string,
  opts: { method?: string; body?: unknown; nivelRestaurante?: boolean } = {}
): Promise<T> {
  const token = opts.nivelRestaurante ? getTokenRestaurante() : getToken();
  const res = await fetch(`${API}${path}`, {
    method: opts.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) {
    const cuerpo = await res.json().catch(() => ({}));
    // Un 401 aquí significa que el usuario del token ya no existe o está
    // desactivado (típico tras borrar/recrear la base de datos). No tiene
    // sentido seguir dejando que cada acción falle en silencio: se limpia
    // la sesión y se recarga, así la persona ve el login directamente en
    // vez de una lista de "acción rechazada" sin explicación.
    // ATENCIÓN: no aplica al propio intento de login/PIN, que también da
    // 401 cuando el PIN es incorrecto — eso no debe forzar ningún reload.
    const esIntentoDeLogin = path === "/auth/entrar" || path === "/auth/restaurante";
    if (res.status === 401 && !esIntentoDeLogin && !opts.nivelRestaurante) {
      cerrarSesion();
      window.location.reload();
    }
    throw new ApiError(res.status, (cuerpo as { error?: string }).error ?? `HTTP ${res.status}`, cuerpo);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public cuerpo: unknown
  ) {
    super(message);
  }
}
