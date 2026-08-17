import {
  BarChart3, Building2, ClipboardList, DoorOpen, LayoutGrid, LogOut, Palette, Printer,
  Receipt, Tag, UsersRound, UtensilsCrossed,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { API, api, cerrarSesion, getToken, getUsuario } from "./api";
import { uuid } from "./uuid";
import { BotonModo } from "./BotonModo";
import { VERSION } from "./version";
import { Badge, Button } from "@/components/ui";
import { cn } from "@/lib/utils";
import { VistaCarta } from "./admin/Carta";
import { VistaAjustes, VistaImpresoras, VistaPersonal, VistaSalas, VistaTurnos } from "./admin/Paneles";
import { VistaEmpresas } from "./admin/Empresas";
import { VistaExtras } from "./admin/Extras";
import { VistaHistorial } from "./admin/Historial";
import { VistaResumen } from "./admin/Resumen";
import {
  cargarMaestros, encolar, onCola, pendientes, vaciarCola,
  type CartaCompleta, type Mesa, type Zona,
} from "./offline";
import { cargarTema } from "./tema";
import { useToast } from "./toast";
import { Acceso } from "./acceso";
import { Cobro, Comanda, Sala, type ComandaAbierta, type Linea } from "./vistas-camarero";

cargarTema();
console.info("[comandas]", VERSION);

type VistaSala =
  | { v: "mesas" }
  | { v: "comanda"; comandaId: string; titulo: string; mesaId: string | null }
  | { v: "cobro"; comandaId: string; titulo: string; mesaId: string | null };

type SeccionAdmin = "resumen" | "sala" | "carta" | "extras" | "salas" | "impresoras" | "empresas" | "historial" | "turnos" | "personal" | "ajustes";

const NAV_ADMIN: { id: SeccionAdmin; nombre: string; Icono: typeof BarChart3 }[] = [
  { id: "resumen", nombre: "Resumen", Icono: BarChart3 },
  { id: "sala", nombre: "Tomar comandas", Icono: ClipboardList },
  { id: "carta", nombre: "Carta", Icono: UtensilsCrossed },
  { id: "extras", nombre: "Extras", Icono: Tag },
  { id: "salas", nombre: "Salas", Icono: LayoutGrid },
  { id: "impresoras", nombre: "Impresoras", Icono: Printer },
  { id: "empresas", nombre: "Empresas", Icono: Building2 },
  { id: "historial", nombre: "Historial", Icono: Receipt },
  { id: "turnos", nombre: "Turnos", Icono: DoorOpen },
  { id: "personal", nombre: "Personal", Icono: UsersRound },
  { id: "ajustes", nombre: "Ajustes", Icono: Palette },
];

export default function App() {
  const [logueado, setLogueado] = useState(!!getToken());
  const usuario = getUsuario();
  const esAdmin = usuario?.rol === "admin";

  if (!logueado) return <Acceso onOk={() => setLogueado(true)} />;
  return esAdmin
    ? <LayoutAdmin onSalir={() => { cerrarSesion(); setLogueado(false); }} />
    : <FlujoSala onSalir={() => { cerrarSesion(); setLogueado(false); }} />;
}

/* ─────────────────── Layout ADMIN: sidebar + contenido ─────────────────── */
function LayoutAdmin({ onSalir }: { onSalir: () => void }) {
  const [seccion, setSeccion] = useState<SeccionAdmin>("resumen");
  const usuario = getUsuario();

  return (
    <div className="flex min-h-dvh max-md:flex-col">
      <aside className="sticky top-0 flex h-dvh w-56 shrink-0 flex-col border-r bg-card p-3 max-md:static max-md:h-auto max-md:w-full max-md:flex-row max-md:items-center max-md:overflow-x-auto max-md:py-2">
        <div className="flex items-center gap-2.5 px-2 pb-4 max-md:pb-0">
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary font-display text-lg font-bold text-primary-foreground">C</span>
          <b className="font-display max-md:hidden">Comandas</b>
        </div>
        <nav className="flex flex-1 flex-col gap-0.5 max-md:flex-row">
          {NAV_ADMIN.map(({ id, nombre, Icono }) => (
            <button key={id} onClick={() => setSeccion(id)}
              className={cn(
                "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
                seccion === id && "bg-primary/15 text-primary hover:bg-primary/15 hover:text-primary"
              )}>
              <Icono className="size-[18px] shrink-0" />
              <span className="max-md:hidden">{nombre}</span>
            </button>
          ))}
        </nav>
        <div className="flex items-center gap-2 border-t px-2 pt-3 text-sm text-muted-foreground max-md:border-0 max-md:pt-0">
          <span className="flex-1 max-md:hidden">{usuario?.nombre}</span>
          <BotonModo />
          <Button variant="ghost" size="icon-sm" onClick={onSalir} title="Salir"><LogOut /></Button>
        </div>
      </aside>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 md:px-8">
        {seccion === "resumen" && <VistaResumen />}
        {seccion === "sala" && <FlujoSala embebido />}
        {seccion === "carta" && <VistaCarta />}
        {seccion === "extras" && <VistaExtras />}
        {seccion === "salas" && <VistaSalas />}
        {seccion === "impresoras" && <VistaImpresoras />}
        {seccion === "empresas" && <VistaEmpresas />}
        {seccion === "historial" && <VistaHistorial />}
        {seccion === "turnos" && <VistaTurnos />}
        {seccion === "personal" && <VistaPersonal />}
        {seccion === "ajustes" && <VistaAjustes />}
      </main>
    </div>
  );
}

/* ─────────────────── Flujo de SALA (camarero / admin tomando comandas) ─────────────────── */
function FlujoSala({ onSalir, embebido = false }: { onSalir?: () => void; embebido?: boolean }) {
  const [maestros, setMaestros] = useState<{ carta: CartaCompleta; zonas: Zona[]; mesas: Mesa[] } | null>(null);
  const [turnoId, setTurnoId] = useState<string | null>(null);
  const [vista, setVista] = useState<VistaSala>({ v: "mesas" });
  // La zona elegida vive aquí (no dentro de Sala) para que sobreviva al
  // volver de una mesa con la flecha de "atrás".
  const [zonaId, setZonaId] = useState<string | null>(null);
  const [abiertas, setAbiertas] = useState<ComandaAbierta[]>([]);
  const [nPendientes, setNPendientes] = useState(0);
  const [recargaComanda, setRecargaComanda] = useState(0);
  const [toast, avisar] = useToast();
  const socketRef = useRef<Socket | null>(null);

  const recargar = useCallback(async () => {
    try {
      setMaestros(await cargarMaestros());
    } catch {
      avisar("Sin conexión y sin datos guardados todavía", true);
    }
    try {
      const t = await api<{ id: string }>("/turnos/activo");
      setTurnoId(t.id);
    } catch { setTurnoId(null); }
    try {
      setAbiertas(await api<ComandaAbierta[]>("/comandas/abiertas"));
    } catch { /* sin red: la sala se muestra sin totales */ }
  }, [avisar]);

  useEffect(() => {
    void recargar();
    void pendientes().then(setNPendientes);
    const off = onCola((n, msg) => { setNPendientes(n); if (msg) avisar(msg, true); });

    const s = io(API || "/", { transports: ["websocket", "polling"] });
    socketRef.current = s;
    s.on("mesa:liberada", () => void recargar());
    s.on("ronda:creada", () => void recargar());
    s.on("producto:disponibilidad", () => void recargar());
    s.on("impresion:fallida", (d: { destino: string }) => avisar(`⚠ ${d.destino} no responde — comanda sin imprimir`, true));
    return () => { off(); s.disconnect(); };
  }, [recargar, avisar]);

  if (!maestros) return <div className="p-10 text-center text-sm text-muted-foreground">Cargando el servicio…</div>;

  const abrir = async (mesa: Mesa | null) => {
    if (!turnoId) return avisar("Conectando con el turno… vuelve a intentarlo en un segundo", true);

    // Si la mesa YA tiene una comanda abierta, hay que reutilizar ESA comanda,
    // no crear otra. Antes se generaba siempre un id nuevo, y al volver a
    // entrar en una mesa ocupada las rondas se enviaban a una comanda que no
    // existía en el servidor -> error al añadir más productos.
    if (mesa) {
      const yaAbierta = abiertas.find((c) => c.mesa_id === mesa.id);
      if (yaAbierta) {
        setVista({ v: "comanda", comandaId: yaAbierta.id, titulo: `Mesa ${mesa.nombre}`, mesaId: mesa.id });
        return;
      }
    }

    const id = uuid();
    await encolar({
      uuid: id, tipo: "abrir_comanda",
      payload: { id, turnoId, mesaId: mesa?.id ?? null, tipo: mesa ? "mesa" : "llevar" },
    });
    setVista({ v: "comanda", comandaId: id, titulo: mesa ? `Mesa ${mesa.nombre}` : "Para llevar", mesaId: mesa?.id ?? null });
  };

  const enviarRonda = async (lineas: Linea[], imprimir: boolean) => {
    if (vista.v !== "comanda") return;
    await encolar({
      uuid: uuid(), tipo: "enviar_ronda",
      payload: { comandaId: vista.comandaId, lineas: lineas.map((l) => ({
        productoId: l.productoId, cantidad: l.cantidad, notas: l.notas,
        extraIds: (l.extras ?? []).map((e) => e.id),
      })), imprimir },
    });
    avisar(imprimir ? "Comanda enviada a cocina ✓" : "Guardado en la cuenta (sin imprimir)");
    // Dar un margen a que la cola sincronice y refrescar "ya pedido".
    setTimeout(() => setRecargaComanda((n) => n + 1), 1200);
  };

  return (
    <div className={cn(!embebido && "mx-auto flex min-h-dvh max-w-xl flex-col")}>
      {toast}
      {!embebido && (
        <div className="flex items-center gap-2 border-b bg-card px-4 py-2">
          <span className="font-display font-semibold">{getUsuario()?.nombre}</span>
          {nPendientes > 0 && <Badge variant="warning">⏳ {nPendientes} sin enviar</Badge>}
          {!navigator.onLine && <Badge variant="destructive">Sin conexión</Badge>}
          <span className="flex-1" />
          <BotonModo />
          <Button variant="ghost" size="icon-sm" onClick={onSalir} title="Salir"><LogOut /></Button>
        </div>
      )}
      {embebido && nPendientes > 0 && <Badge variant="warning" className="mb-2">⏳ {nPendientes} sin enviar</Badge>}

      {vista.v === "mesas" && (
        <Sala zonas={maestros.zonas} mesas={maestros.mesas} abiertas={abiertas}
          zonaId={zonaId} onZonaId={setZonaId}
          onMesa={(m) => void abrir(m)} onLlevar={() => void abrir(null)}
          onAbrirComanda={(c) => setVista({
            v: "comanda", comandaId: c.id, mesaId: null,
            // La hora distingue unos pedidos de otros cuando hay varios a la vez.
            titulo: `Llevar · ${new Date(c.creado_en).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}`,
          })} />
      )}
      {vista.v === "comanda" && (
        <Comanda carta={maestros.carta} titulo={vista.titulo}
          comandaId={vista.comandaId} recargarClave={recargaComanda}
          mesaActualId={vista.mesaId} mesas={maestros.mesas} zonas={maestros.zonas} abiertas={abiertas}
          onMovida={(msg) => { avisar(msg); setVista({ v: "mesas" }); void recargar(); }}
          onEnviar={(l, imprimir) => void enviarRonda(l, imprimir)}
          onCobrar={async () => {
            // Camino rápido: si no hay nada en la cola (lo normal), se pasa a
            // cobrar al instante sin esperar a ningún envío.
            if ((await pendientes()) === 0) {
              setVista({ v: "cobro", comandaId: vista.comandaId, titulo: vista.titulo, mesaId: vista.mesaId });
              return;
            }
            // Quedan comandas por sincronizar: hay que enviarlas antes de
            // cobrar, y se avisa para que no parezca que la app se ha colgado.
            avisar("Sincronizando comandas antes de cobrar…");
            await vaciarCola();
            if ((await pendientes()) > 0) return avisar("Hay comandas sin sincronizar — no se puede cobrar sin conexión", true);
            setVista({ v: "cobro", comandaId: vista.comandaId, titulo: vista.titulo, mesaId: vista.mesaId });
          }}
          onVolver={() => { setVista({ v: "mesas" }); void recargar(); }} />
      )}
      {vista.v === "cobro" && (
        <Cobro comandaId={vista.comandaId} titulo={vista.titulo}
          onCerrado={() => { avisar("Cobrado ✓ Mesa liberada"); setVista({ v: "mesas" }); void recargar(); }}
          onVolver={() => setVista({ v: "comanda", comandaId: vista.comandaId, titulo: vista.titulo, mesaId: vista.mesaId })} />
      )}
    </div>
  );
}
