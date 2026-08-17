import {
  ArrowLeft, ArrowRightLeft, Banknote, ChevronDown, ChevronLeft, ChevronRight, ClipboardList,
  CreditCard, FileText, Folder, Minus, Plus, Printer, Receipt, Save, Search, Send, ShoppingBag, Timer, X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import { Badge, Button, Dialog, Input } from "@/components/ui";
import { cn } from "@/lib/utils";
import type { CartaCompleta, Mesa, Zona } from "./offline";
import { eur } from "./tema";
import { useToast } from "./toast";

/* ═══════════════════════════ utilidades de tiempo ═══════════════════════════ */

/** "1h 12m" / "23m" desde una fecha ISO hasta ahora. */
export function transcurrido(desde: string, ahora = Date.now()): string {
  const min = Math.max(0, Math.floor((ahora - Date.parse(desde)) / 60000));
  if (min < 60) return `${min}m`;
  return `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, "0")}m`;
}

/** Se pone ámbar a partir de 1h y rojo a partir de 2h: aviso visual de mesa lenta. */
function colorTiempo(desde: string): string {
  const min = (Date.now() - Date.parse(desde)) / 60000;
  if (min >= 120) return "text-destructive";
  if (min >= 60) return "text-warning";
  return "text-muted-foreground";
}

/** Reloj compartido: un único intervalo para todos los cronómetros. */
function useAhora(activo: boolean) {
  const [ahora, setAhora] = useState(Date.now());
  useEffect(() => {
    if (!activo) return;
    const t = setInterval(() => setAhora(Date.now()), 30000);
    return () => clearInterval(t);
  }, [activo]);
  return ahora;
}

/* ═══════════════════════════ SALA: zonas y mesas ═══════════════════════════ */

export interface ComandaAbierta {
  id: string; mesa_id: string | null; tipo: string; camarero: string;
  total: number; unidades: number; creado_en: string;
}

export function Sala({ zonas, mesas, abiertas, zonaId, onZonaId, onMesa, onLlevar, onAbrirComanda }: {
  zonas: Zona[]; mesas: Mesa[]; abiertas: ComandaAbierta[];
  // La zona elegida vive en el componente padre (App.tsx), no aquí dentro:
  // así, al volver de una mesa, seguimos viendo la misma zona en vez de
  // caer otra vez en "¿Dónde vas a atender?".
  zonaId: string | null; onZonaId: (id: string | null) => void;
  onMesa: (m: Mesa) => void; onLlevar: () => void;
  /** Abrir una comanda que ya existe (p.ej. un pedido para llevar en curso) */
  onAbrirComanda: (c: ComandaAbierta) => void;
}) {
  const ahora = useAhora(true);

  // Si hay una sola zona, entramos directos (una vez, no en cada render).
  useEffect(() => {
    if (zonas.length === 1 && !zonaId) onZonaId(zonas[0].id);
  }, [zonas, zonaId, onZonaId]);

  // Solo cuenta como ocupada si de verdad tiene algo pedido.
  const porMesa = useMemo(
    () => new Map(abiertas.filter((c) => c.mesa_id && c.unidades > 0).map((c) => [c.mesa_id!, c])),
    [abiertas]
  );

  // Los pedidos para llevar NO tienen mesa, así que no aparecen en la
  // cuadrícula. Antes se quedaban invisibles y no había forma de volver a
  // ellos: se listan aparte para poder retomarlos y cobrarlos.
  const llevarAbiertos = useMemo(
    () => abiertas.filter((c) => !c.mesa_id && c.unidades > 0),
    [abiertas]
  );

  /** Bloque de pedidos para llevar en curso, reutilizado en las dos pantallas. */
  const PedidosLlevar = () =>
    llevarAbiertos.length === 0 ? null : (
      <section className="mt-5">
        <h3 className="mb-2 text-[0.72rem] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
          Para llevar · en curso
        </h3>
        <div className="flex flex-col gap-2">
          {llevarAbiertos.map((c) => (
            <button key={c.id} onClick={() => onAbrirComanda(c)}
              className="flex items-center gap-3 rounded-lg border-[1.5px] border-warning/50 bg-warning/5 p-3 text-left transition-colors hover:bg-warning/10">
              <ShoppingBag className="size-5 shrink-0 text-warning" />
              <span className="flex-1">
                <b className="text-sm">
                  Llevar · {new Date(c.creado_en).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}
                </b>
                <span className="block text-xs text-muted-foreground">
                  {c.unidades} uds · {c.camarero}
                </span>
              </span>
              <span className="text-right">
                <span className="block font-mono text-sm font-semibold">{eur(c.total)}</span>
                <span className={cn("flex items-center justify-end gap-1 text-[0.62rem]", colorTiempo(c.creado_en))}>
                  <Timer className="size-3" /> {transcurrido(c.creado_en, ahora)}
                </span>
              </span>
            </button>
          ))}
        </div>
      </section>
    );

  if (zonas.length === 0) {
    return (
      <div className="px-4 py-8">
        <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          <b className="mb-1 block text-foreground">Sin zonas configuradas</b>
          El admin puede crearlas en Panel → Salas
        </div>
      </div>
    );
  }

  /* ── Paso 1: elegir zona ── */
  if (!zonaId) {
    return (
      <div className="px-4 pb-6 pt-3">
        <h2 className="mb-4 text-lg">¿Dónde vas a atender?</h2>
        <div className="flex flex-col gap-2.5">
          {zonas.map((z) => {
            const deZona = mesas.filter((m) => m.zona_id === z.id);
            const ocupadas = deZona.filter((m) => porMesa.has(m.id)).length;
            return (
              <button key={z.id} onClick={() => onZonaId(z.id)}
                className="flex items-center gap-3 rounded-xl border bg-card p-4 text-left transition-colors hover:bg-accent">
                <Folder className="size-5 text-primary" />
                <span className="flex-1">
                  <b className="font-display text-lg">{z.nombre}</b>
                  <span className="block text-xs text-muted-foreground">
                    {deZona.length} mesas · {ocupadas} ocupadas
                  </span>
                </span>
                <ChevronRight className="size-5 text-muted-foreground" />
              </button>
            );
          })}
        </div>
        <Button variant="secondary" size="lg" className="mt-5 w-full" onClick={onLlevar}>
          <Receipt /> Nuevo pedido para llevar
        </Button>
        <PedidosLlevar />
      </div>
    );
  }

  /* ── Paso 2: mesas de la zona elegida ── */
  const zona = zonas.find((z) => z.id === zonaId);
  const deZona = mesas.filter((m) => m.zona_id === zonaId);
  const ocupadas = deZona.filter((m) => porMesa.has(m.id)).length;

  return (
    <div className="px-4 pb-6 pt-2">
      <div className="mb-3 flex items-center gap-2 py-1">
        {zonas.length > 1 && (
          <Button variant="ghost" size="icon" onClick={() => onZonaId(null)} aria-label="Cambiar de zona">
            <ChevronLeft className="!size-5" />
          </Button>
        )}
        <h2 className="flex-1 text-lg">{zona?.nombre}</h2>
        <Badge variant="success">{deZona.length - ocupadas} libres</Badge>
        {ocupadas > 0 && <Badge variant="destructive">{ocupadas} ocupadas</Badge>}
      </div>

      {deZona.length === 0 ? (
        <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          Esta zona aún no tiene mesas.
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(5.6rem,1fr))] gap-2.5">
          {deZona.map((m) => {
            const c = porMesa.get(m.id);
            return (
              <button key={m.id} onClick={() => onMesa(m)}
                className={cn(
                  "flex flex-col items-center gap-0.5 rounded-xl border-[1.5px] bg-card py-3 transition-transform active:scale-95",
                  c ? "border-destructive/60 bg-destructive/5" : "border-success/50"
                )}>
                <span className="font-display text-xl font-bold">{m.nombre}</span>
                {c ? (
                  <>
                    <span className="font-mono text-sm font-semibold">{eur(c.total)}</span>
                    <span className={cn("flex items-center gap-1 text-[0.62rem]", colorTiempo(c.creado_en))}>
                      <Timer className="size-3" /> {transcurrido(c.creado_en, ahora)}
                    </span>
                  </>
                ) : (
                  <span className="text-[0.65rem] font-semibold uppercase tracking-wider text-success">libre</span>
                )}
              </button>
            );
          })}
        </div>
      )}

      <Button variant="secondary" size="lg" className="mt-5 w-full" onClick={onLlevar}>
        <Receipt /> Nuevo pedido para llevar
      </Button>
      <PedidosLlevar />
    </div>
  );
}

/* ═══════════════════════════ COMANDA ═══════════════════════════ */

export interface Linea {
  productoId: string; nombre: string; precio: number; cantidad: number; notas?: string;
  /** extras elegidos: los de precio > 0 suman al total de la línea */
  extras?: { id: string; nombre: string; precio: number }[];
}

export interface Extra {
  id: string; nombre: string; precio: number; ambito: string; grupo: string | null;
}
export interface LineaPrevia {
  cantidad: number; nombre: string; precio_unitario: number; notas: string | null;
  extras?: { nombre: string; precio: number }[];
}

export function Comanda({
  carta, titulo, comandaId, recargarClave, mesaActualId, mesas, zonas, abiertas,
  onEnviar, onCobrar, onVolver, onMovida,
}: {
  carta: CartaCompleta; titulo: string; comandaId: string; recargarClave: number;
  mesaActualId: string | null; mesas: Mesa[]; zonas: Zona[]; abiertas: ComandaAbierta[];
  onEnviar: (l: Linea[], imprimir: boolean) => void; onCobrar: () => void; onVolver: () => void;
  onMovida: (mensaje: string) => void;
}) {
  const [moviendo, setMoviendo] = useState(false);
  const [ruta, setRuta] = useState<string[]>([]); // migas de pan por el árbol
  const [busqueda, setBusqueda] = useState("");
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [notaPara, setNotaPara] = useState<{ productoId: string; nombre: string; precio: number } | null>(null);

  const [previas, setPrevias] = useState<LineaPrevia[]>([]);
  const [totalPrevio, setTotalPrevio] = useState(0);

  // "resumen": lista de lo ya pedido, con un botón para añadir más.
  // "pedir": árbol/buscador para elegir productos nuevos.
  // Al abrir una mesa que YA tiene algo, se empieza en "resumen"; si está
  // vacía, se va directo a "pedir". Solo se decide una vez (al primer dato).
  const [modo, setModo] = useState<"resumen" | "pedir" | null>(null);
  const decidido = useRef(false);

  useEffect(() => {
    let vivo = true;
    api<{ lineas: LineaPrevia[]; total: number }>(`/comandas/${comandaId}`)
      .then((r) => {
        if (!vivo) return;
        setPrevias(r.lineas);
        setTotalPrevio(r.total);
        if (!decidido.current) {
          decidido.current = true;
          setModo(r.lineas.length > 0 ? "resumen" : "pedir");
        }
      })
      .catch(() => {
        // Comanda aún no sincronizada: no hay nada previo, se va a pedir.
        if (!decidido.current) { decidido.current = true; setModo("pedir"); }
      });
    return () => { vivo = false; };
  }, [comandaId, recargarClave]);

  const catActual = ruta.length ? ruta[ruta.length - 1] : null;

  // Nivel actual del árbol: subcategorías y productos que cuelgan de aquí.
  const subcategorias = carta.categorias
    .filter((c) => (catActual ? c.categoria_padre_id === catActual : !c.categoria_padre_id))
    .sort((a, b) => a.orden - b.orden);
  const productosNivel = catActual
    ? carta.productos.filter((p) => p.categoria_id === catActual)
    : [];

  // Buscador: recorre TODA la carta, sin importar en qué nivel estés.
  const resultados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (q.length < 2) return null;
    return carta.productos.filter((p) => p.nombre.toLowerCase().includes(q)).slice(0, 40);
  }, [busqueda, carta.productos]);

  const cantidadDe = (productoId: string) =>
    lineas.filter((l) => l.productoId === productoId).reduce((a, l) => a + l.cantidad, 0);

  const sumar = (p: { id: string; nombre: string; precio: number }, delta: number) =>
    setLineas((ls) => {
      // Solo toca la línea "sin notas"; las que llevan comentario son aparte.
      const i = ls.findIndex((l) => l.productoId === p.id && !l.notas);
      if (i < 0) {
        if (delta <= 0) return ls;
        return [...ls, { productoId: p.id, nombre: p.nombre, precio: p.precio, cantidad: 1 }];
      }
      const nueva = Math.min(99, ls[i].cantidad + delta);
      if (nueva <= 0) return ls.filter((_, j) => j !== i);
      return ls.map((l, j) => (j === i ? { ...l, cantidad: nueva } : l));
    });

  const añadirConExtras = (
    extras: { id: string; nombre: string; precio: number }[],
    nota: string,
    cantidad: number
  ) => {
    if (!notaPara) return;
    setLineas((ls) => [...ls, {
      productoId: notaPara.productoId, nombre: notaPara.nombre, precio: notaPara.precio,
      cantidad, notas: nota || undefined, extras: extras.length ? extras : undefined,
    }]);
    setNotaPara(null);
  };

  /** Precio de una línea contando sus extras con coste. */
  const precioLinea = (l: Linea) =>
    (l.precio + (l.extras ?? []).reduce((a, e) => a + e.precio, 0)) * l.cantidad;

  const total = lineas.reduce((a, l) => a + precioLinea(l), 0);
  const unidades = lineas.reduce((a, l) => a + l.cantidad, 0);

  /** Tarjeta de producto con contador y acceso a comentarios. */
  const FilaProducto = ({ p }: { p: CartaCompleta["productos"][0] }) => {
    const n = cantidadDe(p.id);
    return (
      <div className={cn(
        "flex items-center gap-2 rounded-lg border bg-card p-2.5",
        n > 0 && "border-primary/50 bg-primary/5",
        !p.disponible && "opacity-40"
      )}>
        {/* Tocar el nombre abre comentarios/agregados */}
        <button className="min-w-0 flex-1 text-left" disabled={!p.disponible}
          onClick={() => setNotaPara({ productoId: p.id, nombre: p.nombre, precio: p.precio })}>
          <span className="block truncate text-sm font-semibold">{p.nombre}</span>
          <span className="font-mono text-xs text-muted-foreground">
            {p.disponible ? eur(p.precio) : "Agotado"}
            {p.disponible && <span className="ml-1.5 not-italic opacity-70">· toca para nota</span>}
          </span>
        </button>
        <Button variant="secondary" size="icon-sm" disabled={!p.disponible || n === 0}
          onClick={() => sumar(p, -1)} aria-label={`Quitar ${p.nombre}`}><Minus /></Button>
        <span className={cn("w-7 text-center font-mono text-sm font-bold", n === 0 && "text-muted-foreground/40")}>{n}</span>
        <Button size="icon-sm" disabled={!p.disponible || n >= 99}
          onClick={() => sumar(p, 1)} aria-label={`Añadir ${p.nombre}`}><Plus /></Button>
      </div>
    );
  };

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center gap-2 px-3 pb-1 pt-2.5">
        <Button variant="ghost" size="icon" onClick={onVolver}><ArrowLeft className="!size-5" /></Button>
        <h2 className="flex-1 text-lg">{titulo}</h2>
        {mesaActualId && (
          <Button variant="ghost" size="icon" title="Mover de mesa" onClick={() => setMoviendo(true)}>
            <ArrowRightLeft className="!size-[18px]" />
          </Button>
        )}
        <Button variant="secondary" onClick={onCobrar}><Receipt /> Cobrar</Button>
      </header>

      {moviendo && (
        <DialogoMoverMesa
          comandaId={comandaId} mesaActualId={mesaActualId} mesas={mesas} zonas={zonas} abiertas={abiertas}
          onCerrar={() => setMoviendo(false)}
          onHecho={(msg) => { setMoviendo(false); onMovida(msg); }}
        />
      )}

      {modo === "resumen" ? (
        /* ── Mesa ocupada: primero se ve lo que ya hay, luego se decide añadir ── */
        <div className="flex flex-1 flex-col px-4 pb-4 pt-1">
          <div className="mb-3 flex items-center gap-2 text-sm text-muted-foreground">
            <ClipboardList className="size-4" />
            <span>{previas.reduce((a, l) => a + l.cantidad, 0)} productos pedidos</span>
          </div>
          <div className="flex-1 overflow-y-auto rounded-lg border bg-card">
            {previas.map((l, i) => (
              <div key={i} className={cn("flex gap-2 px-3 py-2.5 text-sm", i > 0 && "border-t")}>
                <span className="flex-1">
                  <b className="font-mono">{l.cantidad}×</b> {l.nombre}
                  {(l.extras ?? []).map((ex, k) => (
                    <em key={k} className="block text-xs not-italic text-primary">
                      {ex.precio > 0 ? `+ ${ex.nombre} (${eur(ex.precio)})` : `· ${ex.nombre}`}
                    </em>
                  ))}
                  {l.notas && <em className="block text-xs not-italic text-warning">{l.notas}</em>}
                </span>
                <span className="font-mono text-muted-foreground">{eur(l.cantidad * l.precio_unitario)}</span>
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center justify-between px-1 text-base font-bold">
            <span>Total</span><span className="font-mono">{eur(totalPrevio)}</span>
          </div>
          <Button size="lg" className="mt-4 w-full font-semibold" onClick={() => setModo("pedir")}>
            <Plus /> Añadir productos
          </Button>
        </div>
      ) : (
        <>
      {/* Si venimos del resumen, enlace claro para volver sin perder nada */}
      {previas.length > 0 && (
        <button onClick={() => setModo("resumen")} className="mx-4 mb-1 flex items-center gap-1 text-sm text-primary">
          <ChevronLeft className="size-4" /> Ver lo ya pedido
        </button>
      )}

      {/* Buscador: siempre visible, atajo para no navegar el árbol */}
      <div className="relative mx-4 my-2">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input className="pl-9 pr-9" placeholder="Buscar producto…" value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)} />
        {busqueda && (
          <button onClick={() => setBusqueda("")} aria-label="Limpiar búsqueda"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground">
            <X className="size-4" />
          </button>
        )}
      </div>

      {/* Migas de pan del árbol (solo si no estamos buscando) */}
      {!resultados && ruta.length > 0 && (
        <div className="mx-4 mb-1 flex flex-wrap items-center gap-1 text-sm">
          <button onClick={() => setRuta([])} className="text-primary hover:underline">Carta</button>
          {ruta.map((id, i) => {
            const cat = carta.categorias.find((c) => c.id === id);
            const ultimo = i === ruta.length - 1;
            return (
              <span key={id} className="flex items-center gap-1">
                <ChevronRight className="size-3.5 text-muted-foreground" />
                {ultimo ? <b>{cat?.nombre}</b> : (
                  <button onClick={() => setRuta(ruta.slice(0, i + 1))} className="text-primary hover:underline">
                    {cat?.nombre}
                  </button>
                )}
              </span>
            );
          })}
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 pb-2">
        {resultados ? (
          resultados.length === 0
            ? <p className="py-8 text-center text-sm text-muted-foreground">Ningún producto coincide con «{busqueda}»</p>
            : <div className="flex flex-col gap-2">{resultados.map((p) => <FilaProducto key={p.id} p={p} />)}</div>
        ) : (
          <div className="flex flex-col gap-2">
            {/* Grupos del nivel actual */}
            {subcategorias.map((c) => {
              const nHijas = carta.categorias.filter((x) => x.categoria_padre_id === c.id).length;
              const nProd = carta.productos.filter((x) => x.categoria_id === c.id).length;
              return (
                <button key={c.id} onClick={() => setRuta([...ruta, c.id])}
                  className="flex items-center gap-3 rounded-lg border bg-card p-3 text-left transition-colors hover:bg-accent">
                  <Folder className="size-[18px] shrink-0 text-primary" />
                  <span className="flex-1">
                    <b className="text-sm">{c.nombre}</b>
                    <span className="block text-xs text-muted-foreground">
                      {nHijas > 0 && `${nHijas} grupos`}{nHijas > 0 && nProd > 0 && " · "}
                      {nProd > 0 && `${nProd} productos`}
                      {nHijas === 0 && nProd === 0 && "vacío"}
                    </span>
                  </span>
                  <ChevronRight className="size-4 text-muted-foreground" />
                </button>
              );
            })}
            {/* Productos de este nivel */}
            {productosNivel.map((p) => <FilaProducto key={p.id} p={p} />)}
            {subcategorias.length === 0 && productosNivel.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">
                {ruta.length === 0 ? "La carta está vacía. El admin puede crearla en Panel → Carta." : "Este grupo está vacío."}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Líneas de esta ronda */}
      {lineas.length > 0 && (
        <div className="max-h-52 overflow-y-auto border-t px-4 py-1.5">
          {lineas.map((l, i) => (
            <div key={i} className="flex items-center gap-2 py-1.5">
              <span className="flex-1 text-sm leading-tight">
                <b className="font-mono">{l.cantidad}×</b> {l.nombre}
                {(l.extras ?? []).map((ex) => (
                  <em key={ex.id} className="block text-xs not-italic text-primary">
                    {ex.precio > 0 ? `+ ${ex.nombre} (${eur(ex.precio)})` : `· ${ex.nombre}`}
                  </em>
                ))}
                {l.notas && <em className="block text-xs not-italic text-warning">{l.notas}</em>}
              </span>
              <span className="font-mono text-sm">{eur(precioLinea(l))}</span>
              <Button variant="ghost" size="icon-sm" aria-label="Quitar línea"
                onClick={() => setLineas((ls) => ls.filter((_, j) => j !== i))}><X /></Button>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-2 px-4 pb-4 pt-2">
        {unidades > 0 && (
          <p className="text-center text-sm text-muted-foreground">
            <b className="font-mono text-foreground">{unidades} uds</b> · {eur(total)}
          </p>
        )}
        <div className="flex gap-2">
          {/* Guardar SIN imprimir: para lo que sirve el propio camarero
              (una caña de la barra) o para apuntar algo sin dar trabajo a
              cocina. Entra igualmente en la cuenta. */}
          <Button variant="secondary" size="lg" className="flex-1" disabled={lineas.length === 0}
            onClick={() => {
              onEnviar(lineas, false);
              setLineas([]);
              if (previas.length > 0) setModo("resumen");
            }}>
            <Save /> Solo guardar
          </Button>
          <Button size="lg" className="flex-[1.4] font-semibold" disabled={lineas.length === 0}
            onClick={() => {
              onEnviar(lineas, true);
              setLineas([]);
              // Tras enviar, si ya había algo antes, volvemos al resumen
              // (que se refrescará con lo nuevo en cuanto sincronice).
              if (previas.length > 0) setModo("resumen");
            }}>
            <Send /> Enviar a cocina
          </Button>
        </div>
      </div>
        </>
      )}

      {notaPara && (
        <DialogoExtras producto={notaPara} onCerrar={() => setNotaPara(null)} onOk={añadirConExtras} />
      )}
    </div>
  );
}

/**
 * Extras y comentarios de un producto. Los extras vienen del panel de
 * administración, así que cada restaurante define los suyos: los de precio 0
 * son modificaciones ("sin cebolla") y los de precio > 0 suman a la cuenta
 * ("extra de queso +1,50"). Todos se imprimen para cocina.
 */
function DialogoExtras({ producto, onOk, onCerrar }: {
  producto: { productoId: string; nombre: string; precio: number };
  onOk: (
    extras: { id: string; nombre: string; precio: number }[],
    nota: string,
    cantidad: number
  ) => void;
  onCerrar: () => void;
}) {
  const [disponibles, setDisponibles] = useState<Extra[] | null>(null);
  const [elegidos, setElegidos] = useState<Extra[]>([]);
  const [texto, setTexto] = useState("");
  const [cantidad, setCantidad] = useState(1);

  useEffect(() => {
    void api<Extra[]>(`/extras/producto/${producto.productoId}`)
      .then(setDisponibles)
      .catch(() => setDisponibles([]));
  }, [producto.productoId]);

  const alternar = (e: Extra) =>
    setElegidos((prev) =>
      prev.some((x) => x.id === e.id) ? prev.filter((x) => x.id !== e.id) : [...prev, e]
    );
  const activo = (e: Extra) => elegidos.some((x) => x.id === e.id);

  const sumaExtras = elegidos.reduce((a, e) => a + e.precio, 0);
  const totalLinea = (producto.precio + sumaExtras) * cantidad;

  // Modificaciones (gratis) y extras (con coste) se separan visualmente:
  // el camarero necesita ver de un golpe qué va a encarecer la cuenta.
  const gratis = (disponibles ?? []).filter((e) => e.precio === 0);
  const conCoste = (disponibles ?? []).filter((e) => e.precio > 0);

  const Chip = ({ e }: { e: Extra }) => (
    <button onClick={() => alternar(e)}
      className={cn(
        "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
        activo(e)
          ? "border-transparent bg-primary text-primary-foreground"
          : "bg-card text-muted-foreground hover:text-foreground"
      )}>
      {e.nombre}
      {e.precio > 0 && <span className="ml-1 font-mono">+{e.precio.toFixed(2)}</span>}
    </button>
  );

  return (
    <Dialog open onOpenChange={(o) => !o && onCerrar()} title={producto.nombre}>
      <div className="flex flex-col gap-4">
        {disponibles === null ? (
          <p className="text-sm text-muted-foreground">Cargando extras…</p>
        ) : (
          <>
            {gratis.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Modificaciones (sin coste)
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {gratis.map((e) => <Chip key={e.id} e={e} />)}
                </div>
              </div>
            )}
            {conCoste.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Extras con coste
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {conCoste.map((e) => <Chip key={e.id} e={e} />)}
                </div>
              </div>
            )}
            {disponibles.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Este producto no tiene extras configurados. El admin puede crearlos
                en Panel → Carta → Extras.
              </p>
            )}
          </>
        )}

        <div className="flex flex-col gap-1.5">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Comentario libre para cocina
          </p>
          <Input placeholder="Ej: que salga con el segundo" value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onOk(elegidos, texto, cantidad)} />
        </div>

        <div className="flex items-center gap-3">
          <span className="flex-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Cantidad</span>
          <Button variant="secondary" size="icon-sm" disabled={cantidad <= 1}
            onClick={() => setCantidad(cantidad - 1)}><Minus /></Button>
          <span className="w-8 text-center font-mono text-lg font-bold">{cantidad}</span>
          <Button size="icon-sm" disabled={cantidad >= 99} onClick={() => setCantidad(cantidad + 1)}><Plus /></Button>
        </div>

        {sumaExtras > 0 && (
          <p className="rounded-md bg-muted px-3 py-2 text-sm">
            {eur(producto.precio)} + {eur(sumaExtras)} de extras
            {cantidad > 1 && ` × ${cantidad}`} = <b className="font-mono">{eur(totalLinea)}</b>
          </p>
        )}

        <Button onClick={() => onOk(elegidos, texto, cantidad)}>
          Añadir {cantidad > 1 && `${cantidad} `}· {eur(totalLinea)}
        </Button>
      </div>
    </Dialog>
  );
}

/* ═══════════════════════════ COBRO ═══════════════════════════ */

export function Cobro({ comandaId, titulo, onCerrado, onVolver }: {
  comandaId: string; titulo: string; onCerrado: () => void; onVolver: () => void;
}) {
  const [cuenta, setCuenta] = useState<{ total: number; pagado: number; pendiente: number } | null>(null);
  const [lineas, setLineas] = useState<{ cantidad: number; nombre: string; precio_unitario: number; notas: string | null; tipo_iva?: number; extras?: { nombre: string; precio: number }[] }[]>([]);
  const [fiscal, setFiscal] = useState<{ razonSocial: string; nif: string; direccion: string }>({ razonSocial: "", nif: "", direccion: "" });
  const [abierta, setAbierta] = useState<string | null>(null);
  const [cajas, setCajas] = useState<{ id: string; nombre: string }[]>([]);
  const [cajaId, setCajaId] = useState<string | null>(null);
  const [metodo, setMetodo] = useState<"efectivo" | "tarjeta">("efectivo");
  // Factura a empresa: si se elige una, sale el documento fiscal completo
  // en vez del ticket simplificado.
  const [empresas, setEmpresas] = useState<{ id: string; razon_social: string; nif: string }[]>([]);
  const [empresaId, setEmpresaId] = useState<string | null>(null);
  const [buscarEmpresa, setBuscarEmpresa] = useState("");
  const [pidiendoFactura, setPidiendoFactura] = useState(false);
  const [toast, avisar] = useToast();

  useEffect(() => {
    // Las tres peticiones van en paralelo, y la pantalla se pinta con lo
    // primero que llegue: la cuenta es lo único imprescindible.
    void api<{ total: number; pagado: number; pendiente: number }>(`/comandas/${comandaId}/cuenta`).then(setCuenta);
    void api<{ lineas: typeof lineas; comanda: { creado_en: string } }>(`/comandas/${comandaId}`)
      .then((r) => { setLineas(r.lineas); setAbierta(r.comanda.creado_en); });
    // Las impresoras de ticket son opcionales: si tardan o fallan, se puede
    // cobrar igual (sin ticket impreso), no deben bloquear el cobro.
    void api<{ id: string; nombre: string; tipo: string }[]>("/destinos")
      .then((ds) => {
        const t = ds.filter((d) => d.tipo === "impresora_ticket");
        setCajas(t);
        if (t.length) setCajaId(t[0].id);
      })
      .catch(() => { /* sin impresora de caja: se cobra sin imprimir */ });
    void api<{ id: string; razon_social: string; nif: string }[]>("/empresas")
      .then(setEmpresas)
      .catch(() => { /* sin empresas dadas de alta */ });
    void api<Record<string, string>>("/ajustes")
      .then((a) => setFiscal({
        razonSocial: a.fiscal_razon_social ?? "",
        nif: a.fiscal_nif ?? "",
        direccion: a.fiscal_direccion ?? "",
      }))
      .catch(() => { /* sin datos fiscales todavía */ });
  }, [comandaId]);

  const [cobrando, setCobrando] = useState(false);

  const cobrar = async () => {
    if (!cuenta || cobrando) return;
    setCobrando(true);
    try {
      const r = await api<{ comandaCerrada: boolean }>(`/comandas/${comandaId}/pagos`, {
        method: "POST",
        body: { metodo, importe: cuenta.pendiente, impresoraTicketId: cajaId, empresaId },
      });
      if (r.comandaCerrada) onCerrado();
    } catch (e) {
      avisar((e as Error).message, true);
      setCobrando(false);
    }
  };

  return (
    <div>
      {toast}
      <header className="flex items-center gap-2 px-3 pb-1 pt-2.5">
        <Button variant="ghost" size="icon" onClick={onVolver}><ArrowLeft className="!size-5" /></Button>
        <h2 className="flex-1 text-lg">Cobrar · {titulo}</h2>
      </header>

      {!cuenta ? <p className="p-6 text-center text-sm text-muted-foreground">Cargando cuenta…</p> : (
        <div className="flex flex-col gap-5 px-4 pb-6 pt-2">
          <div className="ticket mx-auto w-full max-w-[22rem]">
            {/* Cabecera fiscal: así se verá el papel que sale por la impresora */}
            {fiscal.razonSocial ? (
              <>
                <p className="text-center text-sm font-bold uppercase">{fiscal.razonSocial}</p>
                {fiscal.direccion && <p className="text-center text-[0.7rem]">{fiscal.direccion}</p>}
                {fiscal.nif && <p className="text-center text-[0.7rem]">NIF: {fiscal.nif}</p>}
              </>
            ) : (
              <p className="text-center text-[0.7rem] opacity-70">
                ⚠ Faltan los datos fiscales (Panel → Ajustes)
              </p>
            )}
            <hr className="sep" />
            <p className="text-center text-[0.74rem] font-semibold uppercase tracking-wider">
              Factura simplificada
            </p>
            <div className="flex justify-between text-[0.72rem]">
              <span>{new Date().toLocaleDateString("es-ES")}</span>
              <span>{new Date().toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}</span>
            </div>
            <p className="text-[0.72rem]">
              {titulo}{abierta && ` · abierta hace ${transcurrido(abierta)}`}
            </p>
            <hr className="sep" />
            {lineas.map((l, i) => (
              <div key={i}>
                <div className="flex justify-between gap-3">
                  <span>{l.cantidad}× {l.nombre}</span>
                  <span className="whitespace-nowrap">{eur(l.cantidad * l.precio_unitario)}</span>
                </div>
                {(l.extras ?? []).map((ex, k) => (
                  <div key={k} className="pl-3 text-[0.72rem] opacity-70">
                    {ex.precio > 0 ? `+ ${ex.nombre} (${ex.precio.toFixed(2)})` : `· ${ex.nombre}`}
                  </div>
                ))}
                {l.notas && <div className="pl-3 text-[0.72rem] opacity-70">» {l.notas}</div>}
              </div>
            ))}
            <hr className="sep" />
            {cuenta.pagado > 0 && (
              <>
                <div className="flex justify-between text-[0.76rem] opacity-70"><span>Ya pagado</span><span>−{eur(cuenta.pagado)}</span></div>
                <hr className="sep" />
              </>
            )}
            {/* Desglose de IVA: obligatorio indicar el tipo aplicado */}
            {(() => {
              const porTipo = new Map<number, number>();
              for (const l of lineas) {
                const t = l.tipo_iva ?? 10;
                porTipo.set(t, (porTipo.get(t) ?? 0) + l.cantidad * l.precio_unitario);
              }
              const filas = [...porTipo.entries()].sort((a, b) => a[0] - b[0]).map(([tipo, conIva]) => {
                const base = Math.round((conIva / (1 + tipo / 100)) * 100) / 100;
                return { tipo, base, cuota: Math.round((conIva - base) * 100) / 100 };
              });
              if (filas.length === 0) return null;
              return (
                <>
                  <div className="flex justify-between text-[0.7rem] font-semibold">
                    <span>IVA</span><span>BASE</span><span>CUOTA</span>
                  </div>
                  {filas.map((f) => (
                    <div key={f.tipo} className="flex justify-between text-[0.72rem]">
                      <span>{f.tipo}%</span>
                      <span>{f.base.toFixed(2)}</span>
                      <span>{f.cuota.toFixed(2)}</span>
                    </div>
                  ))}
                  <hr className="sep" />
                </>
              );
            })()}
            <div className="flex justify-between text-lg font-bold"><span>TOTAL</span><span>{eur(cuenta.pendiente)}</span></div>
            <p className="text-center text-[0.7rem] opacity-70">(IVA incluido)</p>
            <hr className="sep" />
            <div className="flex justify-between text-[0.78rem]">
              <span>{lineas.reduce((a, l) => a + l.cantidad, 0)} productos</span>
              <span>{metodo === "efectivo" ? "EFECTIVO" : "TARJETA"}</span>
            </div>
            {empresaId && (
              <>
                <hr className="sep" />
                <p className="text-center text-[0.72rem] font-bold">
                  SE EMITIRÁ FACTURA A NOMBRE DE
                  <span className="block">{empresas.find((e) => e.id === empresaId)?.razon_social}</span>
                </p>
              </>
            )}
            <p className="mt-2 text-center text-[0.72rem] opacity-60">gracias por su visita</p>
          </div>

          <div className="mx-auto flex w-full max-w-[26rem] flex-col gap-3">
            <div className="flex gap-2">
              <Button className="flex-1" variant={metodo === "efectivo" ? "default" : "secondary"} onClick={() => setMetodo("efectivo")}>
                <Banknote /> Efectivo
              </Button>
              <Button className="flex-1" variant={metodo === "tarjeta" ? "default" : "secondary"} onClick={() => setMetodo("tarjeta")}>
                <CreditCard /> Tarjeta
              </Button>
            </div>
            {cajas.length > 1 && (
              <div className="flex gap-2">
                {cajas.map((c) => (
                  <Button key={c.id} className="flex-1" variant={c.id === cajaId ? "default" : "secondary"} onClick={() => setCajaId(c.id)}>
                    <Printer /> {c.nombre}
                  </Button>
                ))}
              </div>
            )}

            {/* ── Factura a empresa ── */}
            {!pidiendoFactura && !empresaId ? (
              <Button variant="outline" onClick={() => setPidiendoFactura(true)}>
                <FileText /> Necesita factura de empresa
              </Button>
            ) : (
              <div className="flex flex-col gap-2 rounded-lg border bg-card p-3">
                <div className="flex items-center gap-2">
                  <FileText className="size-4 text-primary" />
                  <span className="flex-1 text-sm font-semibold">Factura a empresa</span>
                  <Button variant="ghost" size="icon-sm" aria-label="Cancelar factura"
                    onClick={() => { setPidiendoFactura(false); setEmpresaId(null); setBuscarEmpresa(""); }}>
                    <X />
                  </Button>
                </div>

                {empresaId ? (
                  (() => {
                    const e = empresas.find((x) => x.id === empresaId);
                    return (
                      <div className="rounded-md bg-primary/10 px-3 py-2 text-sm">
                        <b>{e?.razon_social}</b>
                        <span className="block font-mono text-xs text-muted-foreground">{e?.nif}</span>
                      </div>
                    );
                  })()
                ) : empresas.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No hay empresas dadas de alta. El admin puede añadirlas en Panel → Empresas.
                  </p>
                ) : (
                  <>
                    <Input autoFocus placeholder="Buscar por nombre o NIF…" value={buscarEmpresa}
                      onChange={(ev) => setBuscarEmpresa(ev.target.value)} />
                    <div className="max-h-40 overflow-y-auto">
                      {empresas
                        .filter((e) => {
                          const q = buscarEmpresa.trim().toLowerCase();
                          if (!q) return true;
                          return e.razon_social.toLowerCase().includes(q) || e.nif.toLowerCase().includes(q);
                        })
                        .slice(0, 20)
                        .map((e) => (
                          <button key={e.id} onClick={() => setEmpresaId(e.id)}
                            className="flex w-full flex-col items-start border-b px-1 py-2 text-left text-sm last:border-0 hover:bg-accent">
                            <b>{e.razon_social}</b>
                            <span className="font-mono text-xs text-muted-foreground">{e.nif}</span>
                          </button>
                        ))}
                    </div>
                  </>
                )}
              </div>
            )}

            <Button size="lg" className="font-semibold" onClick={cobrar} disabled={cobrando}>
              {cobrando
                ? "Cobrando…"
                : empresaId
                  ? `Cobrar ${eur(cuenta.pendiente)} y emitir factura`
                  : `Cobrar ${eur(cuenta.pendiente)} e imprimir`}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Mover o unir una mesa. Dos escenarios:
 *  - Mesa libre  -> se mueve la cuenta entera y la de origen se libera.
 *  - Mesa ocupada -> se UNEN las dos cuentas (los productos se suman).
 * Siempre con confirmación explícita, porque unir cuentas no se deshace.
 */
function DialogoMoverMesa({ comandaId, mesaActualId, mesas, zonas, abiertas, onCerrar, onHecho }: {
  comandaId: string; mesaActualId: string | null;
  mesas: Mesa[]; zonas: Zona[]; abiertas: ComandaAbierta[];
  onCerrar: () => void; onHecho: (mensaje: string) => void;
}) {
  const [zonaId, setZonaId] = useState<string | null>(zonas.length === 1 ? zonas[0].id : null);
  const [confirmar, setConfirmar] = useState<{ mesa: Mesa; ocupada: boolean } | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");

  const ocupadaPor = useMemo(
    () => new Map(abiertas.filter((c) => c.mesa_id && c.unidades > 0).map((c) => [c.mesa_id!, c])),
    [abiertas]
  );

  const mover = async (mesa: Mesa) => {
    setEnviando(true);
    setError("");
    try {
      const r = await api<{ modo: string; mesaDestino: string }>(`/comandas/${comandaId}/mover`, {
        method: "POST",
        body: { mesaDestinoId: mesa.id },
      });
      onHecho(
        r.modo === "unida"
          ? `Cuenta unida a la mesa ${r.mesaDestino}`
          : `Cuenta movida a la mesa ${r.mesaDestino}`
      );
    } catch (e) {
      setError((e as Error).message);
      setEnviando(false);
    }
  };

  // Paso de confirmación: distinto texto según mover o unir.
  if (confirmar) {
    const otra = ocupadaPor.get(confirmar.mesa.id);
    return (
      <Dialog open onOpenChange={(o) => !o && setConfirmar(null)}
        title={confirmar.ocupada ? "¿Unir las dos cuentas?" : "¿Mover la cuenta?"}>
        <div className="flex flex-col gap-4">
          {confirmar.ocupada ? (
            <>
              <p className="text-sm">
                La mesa <b>{confirmar.mesa.nombre}</b> ya tiene una cuenta abierta
                {otra && <> de <b className="font-mono">{eur(otra.total)}</b></>}.
              </p>
              <p className="rounded-md bg-warning/15 px-3 py-2 text-sm text-warning">
                Los productos de esta mesa se <b>añadirán</b> a los que ya tiene
                {confirmar.mesa.nombre}, y esta mesa quedará libre. Esto no se puede deshacer.
              </p>
            </>
          ) : (
            <p className="text-sm">
              Toda la cuenta pasará a la mesa <b>{confirmar.mesa.nombre}</b>, que está libre,
              y esta mesa quedará liberada.
            </p>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => setConfirmar(null)} disabled={enviando}>
              Cancelar
            </Button>
            <Button className="flex-1" onClick={() => void mover(confirmar.mesa)} disabled={enviando}>
              {enviando ? "Moviendo…" : confirmar.ocupada ? "Sí, unir" : "Sí, mover"}
            </Button>
          </div>
        </div>
      </Dialog>
    );
  }

  const deZona = mesas.filter((m) => m.zona_id === zonaId && m.id !== mesaActualId);

  return (
    <Dialog open onOpenChange={(o) => !o && onCerrar()} title="Mover a otra mesa">
      <div className="flex flex-col gap-3">
        {!zonaId ? (
          <>
            <p className="text-sm text-muted-foreground">Elige la zona de destino:</p>
            {zonas.map((z) => (
              <Button key={z.id} variant="secondary" className="justify-between" onClick={() => setZonaId(z.id)}>
                <span className="flex items-center gap-2"><Folder className="size-4" /> {z.nombre}</span>
                <ChevronRight className="size-4" />
              </Button>
            ))}
          </>
        ) : (
          <>
            <div className="flex items-center gap-2">
              {zonas.length > 1 && (
                <Button variant="ghost" size="icon-sm" onClick={() => setZonaId(null)} aria-label="Cambiar zona">
                  <ChevronLeft />
                </Button>
              )}
              <p className="flex-1 text-sm text-muted-foreground">
                Toca la mesa de destino. Las <span className="text-success">verdes</span> están libres;
                las <span className="text-destructive">rojas</span> unirán las cuentas.
              </p>
            </div>
            {deZona.length === 0 ? (
              <p className="text-sm text-muted-foreground">No hay otras mesas en esta zona.</p>
            ) : (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(4.6rem,1fr))] gap-2">
                {deZona.map((m) => {
                  const c = ocupadaPor.get(m.id);
                  return (
                    <button key={m.id}
                      onClick={() => setConfirmar({ mesa: m, ocupada: !!c })}
                      className={cn(
                        "flex flex-col items-center gap-0.5 rounded-lg border-[1.5px] bg-card py-2.5 transition-transform active:scale-95",
                        c ? "border-destructive/60 bg-destructive/5" : "border-success/50"
                      )}>
                      <b className="font-display">{m.nombre}</b>
                      <span className="font-mono text-[0.62rem] text-muted-foreground">
                        {c ? eur(c.total) : "libre"}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}
