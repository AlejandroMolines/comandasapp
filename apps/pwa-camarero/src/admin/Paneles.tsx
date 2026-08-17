import { Monitor, Moon, Plus, Printer, RefreshCw, Sun, Trash2, Usb } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Dialog, Input, Label, Select, Switch, Vacio } from "@/components/ui";
import { cn } from "@/lib/utils";
import { ACENTOS, aplicarAcento, aplicarModo, eur, fecha, getModo, tintaPara, type Modo } from "../tema";
import { useToast } from "../toast";

/* ═══════════════════════════════════════════════════════════ SALAS */
interface Zona { id: string; nombre: string }
interface Mesa { id: string; zona_id: string; nombre: string; capacidad: number; estado: string }

export function VistaSalas() {
  const [zonas, setZonas] = useState<Zona[]>([]);
  const [mesas, setMesas] = useState<Mesa[]>([]);
  const [modal, setModal] = useState<{ t: "zona" } | { t: "mesa"; zona: Zona } | null>(null);
  const [toast, avisar] = useToast();

  const cargar = useCallback(async () => {
    setZonas(await api<Zona[]>("/espacios/zonas"));
    setMesas(await api<Mesa[]>("/espacios/mesas"));
  }, []);
  useEffect(() => { void cargar(); }, [cargar]);

  const accion = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); avisar(ok); setModal(null); await cargar(); }
    catch (e) { avisar((e as Error).message, true); }
  };

  return (
    <div className="flex flex-col gap-4">
      {toast}
      <div className="flex items-center gap-3">
        <h2 className="flex-1 text-xl">Salas y mesas</h2>
        <Button variant="secondary" onClick={() => setModal({ t: "zona" })}><Plus /> Nueva zona</Button>
      </div>
      {zonas.length === 0 && (
        <Vacio titulo="Sin zonas" texto="Crea las zonas de tu local: Sala, Terraza, Barra…"
          accion={<Button onClick={() => setModal({ t: "zona" })}><Plus /> Crear zona</Button>} />
      )}
      {zonas.map((z) => (
        <Card key={z.id}>
          <CardHeader className="flex-row items-center gap-2">
            <CardTitle className="flex-1">{z.nombre}</CardTitle>
            <Button variant="secondary" size="sm" onClick={() => setModal({ t: "mesa", zona: z })}><Plus /> Mesa</Button>
            <Button variant="ghost" size="icon-sm"
              onClick={() => confirm(`¿Eliminar la zona "${z.nombre}"?`) && accion(() => api(`/espacios/zonas/${z.id}`, { method: "DELETE" }), "Zona eliminada")}>
              <Trash2 />
            </Button>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(6rem,1fr))] gap-2.5">
              {mesas.filter((m) => m.zona_id === z.id).map((m) => (
                <div key={m.id} className={cn(
                  "group relative flex flex-col items-center gap-0.5 rounded-lg border-[1.5px] bg-background py-3",
                  m.estado === "libre" && "border-success/40",
                  m.estado === "ocupada" && "border-destructive/50",
                )}>
                  <b className="font-display text-lg">{m.nombre}</b>
                  <span className="text-xs text-muted-foreground">{m.capacidad} pax</span>
                  <Button variant="ghost" size="icon-sm" className="absolute right-0.5 top-0.5 opacity-0 transition-opacity group-hover:opacity-100"
                    onClick={() => confirm(`¿Eliminar ${m.nombre}?`) && accion(() => api(`/espacios/mesas/${m.id}`, { method: "DELETE" }), "Mesa eliminada")}>
                    <Trash2 className="!size-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ))}

      <FormZona abierto={modal?.t === "zona"} onCerrar={() => setModal(null)}
        onOk={(nombre) => accion(() => api("/espacios/zonas", { method: "POST", body: { nombre } }), "Zona creada")} />
      <FormMesa abierto={modal?.t === "mesa"} zona={modal?.t === "mesa" ? modal.zona : null} onCerrar={() => setModal(null)}
        onIndividual={(nombre, capacidad) => modal?.t === "mesa" && accion(() => api("/espacios/mesas", {
          method: "POST", body: { zonaId: modal.zona.id, nombre, capacidad },
        }), "Mesa creada")}
        onLote={(prefijo, cantidad, desde, capacidad) => modal?.t === "mesa" && accion(async () => {
          const r = await api<{ creadas: string[]; omitidas: string[] }>("/espacios/mesas/lote", {
            method: "POST", body: { zonaId: modal.zona.id, prefijo, cantidad, desde, capacidad },
          });
          if (r.omitidas.length) throw new Error(`${r.creadas.length} creadas · ya existían: ${r.omitidas.join(", ")}`);
        }, `${cantidad} mesas creadas`)} />
    </div>
  );
}

function FormZona({ abierto, onOk, onCerrar }: { abierto: boolean; onOk: (n: string) => void; onCerrar: () => void }) {
  const [nombre, setNombre] = useState("");
  useEffect(() => { if (abierto) setNombre(""); }, [abierto]);
  return (
    <Dialog open={abierto} onOpenChange={(o) => !o && onCerrar()} title="Nueva zona">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label>Nombre</Label>
          <Input autoFocus placeholder="Sala, Terraza, Barra…" value={nombre} onChange={(e) => setNombre(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && nombre && onOk(nombre)} />
        </div>
        <Button disabled={!nombre} onClick={() => onOk(nombre)}>Crear</Button>
      </div>
    </Dialog>
  );
}

function FormMesa({ abierto, zona, onIndividual, onLote, onCerrar }: {
  abierto: boolean; zona: Zona | null;
  onIndividual: (n: string, c: number) => void;
  onLote: (prefijo: string, cantidad: number, desde: number, c: number) => void;
  onCerrar: () => void;
}) {
  const [tab, setTab] = useState<"una" | "varias">("una");
  const [nombre, setNombre] = useState("");
  const [capacidad, setCapacidad] = useState("4");
  const [prefijo, setPrefijo] = useState("");
  const [cantidad, setCantidad] = useState("10");
  const [desde, setDesde] = useState("1");
  useEffect(() => {
    if (abierto) { setTab("una"); setNombre(""); setCapacidad("4"); setPrefijo(""); setCantidad("10"); setDesde("1"); }
  }, [abierto]);

  const n = parseInt(cantidad) || 0;
  const d = parseInt(desde) || 1;
  // Vista previa de los nombres que se van a crear — evita sorpresas.
  const previa = n > 0
    ? [`${prefijo}${d}`, `${prefijo}${d + 1}`, "…", `${prefijo}${d + n - 1}`].join(", ")
    : "";

  return (
    <Dialog open={abierto} onOpenChange={(o) => !o && onCerrar()} title={`Nuevas mesas en ${zona?.nombre ?? ""}`}>
      <div className="mb-4 flex gap-2">
        <Button className="flex-1" variant={tab === "una" ? "default" : "secondary"} onClick={() => setTab("una")}>Una mesa</Button>
        <Button className="flex-1" variant={tab === "varias" ? "default" : "secondary"} onClick={() => setTab("varias")}>Varias a la vez</Button>
      </div>

      {tab === "una" ? (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label>Nombre</Label>
            <Input autoFocus placeholder="S1, T3…" value={nombre} onChange={(e) => setNombre(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Comensales</Label>
            <Input inputMode="numeric" className="font-mono" value={capacidad} onChange={(e) => setCapacidad(e.target.value)} />
          </div>
          <Button disabled={!nombre} onClick={() => onIndividual(nombre, parseInt(capacidad) || 4)}>Crear</Button>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex gap-3">
            <div className="flex w-24 flex-col gap-1.5">
              <Label>Letra</Label>
              <Input placeholder="T" maxLength={4} className="font-mono" value={prefijo} onChange={(e) => setPrefijo(e.target.value)} />
            </div>
            <div className="flex flex-1 flex-col gap-1.5">
              <Label>Cuántas</Label>
              <Input inputMode="numeric" className="font-mono" value={cantidad} onChange={(e) => setCantidad(e.target.value)} />
            </div>
            <div className="flex w-24 flex-col gap-1.5">
              <Label>Desde</Label>
              <Input inputMode="numeric" className="font-mono" value={desde} onChange={(e) => setDesde(e.target.value)} />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Comensales por mesa</Label>
            <Input inputMode="numeric" className="font-mono" value={capacidad} onChange={(e) => setCapacidad(e.target.value)} />
          </div>
          {previa && (
            <p className="rounded-md bg-muted px-3 py-2 font-mono text-xs text-muted-foreground">
              Se crearán: {previa}
            </p>
          )}
          <p className="text-xs text-muted-foreground">La letra es opcional. Sin ella las mesas serán 1, 2, 3…</p>
          <Button disabled={n < 1} onClick={() => onLote(prefijo, n, d, parseInt(capacidad) || 4)}>
            Crear {n} mesas
          </Button>
        </div>
      )}
    </Dialog>
  );
}

/* ═══════════════════════════════════════════════════ IMPRESORAS */
interface Destino { id: string; nombre: string; tipo: string; protocolo: string; estado_salud: string; config: Record<string, unknown> }
interface Incidencia { id: string; destino: string; ultimo_error: string }

export function VistaImpresoras() {
  const [destinos, setDestinos] = useState<Destino[]>([]);
  const [incidencias, setIncidencias] = useState<Incidencia[]>([]);
  const [crear, setCrear] = useState(false);
  const [toast, avisar] = useToast();

  const cargar = useCallback(async () => {
    setDestinos(await api<Destino[]>("/destinos"));
    setIncidencias(await api<Incidencia[]>("/destinos/incidencias"));
  }, []);
  useEffect(() => {
    void cargar();
    const t = setInterval(() => void cargar(), 15000);
    return () => clearInterval(t);
  }, [cargar]);

  const accion = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); avisar(ok); setCrear(false); await cargar(); }
    catch (e) { avisar((e as Error).message, true); }
  };

  return (
    <div className="flex flex-col gap-4">
      {toast}
      <div className="flex items-center gap-3">
        <h2 className="flex-1 text-xl">Impresoras y pantallas</h2>
        <Button variant="secondary" onClick={() => setCrear(true)}><Plus /> Añadir</Button>
      </div>

      {incidencias.length > 0 && (
        <Card className="border-destructive/40">
          <CardHeader><CardTitle className="text-destructive">⚠ Tickets sin imprimir</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-2">
            {incidencias.map((inc) => (
              <div key={inc.id} className="flex items-center gap-3 text-sm">
                <span className="flex-1"><b>{inc.destino}</b> <span className="text-muted-foreground">· {inc.ultimo_error}</span></span>
                <Button variant="secondary" size="sm" onClick={() => accion(() =>
                  api(`/destinos/incidencias/${inc.id}/reintentar`, { method: "POST" }), "Reenviado a la cola")}>
                  <RefreshCw /> Reintentar
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {destinos.length === 0 ? (
        <Vacio titulo="Sin impresoras" texto="Añade la impresora de barra, las de cocina y la de tickets para que las comandas lleguen a su sitio."
          accion={<Button onClick={() => setCrear(true)}><Plus /> Añadir la primera</Button>} />
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-3">
          {destinos.map((d) => {
            const Icono = d.tipo === "pantalla_kds" ? Monitor : d.protocolo === "escpos_usb" ? Usb : Printer;
            return (
              <Card key={d.id} className="group relative">
                <CardContent className="flex flex-col gap-2 p-5">
                  <div className="flex items-center gap-2">
                    <Icono className="size-5" />
                    <b className="flex-1">{d.nombre}</b>
                    <span className={cn(
                      "size-2.5 rounded-full",
                      d.estado_salud === "ok" && "bg-success shadow-[0_0_8px] shadow-success/60",
                      d.estado_salud === "caido" && "bg-destructive shadow-[0_0_8px] shadow-destructive/60",
                      d.estado_salud === "desconocido" && "bg-muted-foreground/40",
                    )} title={d.estado_salud} />
                  </div>
                  <span className="font-mono text-xs text-muted-foreground">
                    {d.protocolo === "escpos_red" && `${d.config.ip}:${d.config.puerto}`}
                    {d.protocolo === "escpos_usb" && String(d.config.rutaDispositivo)}
                    {d.protocolo === "websocket_kds" && `canal ${d.config.canal}`}
                  </span>
                  <Badge className="self-start">{d.tipo.replace(/_/g, " ")}</Badge>
                  <Button variant="ghost" size="icon-sm" className="absolute bottom-3 right-3 opacity-0 transition-opacity group-hover:opacity-100"
                    onClick={() => confirm(`¿Eliminar "${d.nombre}"?`) && accion(() => api(`/destinos/${d.id}`, { method: "DELETE" }), "Destino eliminado")}>
                    <Trash2 />
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <FormDestino abierto={crear} onCerrar={() => setCrear(false)}
        onOk={(body) => accion(() => api("/destinos", { method: "POST", body }), "Destino creado")} />
    </div>
  );
}

function FormDestino({ abierto, onOk, onCerrar }: { abierto: boolean; onOk: (b: unknown) => void; onCerrar: () => void }) {
  const [nombre, setNombre] = useState("");
  const [tipo, setTipo] = useState("impresora_termica");
  const [protocolo, setProtocolo] = useState("escpos_red");
  const [ip, setIp] = useState("");
  const [puerto, setPuerto] = useState("9100");
  const [ruta, setRuta] = useState("/dev/usb/lp0");
  const [canal, setCanal] = useState("");
  useEffect(() => { if (abierto) { setNombre(""); setIp(""); setCanal(""); } }, [abierto]);

  const config =
    protocolo === "escpos_red" ? { ip, puerto: parseInt(puerto) || 9100 }
    : protocolo === "escpos_usb" ? { rutaDispositivo: ruta }
    : { canal };
  const valido = nombre && (protocolo !== "escpos_red" || ip) && (protocolo !== "websocket_kds" || canal);

  return (
    <Dialog open={abierto} onOpenChange={(o) => !o && onCerrar()} title="Nueva impresora o pantalla">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label>Nombre</Label>
          <Input autoFocus placeholder="Barra, Cocina fría, Caja 1…" value={nombre} onChange={(e) => setNombre(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Función</Label>
          <Select value={tipo} onChange={(e) => setTipo(e.target.value)}>
            <option value="impresora_termica">Comandas (cocina/barra)</option>
            <option value="pantalla_kds">Pantalla de cocina</option>
            <option value="impresora_ticket">Tickets de pago (caja)</option>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Conexión</Label>
          <Select value={protocolo} onChange={(e) => setProtocolo(e.target.value)}>
            <option value="escpos_red">Red (IP)</option>
            <option value="escpos_usb">USB</option>
            <option value="websocket_kds">Pantalla conectada</option>
          </Select>
        </div>
        {protocolo === "escpos_red" && (
          <div className="flex gap-3">
            <div className="flex flex-1 flex-col gap-1.5">
              <Label>IP</Label>
              <Input className="font-mono" placeholder="192.168.1.50" value={ip} onChange={(e) => setIp(e.target.value)} />
            </div>
            <div className="flex w-24 flex-col gap-1.5">
              <Label>Puerto</Label>
              <Input className="font-mono" value={puerto} onChange={(e) => setPuerto(e.target.value)} />
            </div>
          </div>
        )}
        {protocolo === "escpos_usb" && (
          <div className="flex flex-col gap-1.5">
            <Label>Dispositivo</Label>
            <Input className="font-mono" value={ruta} onChange={(e) => setRuta(e.target.value)} />
          </div>
        )}
        {protocolo === "websocket_kds" && (
          <div className="flex flex-col gap-1.5">
            <Label>Canal</Label>
            <Input placeholder="cocina-fria" value={canal} onChange={(e) => setCanal(e.target.value)} />
          </div>
        )}
        <Button disabled={!valido} onClick={() => onOk({ nombre, tipo, protocolo, config })}>Añadir</Button>
      </div>
    </Dialog>
  );
}

/* ═══════════════════════════════════════════════════ TURNOS */
interface Turno { id: string; abierto_en: string; cerrado_en: string | null; caja_inicial: number; caja_final: number | null }

export function VistaTurnos() {
  const [turnos, setTurnos] = useState<Turno[]>([]);
  const [caja, setCaja] = useState("");
  const [inicial, setInicial] = useState("");
  const [cierre, setCierre] = useState<{ efectivoEsperado: number; descuadre: number } | null>(null);
  const [toast, avisar] = useToast();

  const cargar = useCallback(async () => setTurnos(await api<Turno[]>("/turnos")), []);
  useEffect(() => { void cargar(); }, [cargar]);

  const activo = turnos.find((t) => !t.cerrado_en);

  // Reflejar en el input la caja inicial que ya tiene el turno abierto.
  useEffect(() => {
    if (activo) setInicial(String(activo.caja_inicial));
  }, [activo?.id, activo?.caja_inicial]);

  const guardarInicial = async () => {
    if (!activo) return;
    try {
      await api(`/turnos/${activo.id}/caja-inicial`, {
        method: "PATCH", body: { cajaInicial: parseFloat(inicial) || 0 },
      });
      avisar("Caja inicial guardada"); await cargar();
    } catch (e) { avisar((e as Error).message, true); }
  };

  // El turno siempre esta abierto: si aun no hay, /turnos/activo lo abre solo.
  useEffect(() => {
    if (turnos.length > 0 && !activo) {
      void api("/turnos/activo").then(() => cargar());
    }
  }, [turnos, activo, cargar]);

  const cerrar = async () => {
    if (!activo) return;
    try {
      const r = await api<{ efectivoEsperado: number; descuadre: number }>(`/turnos/${activo.id}/cerrar`, {
        method: "POST", body: { cajaFinal: parseFloat(caja) || 0 },
      });
      setCierre(r); setCaja("");
      avisar("Turno cerrado · el siguiente ya esta abierto");
      await cargar();
    } catch (e) { avisar((e as Error).message, true); }
  };

  return (
    <div className="flex flex-col gap-4">
      {toast}
      <h2 className="text-xl">Turnos</h2>
      <Card>
        <CardContent className="flex flex-col gap-4 p-5">
          {activo ? (
            <>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="size-2.5 rounded-full bg-success shadow-[0_0_8px] shadow-success/60" />
                <b>Turno en curso</b>
                <span className="flex-1 text-muted-foreground">desde {fecha(activo.abierto_en)}</span>
              </div>

              {/* La caja inicial se puede corregir en cualquier momento del turno:
                  a menudo se cuenta el cajón un rato después de abrir. */}
              <div className="flex items-end gap-3 border-b pb-4">
                <div className="flex flex-1 flex-col gap-1.5">
                  <Label>Fondo de caja fijo (€)</Label>
                  <Input inputMode="decimal" className="font-mono" placeholder="0,00" value={inicial}
                    onChange={(e) => setInicial(e.target.value.replace(",", "."))} />
                </div>
                <Button variant="secondary" disabled={!inicial} onClick={guardarInicial}>Guardar</Button>
              </div>
              <p className="-mt-2 mb-2 text-xs text-muted-foreground">
                Este es el dinero con el que se empieza cada turno. Se aplica también a los
                turnos siguientes y <b>no cambia solo</b> al cerrar caja: solo se modifica aquí.
              </p>

              <div className="flex items-end gap-3">
                <div className="flex flex-1 flex-col gap-1.5">
                  <Label>Efectivo contado al cierre (€)</Label>
                  <Input inputMode="decimal" className="font-mono" placeholder="0,00" value={caja}
                    onChange={(e) => setCaja(e.target.value.replace(",", "."))} />
                </div>
                <Button variant="destructive" onClick={cerrar} disabled={!caja}>Cerrar turno y abrir el siguiente</Button>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Preparando el turno…</p>
          )}
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
        </CardContent>
      </Card>

      <h3 className="text-sm font-medium text-muted-foreground">Historial</h3>
      <Card>
        <CardContent className="flex flex-col p-5">
          {turnos.filter((t) => t.cerrado_en).map((t) => (
            <div key={t.id} className="flex items-center gap-3 border-b py-2.5 text-sm last:border-0">
              <span className="flex-1">{fecha(t.abierto_en)}</span>
              <span className="font-mono text-xs text-muted-foreground">{eur(t.caja_inicial)} → {t.caja_final !== null ? eur(t.caja_final) : "—"}</span>
            </div>
          ))}
          {turnos.filter((t) => t.cerrado_en).length === 0 && <p className="text-sm text-muted-foreground">Aún no hay turnos cerrados.</p>}
        </CardContent>
      </Card>
    </div>
  );
}

/* ═══════════════════════════════════════════════════ PERSONAL */
interface Usuario { id: string; nombre: string; rol: string; activo: number }

export function VistaPersonal() {
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [crear, setCrear] = useState(false);
  const [toast, avisar] = useToast();

  const cargar = useCallback(async () => setUsuarios(await api<Usuario[]>("/usuarios")), []);
  useEffect(() => { void cargar(); }, [cargar]);

  const accion = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); avisar(ok); setCrear(false); await cargar(); }
    catch (e) { avisar((e as Error).message, true); }
  };

  return (
    <div className="flex flex-col gap-4">
      {toast}
      <div className="flex items-center gap-3">
        <h2 className="flex-1 text-xl">Personal</h2>
        <Button variant="secondary" onClick={() => setCrear(true)}><Plus /> Nuevo camarero</Button>
      </div>
      <Card>
        <CardContent className="flex flex-col p-5">
          {usuarios.map((u) => (
            <div key={u.id} className="flex items-center gap-3 border-b py-2.5 last:border-0">
              <b className="text-sm">{u.nombre}</b>
              <Badge variant={u.rol === "admin" ? "default" : "secondary"}>{u.rol}</Badge>
              <span className="flex-1" />
              {u.rol !== "admin" && (
                <Switch checked={!!u.activo} title={u.activo ? "Activo" : "Desactivado"}
                  onCheckedChange={(v) => accion(() => api(`/usuarios/${u.id}/activo`, { method: "PATCH", body: { activo: v } }),
                    v ? `${u.nombre} activado` : `${u.nombre} desactivado`)} />
              )}
            </div>
          ))}
        </CardContent>
      </Card>
      <FormCamarero abierto={crear} onCerrar={() => setCrear(false)}
        onOk={(nombre, pin) => accion(() => api("/usuarios", { method: "POST", body: { nombre, rol: "camarero", ...(pin ? { pin } : {}) } }), "Camarero creado")} />
    </div>
  );
}

function FormCamarero({ abierto, onOk, onCerrar }: { abierto: boolean; onOk: (n: string, p: string) => void; onCerrar: () => void }) {
  const [nombre, setNombre] = useState("");
  const [pin, setPin] = useState("");
  useEffect(() => { if (abierto) { setNombre(""); setPin(""); } }, [abierto]);
  return (
    <Dialog open={abierto} onOpenChange={(o) => !o && onCerrar()} title="Nuevo camarero">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label>Nombre</Label>
          <Input autoFocus value={nombre} onChange={(e) => setNombre(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>PIN (opcional — sin PIN entra directo)</Label>
          <Input inputMode="numeric" className="font-mono" maxLength={6} value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} />
        </div>
        <Button disabled={!nombre || (pin.length > 0 && pin.length < 3)} onClick={() => onOk(nombre, pin)}>Crear</Button>
      </div>
    </Dialog>
  );
}

/* ═══════════════════════════════════════════════════ AJUSTES */
export function VistaAjustes() {
  const [libre, setLibre] = useState("#e8a33d");
  const [imprimirLlevar, setImprimirLlevar] = useState(true);
  const [modo, setModo] = useState<Modo>(getModo());
  const [fiscal, setFiscal] = useState({ razonSocial: "", nif: "", direccion: "", serie: "FAC" });
  const [toast, avisar] = useToast();

  useEffect(() => {
    void api<Record<string, string>>("/ajustes").then((a) => {
      setImprimirLlevar(a.imprimir_llevar !== "false");
      setFiscal({
        razonSocial: a.fiscal_razon_social ?? "",
        nif: a.fiscal_nif ?? "",
        direccion: a.fiscal_direccion ?? "",
        serie: a.fiscal_serie || "FAC",
      });
    });
  }, []);

  const guardarLlevar = async (valor: boolean) => {
    setImprimirLlevar(valor);
    try {
      await api("/ajustes", { method: "PUT", body: { clave: "imprimir_llevar", valor: String(valor) } });
      avisar(valor ? "Los pedidos para llevar se imprimirán" : "Los pedidos para llevar solo se registrarán");
    } catch (e) { avisar((e as Error).message, true); }
  };

  const guardarFiscal = async () => {
    try {
      for (const [clave, valor] of [
        ["fiscal_razon_social", fiscal.razonSocial],
        ["fiscal_nif", fiscal.nif.toUpperCase().trim()],
        ["fiscal_direccion", fiscal.direccion],
        ["fiscal_serie", fiscal.serie.toUpperCase().trim() || "FAC"],
      ]) {
        await api("/ajustes", { method: "PUT", body: { clave, valor } });
      }
      avisar("Datos fiscales guardados");
    } catch (e) { avisar((e as Error).message, true); }
  };

  const fiscalCompleto = fiscal.razonSocial && fiscal.nif && fiscal.direccion;

  return (
    <div className="flex flex-col gap-4">
      {toast}
      <h2 className="text-xl">Ajustes</h2>

      {/* Datos del EMISOR: sin esto no se pueden emitir facturas */}
      <Card className={!fiscalCompleto ? "border-warning/50" : undefined}>
        <CardHeader>
          <CardTitle>Datos fiscales del restaurante</CardTitle>
          <p className="text-sm text-muted-foreground">
            Aparecen como emisor en las facturas a empresas. Son obligatorios por ley
            (RD 1619/2012) para poder emitir una factura completa.
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-3.5">
          {!fiscalCompleto && (
            <p className="rounded-md bg-warning/15 px-3 py-2 text-sm text-warning">
              Faltan datos: hasta que los rellenes no se podrán emitir facturas a empresas
              (los tickets normales funcionan igual).
            </p>
          )}
          <div className="flex flex-col gap-1.5">
            <Label>Razón social o nombre y apellidos</Label>
            <Input placeholder="Bar Ejemplo S.L. / Juan García Pérez" value={fiscal.razonSocial}
              onChange={(e) => setFiscal({ ...fiscal, razonSocial: e.target.value })} />
          </div>
          <div className="flex gap-3">
            <div className="flex flex-1 flex-col gap-1.5">
              <Label>NIF / CIF</Label>
              <Input className="font-mono uppercase" placeholder="B12345678" value={fiscal.nif}
                onChange={(e) => setFiscal({ ...fiscal, nif: e.target.value })} />
            </div>
            <div className="flex w-32 flex-col gap-1.5">
              <Label>Serie</Label>
              <Input className="font-mono uppercase" placeholder="FAC" value={fiscal.serie}
                onChange={(e) => setFiscal({ ...fiscal, serie: e.target.value })} />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Domicilio fiscal</Label>
            <Input placeholder="Calle Mayor 1, 28001 Madrid" value={fiscal.direccion}
              onChange={(e) => setFiscal({ ...fiscal, direccion: e.target.value })} />
          </div>
          <p className="text-xs text-muted-foreground">
            La numeración es correlativa y sin saltos dentro de cada serie y año
            (p. ej. FAC-2026/00001). No cambies la serie a mitad de ejercicio sin motivo.
          </p>
          <Button variant="secondary" className="self-start" onClick={guardarFiscal}>
            Guardar datos fiscales
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pedidos para llevar</CardTitle>
          <p className="text-sm text-muted-foreground">
            Si lo desactivas, los pedidos para llevar se registran en la app y cuentan para caja
            y estadísticas, pero no salen por ninguna impresora.
          </p>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3">
            <Switch checked={imprimirLlevar} onCheckedChange={guardarLlevar} title="Imprimir pedidos para llevar" />
            <span className="text-sm">{imprimirLlevar ? "Se envían a las impresoras" : "Solo se registran (sin imprimir)"}</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Apariencia</CardTitle>
          <p className="text-sm text-muted-foreground">Modo claro para locales con mucha luz, oscuro para turnos de noche.</p>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex gap-2">
            <Button className="flex-1" variant={modo === "claro" ? "default" : "secondary"}
              onClick={() => { aplicarModo("claro"); setModo("claro"); }}>
              <Sun /> Claro
            </Button>
            <Button className="flex-1" variant={modo === "oscuro" ? "default" : "secondary"}
              onClick={() => { aplicarModo("oscuro"); setModo("oscuro"); }}>
              <Moon /> Oscuro
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Color de la app</CardTitle>
          <p className="text-sm text-muted-foreground">El acento se aplica a botones, gráficas y estados en este navegador.</p>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-2.5">
            {ACENTOS.map((a) => (
              <button key={a.nombre} title={a.nombre}
                className="min-w-[5.6rem] rounded-lg px-4 py-3 text-sm font-bold transition-transform hover:-translate-y-0.5"
                style={{ background: a.color, color: a.tinta }}
                onClick={() => { aplicarAcento(a.color, a.tinta); avisar(`Tema ${a.nombre} aplicado`); }}>
                {a.nombre}
              </button>
            ))}
          </div>
          <div className="flex items-end gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>O elige un color libre</Label>
              <input type="color" value={libre} onChange={(e) => setLibre(e.target.value)}
                className="h-10 w-20 cursor-pointer rounded-md border border-input bg-transparent p-1" />
            </div>
            <Button variant="secondary" onClick={() => { aplicarAcento(libre, tintaPara(libre)); avisar("Color aplicado"); }}>
              Aplicar
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
