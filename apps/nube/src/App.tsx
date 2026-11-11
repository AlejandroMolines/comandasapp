import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";

type Estado = "en_linea" | "atencion" | "sin_conexion";
type Impresora = { nombre: string; estado: string };
type Local = {
  restauranteId: string;
  nombre: string;
  estado: Estado;
  segundos: number;
  version: string;
  mesasOcupadas: number;
  comandasAbiertas: number;
  impresoras: Impresora[];
};
type Respuesta = {
  persistencia: string;
  configurada: boolean;
  aviso: string;
  restaurantes: Local[];
};
type Sesion = { configurada: boolean; autenticada: boolean; demoUrl: string | null };

const TEXTO: Record<Estado, string> = {
  en_linea: "En línea",
  atencion: "Llega tarde",
  sin_conexion: "Sin conexión",
};

function hace(segundos: number) {
  if (segundos < 60) return `hace ${segundos} s`;
  const min = Math.round(segundos / 60);
  if (min < 60) return `hace ${min} min`;
  return `hace ${Math.round(min / 60)} h`;
}

async function pedirJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", credentials: "same-origin", ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((data as { error?: string }).error ?? `Error HTTP ${response.status}`);
  return data as T;
}

export function App() {
  const [sesion, setSesion] = useState<Sesion | null>(null);
  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [usuario, setUsuario] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(true);
  const [entrando, setEntrando] = useState(false);

  const cargar = useCallback(async () => {
    try {
      setDatos(await pedirJson<Respuesta>("/api/restaurantes"));
      setError("");
    } catch (err) {
      if (err instanceof Error && err.message.includes("superadmin")) {
        setSesion((actual) => actual ? { ...actual, autenticada: false } : actual);
      }
      setError(err instanceof Error ? err.message : "No se pudo hablar con la central.");
    }
  }, []);

  useEffect(() => {
    let vivo = true;
    void pedirJson<Sesion>("/api/superadmin/sesion")
      .then((actual) => {
        if (!vivo) return;
        setSesion(actual);
        if (actual.autenticada) void cargar();
      })
      .catch(() => {
        if (!vivo) return;
        setSesion({ configurada: true, autenticada: false, demoUrl: null });
        setError("No se pudo hablar con la central.");
      })
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, [cargar]);

  useEffect(() => {
    if (!sesion?.autenticada) return;
    const intervalo = setInterval(() => void cargar(), 15_000);
    return () => clearInterval(intervalo);
  }, [sesion?.autenticada, cargar]);

  async function entrar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setEntrando(true);
    setError("");
    try {
      await pedirJson("/api/superadmin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ usuario, password }),
      });
      setSesion((actual) => actual ? { ...actual, autenticada: true } : actual);
      setPassword("");
      await cargar();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo iniciar sesión.");
    } finally {
      setEntrando(false);
    }
  }

  async function salir() {
    await pedirJson("/api/superadmin/logout", { method: "POST" }).catch(() => undefined);
    setSesion((actual) => actual ? { ...actual, autenticada: false } : actual);
    setDatos(null);
    setPassword("");
  }

  if (cargando || !sesion) {
    return <main className="pantalla-carga"><span className="marca">C</span><p>Comprobando acceso…</p></main>;
  }

  if (!sesion.configurada || !sesion.autenticada) {
    return (
      <main className="pantalla-acceso">
        <section className="acceso-panel">
          <span className="marca">C</span>
          <p className="sobretitulo">PANEL PRIVADO</p>
          <h1>Superadmin</h1>
          <p className="texto-intro">Controla el estado de los restaurantes y abre el entorno privado de pruebas.</p>
          {!sesion.configurada ? (
            <div className="aviso" role="status">
              El acceso todavía no está configurado. Añade <code>SUPERADMIN_USER</code>,
              <code> SUPERADMIN_PASSWORD</code> y <code>SUPERADMIN_SESSION_SECRET</code> en las variables
              privadas del proyecto de Vercel.
            </div>
          ) : (
            <form className="formulario-acceso" onSubmit={(event) => void entrar(event)}>
              <label htmlFor="superadmin-user">Usuario</label>
              <input id="superadmin-user" autoComplete="username" value={usuario}
                onChange={(event) => setUsuario(event.target.value)} required maxLength={256} />
              <label htmlFor="superadmin-password">Contraseña</label>
              <input id="superadmin-password" type="password" autoComplete="current-password" value={password}
                onChange={(event) => setPassword(event.target.value)} required maxLength={1024} />
              {error && <div className="aviso aviso-error" role="alert">{error}</div>}
              <button className="boton-principal" type="submit" disabled={entrando}>
                {entrando ? "Entrando…" : "Entrar al panel"}
              </button>
            </form>
          )}
        </section>
      </main>
    );
  }

  const locales = datos?.restaurantes ?? [];
  const enLinea = locales.filter((l) => l.estado === "en_linea").length;

  return (
    <main className="panel-superadmin">
      <header className="cabecera-principal">
        <div>
          <p className="sobretitulo">PANEL PRIVADO · SUPERADMIN</p>
          <h1>Central de restaurantes</h1>
          <p>Estado de conexión y acceso al entorno de pruebas desde ordenador o móvil.</p>
        </div>
        <button className="boton-secundario" onClick={() => void salir()}>Cerrar sesión</button>
      </header>

      {error && <div className="aviso aviso-error" role="alert">{error}</div>}
      {datos?.aviso && <div className="aviso">{datos.aviso}</div>}
      {datos && !datos.configurada && (
        <div className="aviso">
          Falta <code>NUBE_TOKEN</code> en Vercel y en el Raspberry para recibir estados de restaurantes.
        </div>
      )}

      <section className="demo-panel">
        <div className="demo-icono" aria-hidden="true">↗</div>
        <div className="demo-copy">
          <p className="sobretitulo">ENTORNO PRIVADO</p>
          <h2>Restaurante de pruebas</h2>
          <p>Usa la misma cuenta en el móvil y en el PC para comprobar la sincronización de comandas y mesas.</p>
        </div>
        {sesion.demoUrl ? (
          <a className="boton-principal boton-enlace" href={sesion.demoUrl} target="_blank" rel="noreferrer">
            Abrir restaurante <span aria-hidden="true">↗</span>
          </a>
        ) : (
          <span className="demo-pendiente">Backend aún sin conectar</span>
        )}
      </section>
      {!sesion.demoUrl && (
        <div className="aviso">
          El enlace se activa al configurar <code>DEMO_RESTAURANT_URL</code> en Vercel con la dirección HTTPS
          del backend de pruebas. La central no hospeda ese backend.
        </div>
      )}

      {locales.length > 0 && (
        <div className="resumen-estados">
          <span><b>{enLinea}</b> en línea</span>
          <span><b>{locales.length - enLinea}</b> pendientes</span>
          <span><b>{locales.length}</b> restaurantes</span>
        </div>
      )}

      {datos && locales.length === 0 ? (
        <section className="vacio">
          <b>Ningún restaurante ha enviado su estado todavía.</b>
          <p>Configura <code>NUBE_TOKEN</code> en Vercel y usa el mismo valor en cada backend local.</p>
        </section>
      ) : (
        <section className="rejilla" aria-label="Restaurantes conectados">
          {locales.map((local) => {
            const impresorasOk = local.impresoras.filter((impresora) => impresora.estado === "ok").length;
            return (
              <article key={local.restauranteId} className="tarjeta">
                <div className="cabecera-tarjeta">
                  <div>
                    <div className="nombre">{local.nombre}</div>
                    <div className="id">{local.restauranteId} · visto {hace(local.segundos)} · {local.version}</div>
                  </div>
                  <span className={`pildora ${local.estado}`}>{TEXTO[local.estado]}</span>
                </div>
                <div className="estadisticas-local">
                  <span><b>{local.mesasOcupadas}</b> mesas ocupadas</span>
                  <span><b>{local.comandasAbiertas}</b> cuentas abiertas</span>
                  <span><b>{local.impresoras.length ? `${impresorasOk}/${local.impresoras.length}` : "0"}</b> impresoras</span>
                </div>
                {local.impresoras.length > 0 && (
                  <div className="impresoras">
                    {local.impresoras.map((impresora) => (
                      <span key={impresora.nombre} className={`chip ${impresora.estado}`}>
                        {impresora.nombre} · {impresora.estado}
                      </span>
                    ))}
                  </div>
                )}
              </article>
            );
          })}
        </section>
      )}

      <footer>
        La central recibe estados de conexión. Los pedidos y los datos del restaurante siguen en su backend local.
      </footer>
    </main>
  );
}
