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
  diagnosticos: { id: string; nivel: "error" | "aviso"; mensaje: string; fecha: string }[];
};
type Respuesta = {
  persistencia: string;
  configurada: boolean;
  aviso: string;
  restaurantes: Local[];
};
type Sesion = { configurada: boolean; autenticada: boolean; demoUrl: string | null };
type Commit = { sha: string; fecha: string; mensaje: string };
type Publicacion = { sha: string | null; version: string | null; mensaje?: string; publicadaEn: string; pausada?: boolean } | null;
type Versiones = { commits: Commit[]; centralSha: string; release: Publicacion; persistencia: string };

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
  const [versiones, setVersiones] = useState<Versiones | null>(null);
  const [versionElegida, setVersionElegida] = useState("");
  const [publicando, setPublicando] = useState(false);

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

  const cargarVersiones = useCallback(async () => {
    try {
      const nuevas = await pedirJson<Versiones>("/api/superadmin/actualizacion");
      setVersiones(nuevas);
      const indicePublicada = nuevas.release?.sha ? nuevas.commits.findIndex((c) => c.sha === nuevas.release?.sha) : -1;
      const candidatas = indicePublicada >= 0 ? nuevas.commits.slice(0, indicePublicada) : nuevas.commits;
      setVersionElegida((actual) => candidatas.some((c) => c.sha === actual) ? actual : candidatas[0]?.sha ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudieron consultar las versiones.");
    }
  }, []);

  useEffect(() => {
    let vivo = true;
    void pedirJson<Sesion>("/api/superadmin/sesion")
      .then((actual) => {
        if (!vivo) return;
        setSesion(actual);
        if (actual.autenticada) {
          void cargar();
          void cargarVersiones();
        }
      })
      .catch(() => {
        if (!vivo) return;
        setSesion({ configurada: true, autenticada: false, demoUrl: null });
        setError("No se pudo hablar con la central.");
      })
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, [cargar, cargarVersiones]);

  useEffect(() => {
    if (!sesion?.autenticada) return;
    const intervalo = setInterval(() => void cargar(), 15_000);
    const versionesIntervalo = setInterval(() => void cargarVersiones(), 5 * 60_000);
    return () => { clearInterval(intervalo); clearInterval(versionesIntervalo); };
  }, [sesion?.autenticada, cargar, cargarVersiones]);

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
      await cargarVersiones();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo iniciar sesión.");
    } finally {
      setEntrando(false);
    }
  }

  async function publicarVersion(accion: "publicar" | "pausar" | "reanudar") {
    if (accion === "publicar" && !window.confirm("Se publicará esta versión a todos los Raspberry conectados. Actualizarán automáticamente y reiniciarán los servicios locales en unos minutos. ¿Continuar?")) return;
    setPublicando(true);
    setError("");
    try {
      await pedirJson("/api/superadmin/actualizacion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(accion === "publicar" ? { sha: versionElegida } : { accion }),
      });
      await Promise.all([cargarVersiones(), cargar()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cambiar la versión publicada.");
    } finally {
      setPublicando(false);
    }
  }

  async function salir() {
    await pedirJson("/api/superadmin/logout", { method: "POST" }).catch(() => undefined);
    setSesion((actual) => actual ? { ...actual, autenticada: false } : actual);
    setDatos(null);
    setPassword("");
  }

  if (cargando || !sesion) {
    return <main className="pantalla-carga"><img src="/logo.png" alt="" className="marca-logo" /><p>Comprobando acceso…</p></main>;
  }

  if (!sesion.configurada || !sesion.autenticada) {
    return (
      <main className="pantalla-acceso">
        <section className="acceso-panel">
          <img src="/logo.png" alt="" className="marca-logo" />
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
  const indicePublicada = versiones?.release?.sha ? versiones.commits.findIndex((c) => c.sha === versiones.release?.sha) : -1;
  const commitsPublicables = versiones ? (indicePublicada >= 0 ? versiones.commits.slice(0, indicePublicada) : versiones.commits) : [];

  return (
    <main className="panel-superadmin">
      <header className="cabecera-principal">
        <div>
          <p className="sobretitulo">PANEL PRIVADO · SUPERADMIN</p>
          <h1>Central de restaurantes</h1>
          <p>Conexión, versiones y diagnóstico de cada restaurante; publica actualizaciones desde aquí.</p>
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

      <section className="versiones-panel" aria-labelledby="versiones-titulo">
        <div className="versiones-cabecera">
          <div>
            <p className="sobretitulo">ACTUALIZACIONES</p>
            <h2 id="versiones-titulo">Versiones de los restaurantes</h2>
            <p>Publica una versión de <code>main</code>. Los Raspberry conectados la instalarán automáticamente en unos minutos y reiniciarán sus servicios locales. Los datos del restaurante permanecen en el Raspberry.</p>
          </div>
          <span className={`estado-publicacion ${versiones?.release?.sha && !versiones.release.pausada ? "publicado" : "pausado"}`}>
            {versiones?.release?.sha && !versiones.release.pausada ? `Publicada ${versiones.release.version}` : "Actualizaciones pausadas"}
          </span>
        </div>
        {versiones ? (
          <>
            <label className="etiqueta-version" htmlFor="version-elegida">Versión de <code>main</code> disponible para publicar</label>
            <select id="version-elegida" value={versionElegida} onChange={(event) => setVersionElegida(event.target.value)}>
              {commitsPublicables.map((commit) => (
                <option key={commit.sha} value={commit.sha}>
                  {commit.sha.slice(0, 12)} · {commit.mensaje || "Sin descripción"}
                </option>
              ))}
            </select>
            <div className="acciones-version">
              <button className="boton-principal" onClick={() => void publicarVersion("publicar")}
                disabled={publicando || !versionElegida || !datos?.configurada || versiones.persistencia === "memoria"}>
                {publicando ? "Guardando…" : "Publicar a todos los restaurantes"}
              </button>
              {versiones.release?.sha && (
                <button className="boton-secundario" onClick={() => void publicarVersion(versiones.release?.pausada ? "reanudar" : "pausar")}
                  disabled={publicando || !datos?.configurada || versiones.persistencia === "memoria"}>
                  {versiones.release.pausada ? "Reanudar actualizaciones" : "Pausar nuevas actualizaciones"}
                </button>
              )}
            </div>
            {versiones.release?.sha && (
              <p className="version-publicada">
                {versiones.release.pausada ? "Última versión: " : "Objetivo: "}<code>{versiones.release.version}</code>{versiones.release.mensaje ? ` · ${versiones.release.mensaje}` : ""}
                {versiones.release.publicadaEn ? ` · publicada ${new Date(versiones.release.publicadaEn).toLocaleString("es-ES")}` : ""}
              </p>
            )}
            {versiones.persistencia === "memoria" && (
              <div className="aviso aviso-error">La central no tiene almacenamiento persistente: la publicación se perderá si Vercel reinicia. Configura Postgres, KV o Vercel Blob.</div>
            )}
            {!datos?.configurada && <div className="aviso aviso-error">Configura <code>NUBE_TOKEN</code> en la central y en cada Raspberry para conectar los restaurantes y habilitar sus actualizaciones automáticas.</div>}
            {versiones.commits.length > 0 && commitsPublicables.length === 0 && (
              <p className="version-publicada">Ya está publicada la versión más reciente que GitHub ofrece en este panel.</p>
            )}
          </>
        ) : (
          <p className="versiones-cargando">Cargando versiones de GitHub…</p>
        )}
      </section>

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
            const indiceObjetivo = versiones?.release?.sha
              ? versiones.commits.findIndex((commit) => commit.sha === versiones.release?.sha) : -1;
            const indiceLocal = versiones?.commits.findIndex((commit) => commit.sha === local.version) ?? -1;
            const posteriorAlObjetivo = indiceLocal >= 0 && indiceObjetivo >= 0 && indiceLocal < indiceObjetivo;
            return (
              <article key={local.restauranteId} className="tarjeta">
                <div className="cabecera-tarjeta">
                  <div>
                    <div className="nombre">{local.nombre}</div>
                    <div className="id">{local.restauranteId} · visto {hace(local.segundos)} · {local.version}</div>
                    {versiones?.release?.sha && !versiones.release.pausada && (
                      <div className={`version-local ${local.version === versiones.release.sha || posteriorAlObjetivo ? "al-dia" : "pendiente"}`}>
                        {local.version === versiones.release.sha ? "Versión publicada instalada" : posteriorAlObjetivo ? "Ya tiene una versión posterior" : `Pendiente · objetivo ${versiones.release.version}`}
                      </div>
                    )}
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
                <details className="diagnosticos">
                    <summary>Diagnóstico remoto · {local.diagnosticos?.length ?? 0}</summary>
                    {!local.diagnosticos?.length ? <p className="sin-logs">No hay avisos ni errores recientes.</p> : (
                    <ol>
                      {local.diagnosticos.slice().reverse().slice(0, 30).map((log) => (
                        <li key={log.id} className={log.nivel}>
                          <time dateTime={log.fecha}>{new Date(log.fecha).toLocaleString("es-ES")}</time>
                          <span>{log.mensaje}</span>
                        </li>
                      ))}
                    </ol>
                    )}
                </details>
              </article>
            );
          })}
        </section>
      )}

      <footer>
        La central recibe estados y diagnósticos limitados. Los pedidos y los datos del restaurante siguen en su backend local.
      </footer>
    </main>
  );
}
