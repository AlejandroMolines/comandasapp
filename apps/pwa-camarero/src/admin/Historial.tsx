import { Banknote, CreditCard, FileText, Printer, Receipt, Search, Timer, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Dialog, Input, Label, Select, Vacio } from "@/components/ui";
import { cn } from "@/lib/utils";
import { eur } from "../tema";
import { useToast } from "../toast";

interface TicketFila {
  pagoId: string;
  numeroTicket: string | null;
  numeroFactura: string | null;
  cliente_razon_social: string | null;
  cobrado_en: string;
  abierto_en: string;
  metodo: string;
  importe: number;
  total_cuenta: number;
  unidades: number;
  minutos: number | null;
  tipo: string;
  mesa: string | null;
  camarero: string;
}

interface Detalle {
  pagoId: string;
  numeroTicket: string | null;
  cobrado_en: string;
  abierto_en: string;
  cerrado_en: string | null;
  minutos: number | null;
  metodo: string;
  mesa: string | null;
  zona: string | null;
  camarero: string;
  tipo: string;
  totalCuenta: number;
  lineas: {
    cantidad: number; nombre: string; precio_unitario: number; tipo_iva: number;
    notas: string | null; extras: { nombre: string; precio: number }[];
  }[];
  desgloseIva: { tipo: number; base: number; cuota: number; total: number }[];
  pagos: { id: string; metodo: string; importe: number; creado_en: string }[];
  factura: Record<string, unknown> | null;
  vecesReimpreso: number;
}

const hora = (iso: string) => new Date(iso).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
const fechaHora = (iso: string) =>
  new Date(iso).toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "2-digit" }) + " " + hora(iso);
const hoyISO = () => new Date().toISOString().slice(0, 10);

export function VistaHistorial() {
  const [desde, setDesde] = useState(hoyISO());
  const [hasta, setHasta] = useState(hoyISO());
  const [q, setQ] = useState("");
  const [metodo, setMetodo] = useState("");
  const [soloFacturas, setSoloFacturas] = useState(false);
  const [tickets, setTickets] = useState<TicketFila[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [cargando, setCargando] = useState(false);
  const [detalle, setDetalle] = useState<Detalle | null>(null);
  const [toast, avisar] = useToast();
  const LIMITE = 50;

  const buscar = useCallback(async (nuevoOffset = 0) => {
    setCargando(true);
    try {
      const p = new URLSearchParams({
        desde, hasta, limite: String(LIMITE), offset: String(nuevoOffset),
      });
      if (q.trim()) p.set("q", q.trim());
      if (metodo) p.set("metodo", metodo);
      if (soloFacturas) p.set("soloFacturas", "true");
      const r = await api<{ total: number; tickets: TicketFila[] }>(`/historial?${p}`);
      setTickets(r.tickets);
      setTotal(r.total);
      setOffset(nuevoOffset);
    } catch (e) {
      avisar((e as Error).message, true);
    } finally {
      setCargando(false);
    }
  }, [desde, hasta, q, metodo, soloFacturas, avisar]);

  useEffect(() => { void buscar(0); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const sumaVisible = tickets.reduce((a, t) => a + t.importe, 0);

  return (
    <div className="flex flex-col gap-4">
      {toast}
      <h2 className="text-xl">Historial de tickets</h2>

      <Card>
        <CardContent className="flex flex-col gap-3 p-5">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Desde</Label>
              <Input type="date" className="font-mono" value={desde} onChange={(e) => setDesde(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Hasta</Label>
              <Input type="date" className="font-mono" value={hasta} onChange={(e) => setHasta(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Pago</Label>
              <Select className="w-auto" value={metodo} onChange={(e) => setMetodo(e.target.value)}>
                <option value="">Todos</option>
                <option value="efectivo">Efectivo</option>
                <option value="tarjeta">Tarjeta</option>
                <option value="otro">Otro</option>
              </Select>
            </div>
            <Button variant={soloFacturas ? "default" : "secondary"} onClick={() => setSoloFacturas(!soloFacturas)}>
              <FileText /> Solo facturas
            </Button>
          </div>

          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input className="pl-9" placeholder="Nº de ticket, mesa, camarero o cliente…"
                value={q} onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void buscar(0)} />
            </div>
            <Button onClick={() => void buscar(0)} disabled={cargando}>
              {cargando ? "Buscando…" : "Buscar"}
            </Button>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" size="sm" onClick={() => { setDesde(hoyISO()); setHasta(hoyISO()); }}>Hoy</Button>
            <Button variant="ghost" size="sm" onClick={() => {
              const a = new Date(); a.setDate(a.getDate() - 1);
              const d = a.toISOString().slice(0, 10);
              setDesde(d); setHasta(d);
            }}>Ayer</Button>
            <Button variant="ghost" size="sm" onClick={() => {
              const a = new Date(); a.setDate(a.getDate() - 7);
              setDesde(a.toISOString().slice(0, 10)); setHasta(hoyISO());
            }}>Últimos 7 días</Button>
            <Button variant="ghost" size="sm" onClick={() => {
              const a = new Date();
              setDesde(new Date(a.getFullYear(), a.getMonth(), 1).toISOString().slice(0, 10));
              setHasta(hoyISO());
            }}>Este mes</Button>
          </div>
        </CardContent>
      </Card>

      {tickets.length === 0 ? (
        <Vacio titulo="Sin tickets en ese periodo" texto="Cambia las fechas o los filtros y vuelve a buscar." />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="text-muted-foreground">
              {total} tickets · mostrando {offset + 1}–{offset + tickets.length}
            </span>
            <span className="flex-1" />
            <span>Suma visible: <b className="font-mono">{eur(sumaVisible)}</b></span>
          </div>

          <Card>
            <CardContent className="p-0">
              {/* Cabecera solo en pantallas anchas: en móvil las filas se apilan */}
              <div className="hidden gap-3 border-b px-5 py-2.5 text-[0.7rem] font-semibold uppercase tracking-wider text-muted-foreground md:flex">
                <span className="w-36">Nº / Fecha</span>
                <span className="w-24">Mesa</span>
                <span className="flex-1">Camarero</span>
                <span className="w-28 text-right">Entrada/Salida</span>
                <span className="w-16 text-right">Uds</span>
                <span className="w-24 text-right">Importe</span>
                <span className="w-10" />
              </div>
              {tickets.map((t) => (
                <button key={t.pagoId}
                  onClick={() => void api<Detalle>(`/historial/${t.pagoId}`).then(setDetalle)}
                  className="flex w-full flex-wrap items-center gap-3 border-b px-5 py-3 text-left text-sm last:border-0 hover:bg-accent md:flex-nowrap">
                  <span className="w-36">
                    <b className="block font-mono text-xs">{t.numeroTicket ?? "—"}</b>
                    <span className="text-xs text-muted-foreground">{fechaHora(t.cobrado_en)}</span>
                  </span>
                  <span className="w-24">
                    {t.mesa ? <b>{t.mesa}</b> : <Badge variant="warning">llevar</Badge>}
                  </span>
                  <span className="flex-1">
                    {t.camarero}
                    {t.numeroFactura && (
                      <span className="block text-xs text-primary">
                        Factura · {t.cliente_razon_social}
                      </span>
                    )}
                  </span>
                  <span className="w-28 text-right font-mono text-xs text-muted-foreground">
                    {hora(t.abierto_en)}→{hora(t.cobrado_en)}
                    {t.minutos !== null && <span className="block">{t.minutos} min</span>}
                  </span>
                  <span className="w-16 text-right font-mono text-xs">{t.unidades}</span>
                  <span className="w-24 text-right">
                    <b className="font-mono">{eur(t.importe)}</b>
                    <span className="block text-xs text-muted-foreground">
                      {t.metodo === "efectivo" ? "efectivo" : t.metodo}
                    </span>
                  </span>
                  <span className="w-10 text-right">
                    {t.metodo === "efectivo"
                      ? <Banknote className="ml-auto size-4 text-success" />
                      : <CreditCard className="ml-auto size-4 text-primary" />}
                  </span>
                </button>
              ))}
            </CardContent>
          </Card>

          {total > LIMITE && (
            <div className="flex justify-center gap-2">
              <Button variant="secondary" disabled={offset === 0 || cargando}
                onClick={() => void buscar(Math.max(0, offset - LIMITE))}>Anteriores</Button>
              <Button variant="secondary" disabled={offset + LIMITE >= total || cargando}
                onClick={() => void buscar(offset + LIMITE)}>Siguientes</Button>
            </div>
          )}
        </>
      )}

      <Mantenimiento avisar={avisar} />

      {detalle && (
        <DialogoDetalle detalle={detalle} onCerrar={() => setDetalle(null)}
          onReimpreso={(msg) => { avisar(msg); setDetalle(null); }} />
      )}
    </div>
  );
}

function DialogoDetalle({ detalle: d, onCerrar, onReimpreso }: {
  detalle: Detalle; onCerrar: () => void; onReimpreso: (msg: string) => void;
}) {
  const [cajas, setCajas] = useState<{ id: string; nombre: string }[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    void api<{ id: string; nombre: string; tipo: string }[]>("/destinos")
      .then((ds) => setCajas(ds.filter((x) => x.tipo === "impresora_ticket")))
      .catch(() => setCajas([]));
  }, []);

  const reimprimir = async (impresoraId: string) => {
    setEnviando(true);
    setError("");
    try {
      await api(`/historial/${d.pagoId}/reimprimir`, { method: "POST", body: { impresoraId } });
      onReimpreso("Reimprimiendo… saldrá marcado como COPIA");
    } catch (e) {
      setError((e as Error).message);
      setEnviando(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onCerrar()} title={d.numeroTicket ?? "Ticket"}>
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-2 text-sm">
          <span className="text-muted-foreground">Mesa</span>
          <span>{d.mesa ? `${d.mesa}${d.zona ? ` (${d.zona})` : ""}` : "Para llevar"}</span>
          <span className="text-muted-foreground">Camarero</span>
          <span>{d.camarero}</span>
          <span className="text-muted-foreground">Abierta</span>
          <span className="font-mono">{fechaHora(d.abierto_en)}</span>
          <span className="text-muted-foreground">Cobrada</span>
          <span className="font-mono">{fechaHora(d.cobrado_en)}</span>
          {d.minutos !== null && (
            <>
              <span className="text-muted-foreground">Duración</span>
              <span className="flex items-center gap-1 font-mono">
                <Timer className="size-3.5" /> {d.minutos} min
              </span>
            </>
          )}
        </div>

        {/* El ticket tal como se imprimió */}
        <div className="ticket">
          <p className="text-center text-sm font-bold uppercase tracking-wider">{d.numeroTicket ?? "Ticket"}</p>
          <hr className="sep" />
          {d.lineas.map((l, i) => (
            <div key={i}>
              <div className="flex justify-between gap-3">
                <span>{l.cantidad}× {l.nombre}</span>
                <span>{(l.cantidad * l.precio_unitario).toFixed(2)}</span>
              </div>
              {l.extras.map((ex, k) => (
                <div key={k} className="pl-3 text-[0.72rem] opacity-70">
                  {ex.precio > 0 ? `+ ${ex.nombre} (${ex.precio.toFixed(2)})` : `· ${ex.nombre}`}
                </div>
              ))}
              {l.notas && <div className="pl-3 text-[0.72rem] opacity-70">» {l.notas}</div>}
            </div>
          ))}
          <hr className="sep" />
          {d.desgloseIva.map((iv) => (
            <div key={iv.tipo} className="flex justify-between text-[0.72rem]">
              <span>IVA {iv.tipo}%</span>
              <span>base {iv.base.toFixed(2)} · cuota {iv.cuota.toFixed(2)}</span>
            </div>
          ))}
          <hr className="sep" />
          <div className="flex justify-between text-base font-bold">
            <span>TOTAL</span><span>{d.totalCuenta.toFixed(2)} €</span>
          </div>
        </div>

        {/* Pagos: puede haber sido cuenta partida */}
        {d.pagos.length > 1 && (
          <div className="rounded-md bg-muted p-3 text-sm">
            <p className="mb-1 font-semibold">Cuenta partida en {d.pagos.length} pagos:</p>
            {d.pagos.map((p) => (
              <div key={p.id} className="flex justify-between text-xs">
                <span>{hora(p.creado_en)} · {p.metodo}</span>
                <span className="font-mono">{eur(p.importe)}</span>
              </div>
            ))}
          </div>
        )}

        {d.factura && (
          <div className="rounded-md border border-primary/40 bg-primary/5 p-3 text-sm">
            <p className="font-semibold">Factura emitida</p>
            <p className="font-mono text-xs">
              {String(d.factura.serie)}-{String(d.factura.ejercicio)}/
              {String(d.factura.numero).padStart(5, "0")}
            </p>
            <p className="text-xs text-muted-foreground">
              {String(d.factura.cliente_razon_social)} · {String(d.factura.cliente_nif)}
            </p>
          </div>
        )}

        {d.vecesReimpreso > 0 && (
          <p className="text-xs text-muted-foreground">
            Ya se ha reimpreso {d.vecesReimpreso} {d.vecesReimpreso === 1 ? "vez" : "veces"}.
          </p>
        )}

        <div className="flex flex-col gap-2">
          <Label>Reimprimir</Label>
          <p className="text-xs text-muted-foreground">
            El papel saldrá marcado como <b>COPIA</b>: por ley un mismo número no puede
            circular dos veces como original.
          </p>
          {error && <p className="text-sm text-destructive">{error}</p>}
          {cajas.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No hay ninguna impresora de tickets configurada.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {cajas.map((c) => (
                <Button key={c.id} variant="secondary" disabled={enviando}
                  onClick={() => void reimprimir(c.id)}>
                  <Printer /> {c.nombre}
                </Button>
              ))}
            </div>
          )}
        </div>
      </div>
    </Dialog>
  );
}

function Mantenimiento({ avisar }: { avisar: (m: string, mal?: boolean) => void }) {
  const [estado, setEstado] = useState<{
    retencion: { datosNegocioAnios: number; colaImpresionDias: number; reimpresionDias: number };
    comandas: number; pagos: number; facturas: number;
    colaImpresion: number; colaPurgable: number; ticketMasAntiguo: string | null;
  } | null>(null);

  const cargar = useCallback(async () => {
    try { setEstado(await api("/historial/mantenimiento/estado")); } catch { /* sin datos */ }
  }, []);
  useEffect(() => { void cargar(); }, [cargar]);

  if (!estado) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Almacenamiento</CardTitle>
        <p className="text-sm text-muted-foreground">
          Los tickets y facturas se conservan <b>{estado.retencion.datosNegocioAnios} años</b>
          {" "}(la ley obliga a 4). Ocupan muy poco: un restaurante con mucha actividad genera
          unos 57 MB al año, así que no hay motivo para borrar el historial de ventas.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          <div><b className="font-mono text-lg">{estado.pagos}</b><span className="block text-xs text-muted-foreground">tickets</span></div>
          <div><b className="font-mono text-lg">{estado.facturas}</b><span className="block text-xs text-muted-foreground">facturas</span></div>
          <div><b className="font-mono text-lg">{estado.comandas}</b><span className="block text-xs text-muted-foreground">comandas</span></div>
          <div><b className="font-mono text-lg">{estado.colaImpresion}</b><span className="block text-xs text-muted-foreground">en cola impresión</span></div>
        </div>
        {estado.ticketMasAntiguo && (
          <p className="text-xs text-muted-foreground">
            Ticket más antiguo: {fechaHora(estado.ticketMasAntiguo)}
          </p>
        )}
        <div className={cn("rounded-md p-3 text-sm", estado.colaPurgable > 0 ? "bg-warning/10" : "bg-muted")}>
          <p>
            La <b>cola de impresión</b> guarda los bytes de cada ticket generado y es lo único
            que engorda de verdad (~75 MB al año). Se puede limpiar lo ya impreso de hace más
            de {estado.retencion.colaImpresionDias} días sin perder nada: los tickets se
            reconstruyen desde la comanda.
          </p>
          {estado.colaPurgable > 0 && (
            <Button variant="secondary" size="sm" className="mt-2"
              onClick={() => void api<{ borrados: number }>("/historial/mantenimiento/purgar", { method: "POST" })
                .then((r) => { avisar(`${r.borrados} registros de impresión limpiados`); void cargar(); })
                .catch((e) => avisar((e as Error).message, true))}>
              <Trash2 /> Limpiar {estado.colaPurgable} registros
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Se pueden reimprimir tickets de los últimos {estado.retencion.reimpresionDias} días.
          Para los más antiguos, consulta el detalle o usa el informe en Excel.
        </p>
      </CardContent>
    </Card>
  );
}
