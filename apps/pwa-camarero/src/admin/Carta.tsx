import { ChevronRight, FolderPlus, Pencil, Plus, Printer, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { Badge, Button, Card, CardContent, Dialog, Input, Label, Switch, Vacio } from "@/components/ui";
import { cn } from "@/lib/utils";
import { eur } from "../tema";
import { useToast } from "../toast";

interface Menu { id: string; nombre: string; activo: number }
interface Categoria { id: string; menu_id: string; categoria_padre_id: string | null; nombre: string; orden: number }
interface Producto { id: string; categoria_id: string; nombre: string; precio: number; disponible: number; tipo_iva: number }
interface Destino { id: string; nombre: string; tipo: string }

type ModalCarta =
  | { t: "menu" } | { t: "categoria"; padre: Categoria | null } | { t: "producto"; categoria: Categoria }
  | { t: "editar-producto"; producto: Producto } | { t: "destino-cat"; categoria: Categoria } | null;

export function VistaCarta() {
  const [menus, setMenus] = useState<Menu[]>([]);
  const [menuActivo, setMenuActivo] = useState<string | null>(null);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [destinos, setDestinos] = useState<Destino[]>([]);
  const [sinDestino, setSinDestino] = useState<{ id: string }[]>([]);
  // Mapa de enrutado: qué impresora tiene cada categoría y cada producto,
  // distinguiendo lo asignado a mano de lo heredado del árbol.
  const [mapa, setMapa] = useState<{
    categorias: Record<string, string | null>;
    productos: Record<string, { propio: string | null; resuelto: string | null; heredado: boolean }>;
  }>({ categorias: {}, productos: {} });
  const [modal, setModal] = useState<ModalCarta>(null);
  const [toast, avisar] = useToast();

  const cargar = useCallback(async () => {
    const c = await api<{ menus: Menu[]; categorias: Categoria[]; productos: Producto[] }>("/carta/completa");
    setMenus(c.menus); setCategorias(c.categorias); setProductos(c.productos);
    setMenuActivo((m) => m ?? c.menus[0]?.id ?? null);
    setDestinos((await api<Destino[]>("/destinos")).filter((d) => d.tipo !== "impresora_ticket"));
    setSinDestino(await api<{ id: string }[]>("/destinos/sin-destino"));
    setMapa(await api("/destinos/mapa"));
  }, []);
  useEffect(() => { void cargar(); }, [cargar]);

  const accion = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); avisar(ok); setModal(null); await cargar(); }
    catch (e) { avisar((e as Error).message, true); }
  };

  const raices = categorias.filter((c) => c.menu_id === menuActivo && !c.categoria_padre_id);

  const NodoCategoria = ({ cat, nivel }: { cat: Categoria; nivel: number }) => {
    const hijas = categorias.filter((c) => c.categoria_padre_id === cat.id);
    const prods = productos.filter((p) => p.categoria_id === cat.id);
    return (
      <div className="mt-1.5 border-l-[1.5px] pl-3" style={{ marginLeft: nivel * 16 }}>
        <div className="flex items-center gap-1 py-0.5">
          {nivel > 0 && <ChevronRight className="size-3.5 text-muted-foreground/50" />}
          <b className="flex-1 text-sm">{cat.nombre}</b>
          <Button variant="ghost" size="icon-sm" title="Impresora de la categoría" onClick={() => setModal({ t: "destino-cat", categoria: cat })}><Printer /></Button>
          <Button variant="ghost" size="icon-sm" title="Nueva subcategoría" onClick={() => setModal({ t: "categoria", padre: cat })}><FolderPlus /></Button>
          <Button variant="ghost" size="icon-sm" title="Nuevo producto" onClick={() => setModal({ t: "producto", categoria: cat })}><Plus /></Button>
          <Button variant="ghost" size="icon-sm" title="Eliminar categoría"
            onClick={() => confirm(`¿Eliminar "${cat.nombre}"?`) && accion(() => api(`/carta/categorias/${cat.id}`, { method: "DELETE" }), "Categoría eliminada")}>
            <Trash2 />
          </Button>
        </div>
        {prods.map((p) => (
          <div key={p.id} className="ml-4 flex items-center gap-2 py-0.5 text-sm text-muted-foreground">
            <span className={cn("flex-1", !p.disponible && "line-through opacity-60")}>
              <span className="text-foreground">{p.nombre}</span>
              {sinDestino.some((s) => s.id === p.id) ? (
                <Badge variant="warning" className="ml-2">sin impresora</Badge>
              ) : mapa.productos[p.id]?.resuelto && (
                <span
                  className="ml-2 text-xs text-muted-foreground"
                  title={mapa.productos[p.id].heredado
                    ? "Heredado de su categoría"
                    : "Asignado directamente a este producto"}>
                  → {mapa.productos[p.id].resuelto}
                  {mapa.productos[p.id].heredado && <span className="opacity-60"> (heredado)</span>}
                </span>
              )}
            </span>
            <span className="font-mono text-xs">{eur(p.precio)} <span className="opacity-60">·{p.tipo_iva}%</span></span>
            <Switch checked={!!p.disponible} title={p.disponible ? "Disponible" : "Agotado"}
              onCheckedChange={(v) => accion(() => api(`/carta/productos/${p.id}/disponibilidad`, { method: "PATCH", body: { disponible: v } }), v ? "Disponible de nuevo" : "Marcado como agotado")} />
            <Button variant="ghost" size="icon-sm" onClick={() => setModal({ t: "editar-producto", producto: p })}><Pencil /></Button>
            <Button variant="ghost" size="icon-sm"
              onClick={() => confirm(`¿Eliminar "${p.nombre}"?`) && accion(() => api(`/carta/productos/${p.id}`, { method: "DELETE" }), "Producto eliminado")}>
              <Trash2 />
            </Button>
          </div>
        ))}
        {hijas.map((h) => <NodoCategoria key={h.id} cat={h} nivel={nivel + 1} />)}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      {toast}
      <div className="flex items-center gap-3">
        <h2 className="flex-1 text-xl">Carta</h2>
        <Button variant="secondary" onClick={() => setModal({ t: "menu" })}><Plus /> Nuevo menú</Button>
      </div>

      {menus.length === 0 ? (
        <Vacio titulo="La carta está vacía" texto="Crea el primer menú («Carta», «Menú del día»…) y dentro sus categorías y productos."
          accion={<Button onClick={() => setModal({ t: "menu" })}><Plus /> Crear menú</Button>} />
      ) : (
        <>
          <nav className="sin-scrollbar flex gap-2 overflow-x-auto">
            {menus.map((m) => (
              <button key={m.id} onClick={() => setMenuActivo(m.id)}
                className={cn(
                  "whitespace-nowrap rounded-full border px-4 py-1.5 text-sm font-medium",
                  m.id === menuActivo ? "border-transparent bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:text-foreground"
                )}>
                {m.nombre}
              </button>
            ))}
          </nav>
          <Card>
            <CardContent className="p-5">
              <div className="mb-2 flex items-center">
                <span className="flex-1 text-sm text-muted-foreground">Categorías y productos</span>
                <Button variant="secondary" size="sm" onClick={() => setModal({ t: "categoria", padre: null })}><FolderPlus /> Nueva categoría</Button>
              </div>
              {raices.length === 0 && <p className="text-sm text-muted-foreground">Este menú aún no tiene categorías.</p>}
              {raices.map((c) => <NodoCategoria key={c.id} cat={c} nivel={0} />)}
            </CardContent>
          </Card>
        </>
      )}

      <FormSimple abierto={modal?.t === "menu"} titulo="Nuevo menú" placeholder="Carta, Menú del día…"
        onCerrar={() => setModal(null)}
        onOk={(nombre) => accion(() => api("/carta/menus", { method: "POST", body: { nombre } }), "Menú creado")} />

      <FormSimple abierto={modal?.t === "categoria"}
        titulo={modal?.t === "categoria" && modal.padre ? `Subcategoría de ${modal.padre.nombre}` : "Nueva categoría"}
        placeholder="Bebidas, Entrantes…" onCerrar={() => setModal(null)}
        onOk={(nombre) => modal?.t === "categoria" && accion(() => api("/carta/categorias", {
          method: "POST", body: { menuId: menuActivo, categoriaPadreId: modal.padre?.id ?? null, nombre },
        }), "Categoría creada")} />

      <FormProducto abierto={modal?.t === "producto" || modal?.t === "editar-producto"}
        titulo={modal?.t === "producto" ? `Nuevo producto en ${modal.categoria.nombre}`
          : modal?.t === "editar-producto" ? `Editar ${modal.producto.nombre}` : ""}
        inicial={modal?.t === "editar-producto" ? modal.producto : undefined}
        onCerrar={() => setModal(null)}
        onOk={(nombre, precio, tipoIva) => {
          if (modal?.t === "producto")
            void accion(() => api("/carta/productos", { method: "POST", body: { categoriaId: modal.categoria.id, nombre, precio, tipoIva } }), "Producto creado");
          if (modal?.t === "editar-producto")
            void accion(() => api(`/carta/productos/${modal.producto.id}`, { method: "PUT", body: { nombre, precio, tipoIva } }), "Producto actualizado");
        }} />

      <Dialog open={modal?.t === "destino-cat"} onOpenChange={(o) => !o && setModal(null)}
        title={modal?.t === "destino-cat" ? `Impresora para ${modal.categoria.nombre}` : ""}>
        <p className="mb-3 text-sm text-muted-foreground">
          Todo lo de esta categoría (y sus subcategorías sin destino propio) se enviará aquí.
        </p>
        <div className="flex flex-col gap-2">
          {destinos.length === 0 && <p className="text-sm text-muted-foreground">Primero crea una impresora o pantalla en la pestaña Impresoras.</p>}
          {destinos.map((d) => (
            <Button key={d.id} variant="secondary" className="justify-start"
              onClick={() => modal?.t === "destino-cat" && accion(() =>
                api(`/destinos/categorias/${modal.categoria.id}/asignar`, { method: "POST", body: { puntoDestinoId: d.id } }),
                `${modal.categoria.nombre} → ${d.nombre}`)}>
              <Printer /> {d.nombre}
            </Button>
          ))}
        </div>
      </Dialog>
    </div>
  );
}

function FormSimple({ abierto, titulo, placeholder, onOk, onCerrar }: {
  abierto: boolean; titulo: string; placeholder: string; onOk: (nombre: string) => void; onCerrar: () => void;
}) {
  const [nombre, setNombre] = useState("");
  useEffect(() => { if (abierto) setNombre(""); }, [abierto]);
  return (
    <Dialog open={abierto} onOpenChange={(o) => !o && onCerrar()} title={titulo}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label>Nombre</Label>
          <Input autoFocus placeholder={placeholder} value={nombre} onChange={(e) => setNombre(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && nombre && onOk(nombre)} />
        </div>
        <Button disabled={!nombre} onClick={() => onOk(nombre)}>Crear</Button>
      </div>
    </Dialog>
  );
}

function FormProducto({ abierto, titulo, inicial, onOk, onCerrar }: {
  abierto: boolean; titulo: string; inicial?: { nombre: string; precio: number; tipo_iva?: number };
  onOk: (nombre: string, precio: number, tipoIva: number) => void; onCerrar: () => void;
}) {
  const [nombre, setNombre] = useState("");
  const [precio, setPrecio] = useState("");
  const [iva, setIva] = useState(10);
  useEffect(() => {
    if (abierto) {
      setNombre(inicial?.nombre ?? "");
      setPrecio(inicial ? String(inicial.precio) : "");
      setIva(inicial?.tipo_iva ?? 10);
    }
  }, [abierto, inicial]);
  const valido = nombre && !isNaN(parseFloat(precio));
  return (
    <Dialog open={abierto} onOpenChange={(o) => !o && onCerrar()} title={titulo}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label>Nombre</Label>
          <Input autoFocus value={nombre} onChange={(e) => setNombre(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Precio (€)</Label>
          <Input inputMode="decimal" className="font-mono" placeholder="0,00" value={precio}
            onChange={(e) => setPrecio(e.target.value.replace(",", "."))} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>IVA aplicable</Label>
          <div className="flex gap-2">
            {[10, 21].map((t) => (
              <Button key={t} className="flex-1" variant={iva === t ? "default" : "secondary"} onClick={() => setIva(t)}>
                {t}%
              </Button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            10% comida y refrescos · 21% bebidas alcohólicas. Solo afecta al desglose de las
            facturas a empresa; el precio de carta es siempre con IVA incluido.
          </p>
        </div>
        <Button disabled={!valido} onClick={() => onOk(nombre, parseFloat(precio), iva)}>Guardar</Button>
      </div>
    </Dialog>
  );
}
