import { useCallback, useEffect, useState } from "react";
import { DoorClosed, Download } from "lucide-react";
import { Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../api";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Dialog, Input, Label, Select, Vacio } from "@/components/ui";
import { eur, fecha } from "../tema";
import { useToast } from "../toast";
import { descargarInforme, rangoPreset, type Agrupacion } from "../informe";

interface Resumen {
  turno: { id: string; abierto_en: string; cerrado_en: string | null; caja_inicial: number };
  cajaInicial?: number;
  facturacion: { total: number; propinas: number; numPagos: number; ticketMedio: number };
  porMetodo: { metodo: string; total: number }[];
  comandasPorTipo: { tipo: string; n: number }[];
  mesasSentadas: number;
  comandasCerradas: number;
  topProductos: { nombre: string; unidades: number; importe: number }[];
  porCamarero: { nombre: string; rol: string; comandas: number; mesas: number; llevar: number; importe: number }[];
  duracionMesa: { media: number | null; maxima: number | null };
}

const COLOR_METODO: Record<string, string> = {
  efectivo: "var(--success)",
  tarjeta: "var(--primary)",
  otro: "var(--muted-foreground)",
};

const TOOLTIP_STYLE = {
  background: "var(--popover)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  fontFamily: "var(--font-mono)",
  fontSize: 12,
} as const;

function Stat({ valor, etiqueta }: { valor: string | number; etiqueta: string }) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="font-mono text-2xl font-semibold tabular-nums tracking-tight">{valor}</div>
        <div className="mt-0.5 text-[0.72rem] font-medium uppercase tracking-wider text-muted-foreground">{etiqueta}</div>
      </CardContent>
    </Card>
  );
}

export function VistaResumen() {
  const [turnos, setTurnos] = useState<{ id: string; abierto_en: string; cerrado_en: string | null; caja_inicial: number }[]>([]);
  const [turnoId, setTurnoId] = useState<string | null>(null);
  const [r, setR] = useState<Resumen | null>(null);
  const [cerrando, setCerrando] = useState(false);
  const [cajaContada, setCajaContada] = useState("");
  const [cierre, setCierre] = useState<{ efectivoEsperado: number; descuadre: number } | null>(null);
  const [descargando, setDescargando] = useState(false);
  const [toast, avisar] = useToast();

  const cargar = useCallback(async () => {
    const ts = await api<typeof turnos>("/turnos");
    setTurnos(ts);
    setTurnoId((prev) => prev ?? ts[0]?.id ?? null);
    return ts;
  }, []);

  useEffect(() => { void cargar(); }, [cargar]);

  useEffect(() => {
    if (turnoId) void api<Resumen>(`/turnos/${turnoId}/resumen`).then(setR);
  }, [turnoId]);

  const turnoActual = turnos.find((t) => t.id === turnoId);
  const esTurnoAbierto = turnoActual && !turnoActual.cerrado_en;

  const cerrarTurno = async () => {
    if (!turnoId) return;
    try {
      const res = await api<{ efectivoEsperado: number; descuadre: number }>(
        `/turnos/${turnoId}/cerrar`,
        { method: "POST", body: { cajaFinal: parseFloat(cajaContada) || 0 } }
      );
      setCierre(res);
      setCajaContada("");
      setCerrando(false);
      avisar("Turno cerrado · el siguiente ya está abierto");
      const ts = await cargar();
      // Pasamos a ver el turno que acabamos de cerrar, que es el interesante.
      if (ts.length) setTurnoId(ts.find((t) => t.id === turnoId)?.id ?? ts[0].id);
    } catch (e) {
      avisar((e as Error).message, true);
    }
  };

  const descargar = async (agrupacion: Agrupacion, preset: Parameters<typeof rangoPreset>[0]) => {
    setDescargando(true);
    try {
      const { desde, hasta } = rangoPreset(preset);
      await descargarInforme(desde, hasta, agrupacion);
      avisar("Informe descargado");
    } catch (e) {
      avisar((e as Error).message, true);
    } finally {
      setDescargando(false);
    }
  };

  if (turnos.length === 0)
    return <Vacio titulo="Sin turnos todavía" texto="Abre el primer turno en la pestaña Turnos y aquí verás cómo va el servicio." />;

  return (
    <div className="flex flex-col gap-4">
      {toast}
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="flex-1 text-xl">Resumen del servicio</h2>
        <Select className="w-auto font-mono text-xs" value={turnoId ?? ""} onChange={(e) => { setTurnoId(e.target.value); setCierre(null); }}>
          {turnos.map((t) => (
            <option key={t.id} value={t.id}>
              {fecha(t.abierto_en)} {t.cerrado_en ? "" : "· EN CURSO"}
            </option>
          ))}
        </Select>
        {esTurnoAbierto && (
          <Button variant="destructive" onClick={() => setCerrando(true)}>
            <DoorClosed /> Cerrar turno
          </Button>
        )}
      </div>

      {r && (
        <>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(9.5rem,1fr))] gap-3">
            <Stat valor={eur(r.turno.caja_inicial)} etiqueta="Caja inicial" />
            <Stat valor={eur(r.facturacion.total)} etiqueta="Facturado" />
            <Stat valor={eur(r.facturacion.ticketMedio)} etiqueta="Ticket medio" />
            <Stat valor={r.mesasSentadas} etiqueta="Mesas sentadas" />
            <Stat valor={r.comandasPorTipo.find((c) => c.tipo === "llevar")?.n ?? 0} etiqueta="Para llevar" />
            <Stat valor={eur(r.facturacion.propinas)} etiqueta="Propinas" />
            <Stat
              valor={r.duracionMesa.media !== null ? `${r.duracionMesa.media} min` : "—"}
              etiqueta="Tiempo medio mesa" />
          </div>

          <div className="grid items-start gap-4 lg:grid-cols-3">
            <Card>
              <CardHeader><CardTitle>Ventas por método</CardTitle></CardHeader>
              <CardContent>
                {r.porMetodo.length === 0 ? <p className="text-sm text-muted-foreground">Aún sin cobros</p> : (
                  <>
                    <ResponsiveContainer width="100%" height={190}>
                      <PieChart>
                        <Pie data={r.porMetodo} dataKey="total" nameKey="metodo" innerRadius={50} outerRadius={76} paddingAngle={3} strokeWidth={0}>
                          {r.porMetodo.map((m) => <Cell key={m.metodo} fill={COLOR_METODO[m.metodo] ?? "var(--muted-foreground)"} />)}
                        </Pie>
                        <Tooltip formatter={(v: number, n: string) => [eur(v), n]} contentStyle={TOOLTIP_STYLE} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                      {r.porMetodo.map((m) => (
                        <span key={m.metodo} className="flex items-center gap-1.5">
                          <span className="size-2 rounded-full" style={{ background: COLOR_METODO[m.metodo] }} />
                          {m.metodo} <b className="font-mono text-foreground">{eur(m.total)}</b>
                        </span>
                      ))}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Unidades por producto</CardTitle></CardHeader>
              <CardContent>
                {r.topProductos.length === 0 ? <p className="text-sm text-muted-foreground">Aún sin ventas</p> : (
                  <ResponsiveContainer width="100%" height={210}>
                    <BarChart data={r.topProductos.slice(0, 6)} layout="vertical" margin={{ left: 4, right: 12 }}>
                      <XAxis type="number" hide />
                      <YAxis type="category" dataKey="nombre" width={104} tick={{ fill: "var(--muted-foreground)", fontSize: 12 }} axisLine={false} tickLine={false} />
                      <Tooltip formatter={(v: number) => [`${v} uds`, ""]} contentStyle={TOOLTIP_STYLE} cursor={{ fill: "var(--accent)" }} />
                      <Bar dataKey="unidades" fill="var(--primary)" radius={[0, 6, 6, 0]} barSize={16} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            {/* la firma: el top de ventas impreso como ticket */}
            <div className="ticket">
              <p className="text-center text-sm font-semibold uppercase tracking-[0.15em]">Más vendidos</p>
              <hr className="sep" />
              {r.topProductos.length === 0 && <p className="text-center text-[0.76rem] opacity-60">— sin ventas aún —</p>}
              {r.topProductos.map((p, i) => (
                <div className="flex justify-between gap-3" key={p.nombre}>
                  <span>{i + 1}. {p.nombre}</span>
                  <span className="whitespace-nowrap">{p.unidades} · {eur(p.importe)}</span>
                </div>
              ))}
              <hr className="sep" />
              <div className="flex justify-between text-base font-bold">
                <span>{r.comandasCerradas} comandas</span>
                <span>{eur(r.facturacion.total)}</span>
              </div>
            </div>
          </div>

          {/* Ticket de cierre recién hecho */}
          {cierre && (
            <div className="ticket mx-auto w-full max-w-[20rem]">
              <p className="text-center text-sm font-semibold uppercase tracking-[0.15em]">Cierre de caja</p>
              <hr className="sep" />
              <div className="flex justify-between"><span>Efectivo esperado</span><span>{eur(cierre.efectivoEsperado)}</span></div>
              <div className="flex justify-between text-base font-bold">
                <span>Descuadre</span>
                <span className={Math.abs(cierre.descuadre) > 0.01 ? "text-red-800" : ""}>
                  {cierre.descuadre >= 0 ? "+" : ""}{eur(cierre.descuadre)}
                </span>
              </div>
            </div>
          )}

          {/* Descarga de informes a Excel */}
          <Card>
            <CardHeader>
              <CardTitle>Descargar informe en Excel</CardTitle>
              <p className="text-sm text-muted-foreground">
                Incluye ingresos por método de pago, cierres de caja con la caja inicial,
                desglose de IVA para el trimestre, productos vendidos y facturas emitidas.
              </p>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label>Diario</Label>
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" size="sm" disabled={descargando} onClick={() => void descargar("dia", "hoy")}>
                    <Download /> Hoy
                  </Button>
                  <Button variant="secondary" size="sm" disabled={descargando} onClick={() => void descargar("dia", "ayer")}>
                    <Download /> Ayer
                  </Button>
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Semanal</Label>
                <Button variant="secondary" size="sm" className="self-start" disabled={descargando}
                  onClick={() => void descargar("dia", "semana")}>
                  <Download /> Esta semana (día a día)
                </Button>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Mensual</Label>
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" size="sm" disabled={descargando} onClick={() => void descargar("dia", "mes")}>
                    <Download /> Este mes (día a día)
                  </Button>
                  <Button variant="secondary" size="sm" disabled={descargando} onClick={() => void descargar("dia", "mes-pasado")}>
                    <Download /> Mes pasado
                  </Button>
                  <Button variant="secondary" size="sm" disabled={descargando} onClick={() => void descargar("semana", "mes")}>
                    <Download /> Este mes por semanas
                  </Button>
                </div>
              </div>
              {descargando && <p className="text-sm text-muted-foreground">Generando el archivo…</p>}
            </CardContent>
          </Card>

          {/* Rendimiento por persona: mesas atendidas y facturado */}
          <Card>
            <CardHeader><CardTitle>Por camarero</CardTitle></CardHeader>
            <CardContent>
              {r.porCamarero.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nadie ha tomado comandas en este turno.</p>
              ) : (
                <div className="flex flex-col">
                  <div className="flex gap-3 border-b pb-2 text-[0.7rem] font-semibold uppercase tracking-wider text-muted-foreground">
                    <span className="flex-1">Nombre</span>
                    <span className="w-14 text-right">Mesas</span>
                    <span className="w-16 text-right">Llevar</span>
                    <span className="w-24 text-right">Facturado</span>
                  </div>
                  {r.porCamarero.map((c) => (
                    <div key={c.nombre} className="flex items-center gap-3 border-b py-2.5 text-sm last:border-0">
                      <span className="flex-1 font-medium">
                        {c.nombre}
                        {c.rol === "admin" && <Badge className="ml-2">admin</Badge>}
                      </span>
                      <span className="w-14 text-right font-mono">{c.mesas}</span>
                      <span className="w-16 text-right font-mono text-muted-foreground">{c.llevar}</span>
                      <span className="w-24 text-right font-mono">{eur(c.importe)}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* Cierre de turno desde el propio resumen */}
      <Dialog open={cerrando} onOpenChange={(o) => !o && setCerrando(false)} title="Cerrar turno">
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            Cuenta el efectivo que hay en el cajón e introdúcelo. Se calculará el descuadre
            y se abrirá el turno siguiente automáticamente.
          </p>
          {turnoActual && (
            <p className="rounded-md bg-muted px-3 py-2 text-sm">
              Caja inicial de este turno: <b className="font-mono">{eur(turnoActual.caja_inicial)}</b>
            </p>
          )}
          <div className="flex flex-col gap-1.5">
            <Label>Efectivo contado (€)</Label>
            <Input autoFocus inputMode="decimal" className="font-mono" placeholder="0,00"
              value={cajaContada} onChange={(e) => setCajaContada(e.target.value.replace(",", "."))}
              onKeyDown={(e) => e.key === "Enter" && cajaContada && void cerrarTurno()} />
          </div>
          <Button variant="destructive" disabled={!cajaContada} onClick={() => void cerrarTurno()}>
            Cerrar turno y abrir el siguiente
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
