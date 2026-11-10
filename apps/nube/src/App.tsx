import { useEffect, useState } from "react";

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

export function App() {
  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let vivo = true;
    const cargar = () => {
      fetch("/api/restaurantes")
        .then((r) => r.json())
        .then((d: Respuesta) => { if (vivo) { setDatos(d); setError(""); } })
        .catch(() => { if (vivo) setError("No se pudo hablar con la central."); });
    };
    cargar();
    const t = setInterval(cargar, 15000);
    return () => { vivo = false; clearInterval(t); };
  }, []);

  const locales = datos?.restaurantes ?? [];
  const enLinea = locales.filter((l) => l.estado === "en_linea").length;

  return (
    <main>
      <header>
        <h1>Central de locales</h1>
        <p>
          Aquí se ve si cada restaurante sigue llamando. El móvil de los camareros
          y el PC del local hablan con su Raspberry, no con esta página: si internet
          se cae, el bar sigue cobrando igual.
        </p>
      </header>

      {error && <div className="aviso">{error}</div>}
      {datos?.aviso && <div className="aviso">{datos.aviso}</div>}
      {datos && !datos.configurada && (
        <div className="aviso">
          Falta <code>NUBE_TOKEN</code> en Vercel. Sin esa clave un local no puede anunciarse.
          La misma clave va en el Raspberry, junto con <code>NUBE_URL</code> apuntando aquí.
        </div>
      )}

      {locales.length > 0 && (
        <p className="stats" style={{ marginTop: 18 }}>
          <span><b>{enLinea}</b> en línea</span>
          <span><b>{locales.length - enLinea}</b> sin confirmar</span>
        </p>
      )}

      {datos && locales.length === 0 ? (
        <div className="vacio">
          <b style={{ color: "var(--texto)" }}>Ningún local ha llamado todavía.</b>
          <ol className="pasos">
            <li>En Vercel, variable <code>NUBE_TOKEN</code> con una clave larga.</li>
            <li>En el Raspberry, las mismas dos variables y reinicia el servicio:</li>
          </ol>
          <p><code>NUBE_URL=https://tu-dominio.vercel.app</code></p>
          <p><code>NUBE_TOKEN=la-misma-clave</code></p>
          <p>En menos de un minuto el local aparece aquí. El servicio del bar no espera a esta llamada.</p>
        </div>
      ) : (
        <div className="rejilla">
          {locales.map((l) => {
            const ok = l.impresoras.filter((i) => i.estado === "ok").length;
            return (
              <article key={l.restauranteId} className="tarjeta">
                <div className="cabecera-tarjeta">
                  <div>
                    <div className="nombre">{l.nombre}</div>
                    <div className="id">{l.restauranteId} · visto {hace(l.segundos)} · {l.version}</div>
                  </div>
                  <span className={`pildora ${l.estado}`}>{TEXTO[l.estado]}</span>
                </div>
                <div className="stats">
                  <span><b>{l.mesasOcupadas}</b> mesas ocupadas</span>
                  <span><b>{l.comandasAbiertas}</b> cuentas abiertas</span>
                  <span><b>{l.impresoras.length ? `${ok}/${l.impresoras.length}` : "0"}</b> impresoras</span>
                </div>
                {l.impresoras.length > 0 && (
                  <div className="impresoras">
                    {l.impresoras.map((i) => (
                      <span key={i.nombre} className={`chip ${i.estado}`}>{i.nombre} · {i.estado}</span>
                    ))}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      <footer>
        Tres piezas: el móvil y el PC solo abren el navegador contra el Raspberry del local.
        Esta central es la única que vive en internet, y solo recibe un aviso.
      </footer>
    </main>
  );
}
