import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { Badge, Button, Card, CardContent, Input, Label, Select, Vacio } from "@/components/ui";
import { useToast } from "../toast";

interface Item { id: string; nombre: string; unidad: string; stock_actual: number; stock_minimo: number }
interface Movimiento { id: string; tipo: "entrada" | "salida"; cantidad: number; motivo: string; usuario: string; creado_en: string }

export function VistaInventario() {
  const [items, setItems] = useState<Item[]>([]);
  const [nombre, setNombre] = useState("");
  const [unidad, setUnidad] = useState("ud");
  const [stock, setStock] = useState("");
  const [minimo, setMinimo] = useState("");
  const [seleccion, setSeleccion] = useState<string | null>(null);
  const [tipo, setTipo] = useState<"entrada" | "salida">("entrada");
  const [cantidad, setCantidad] = useState("");
  const [motivo, setMotivo] = useState("");
  const [movimientos, setMovimientos] = useState<Movimiento[]>([]);
  const [toast, avisar] = useToast();

  const cargar = useCallback(async () => setItems(await api<Item[]>("/inventario")), []);
  useEffect(() => { void cargar(); }, [cargar]);
  useEffect(() => {
    setMovimientos([]);
    if (seleccion) void api<Movimiento[]>(`/inventario/${seleccion}/movimientos`).then(setMovimientos).catch(() => {});
  }, [seleccion]);

  const crear = async () => {
    if (!nombre.trim() || !unidad.trim()) return;
    try {
      await api("/inventario", { method: "POST", body: { nombre: nombre.trim(), unidad: unidad.trim(), stockActual: Number(stock) || 0, stockMinimo: Number(minimo) || 0 } });
      setNombre(""); setUnidad("ud"); setStock(""); setMinimo(""); avisar("Artículo añadido"); await cargar();
    } catch (e) { avisar((e as Error).message, true); }
  };

  const registrar = async () => {
    if (!seleccion || !cantidad || !motivo.trim()) return;
    try {
      await api(`/inventario/${seleccion}/movimientos`, { method: "POST", body: { tipo, cantidad: Number(cantidad), motivo: motivo.trim() } });
      setCantidad(""); setMotivo(""); avisar("Movimiento registrado"); await cargar();
      setMovimientos(await api<Movimiento[]>(`/inventario/${seleccion}/movimientos`));
    } catch (e) { avisar((e as Error).message, true); }
  };

  return <div className="flex flex-col gap-4">
    {toast}
    <div><h2 className="text-xl">Inventario</h2><p className="mt-1 text-sm text-muted-foreground">Control manual de existencias y movimientos. Las ventas no descuentan stock automáticamente: registra consumo, mermas y recepciones.</p></div>
    <Card><CardContent className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5">
      <div className="flex flex-col gap-1"><Label htmlFor="inv-nombre">Artículo</Label><Input id="inv-nombre" placeholder="Café en grano" value={nombre} onChange={(e) => setNombre(e.target.value)} /></div>
      <div className="flex flex-col gap-1"><Label htmlFor="inv-unidad">Unidad</Label><Input id="inv-unidad" placeholder="kg, l, ud…" value={unidad} onChange={(e) => setUnidad(e.target.value)} /></div>
      <div className="flex flex-col gap-1"><Label htmlFor="inv-stock">Existencias iniciales</Label><Input id="inv-stock" inputMode="decimal" value={stock} onChange={(e) => setStock(e.target.value.replace(",", "."))} /></div>
      <div className="flex flex-col gap-1"><Label htmlFor="inv-minimo">Avisar por debajo de</Label><Input id="inv-minimo" inputMode="decimal" value={minimo} onChange={(e) => setMinimo(e.target.value.replace(",", "."))} /></div>
      <Button className="self-end" disabled={!nombre.trim() || !unidad.trim()} onClick={() => void crear()}>Añadir artículo</Button>
    </CardContent></Card>
    {items.length === 0 ? <Vacio titulo="Sin artículos de inventario" texto="Añade materias primas, bebidas o consumibles para controlar su stock." /> : <Card><CardContent className="divide-y p-0">
      {items.map((item) => <div key={item.id} className="p-4">
        <button className="flex w-full items-center gap-3 text-left" onClick={() => setSeleccion((actual) => actual === item.id ? null : item.id)}>
          <span className="flex-1 font-medium">{item.nombre}</span><span className="font-mono">{item.stock_actual} {item.unidad}</span>
          {item.stock_actual <= item.stock_minimo && <Badge variant="warning">Stock bajo</Badge>}
          <span className="text-xs text-muted-foreground">Mín. {item.stock_minimo} {item.unidad}</span>
        </button>
        {seleccion === item.id && <div className="mt-4 flex flex-col gap-3 border-t pt-4">
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-1"><Label>Movimiento</Label><Select value={tipo} onChange={(e) => setTipo(e.target.value as "entrada" | "salida")}><option value="entrada">Entrada</option><option value="salida">Salida / merma</option></Select></div>
            <div className="flex flex-col gap-1"><Label>Cantidad ({item.unidad})</Label><Input className="w-32" inputMode="decimal" value={cantidad} onChange={(e) => setCantidad(e.target.value.replace(",", "."))} /></div>
            <div className="flex min-w-44 flex-1 flex-col gap-1"><Label>Motivo</Label><Input placeholder="Compra, consumo, merma…" value={motivo} onChange={(e) => setMotivo(e.target.value)} /></div>
            <Button variant="secondary" disabled={!cantidad || !motivo.trim()} onClick={() => void registrar()}>Guardar movimiento</Button>
          </div>
          <div className="text-sm"><b>Últimos movimientos</b>{movimientos.length ? <ul className="mt-2 flex flex-col gap-1 text-xs text-muted-foreground">{movimientos.map((m) => <li key={m.id} className="flex gap-2"><span className="flex-1">{new Date(m.creado_en).toLocaleString()} · {m.motivo} · {m.usuario}</span><span>{m.tipo === "entrada" ? "+" : "−"}{m.cantidad} {item.unidad}</span></li>)}</ul> : <p className="mt-1 text-xs text-muted-foreground">Sin movimientos.</p>}</div>
        </div>}
      </div>)}
    </CardContent></Card>}
  </div>;
}
