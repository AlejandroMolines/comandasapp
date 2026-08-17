import { Pencil, Plus, Tag, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { Badge, Button, Card, CardContent, Dialog, Input, Label, Vacio } from "@/components/ui";
import { cn } from "@/lib/utils";
import { eur } from "../tema";
import { useToast } from "../toast";

export interface Extra {
  id: string;
  nombre: string;
  precio: number;
  ambito: "general" | "especifico";
  grupo: string | null;
  orden: number;
  productos: string[];
  categorias: string[];
}

interface Categoria { id: string; nombre: string; categoria_padre_id: string | null; menu_id: string }
interface Producto { id: string; nombre: string; categoria_id: string }

export function VistaExtras() {
  const [extras, setExtras] = useState<Extra[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [form, setForm] = useState<{ modo: "nuevo" } | { modo: "editar"; extra: Extra } | null>(null);
  const [toast, avisar] = useToast();

  const cargar = useCallback(async () => {
    setExtras(await api<Extra[]>("/extras"));
    const carta = await api<{ categorias: Categoria[]; productos: Producto[] }>("/carta/completa");
    setCategorias(carta.categorias);
    setProductos(carta.productos);
  }, []);
  useEffect(() => { void cargar(); }, [cargar]);

  const accion = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); avisar(ok); setForm(null); await cargar(); }
    catch (e) { avisar((e as Error).message, true); }
  };

  const nombreDe = (id: string) =>
    categorias.find((c) => c.id === id)?.nombre ?? productos.find((p) => p.id === id)?.nombre ?? "—";

  const generales = extras.filter((e) => e.ambito === "general");
  const especificos = extras.filter((e) => e.ambito === "especifico");

  const Tarjeta = ({ e }: { e: Extra }) => (
    <div className={cn(
      "flex items-start gap-2 rounded-lg border bg-card p-3",
      e.precio > 0 && "border-primary/40"
    )}>
      <Tag className={cn("mt-0.5 size-4 shrink-0", e.precio > 0 ? "text-primary" : "text-muted-foreground")} />
      <div className="flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <b className="text-sm">{e.nombre}</b>
          {e.precio > 0
            ? <Badge variant="default" className="font-mono">+{eur(e.precio)}</Badge>
            : <Badge variant="secondary">sin coste</Badge>}
          {e.grupo && <Badge variant="outline">{e.grupo}</Badge>}
        </div>
        {e.ambito === "especifico" && (
          <p className="mt-1 text-xs text-muted-foreground">
            Aplica a: {[...e.categorias, ...e.productos].map(nombreDe).join(", ") || "nada (revísalo)"}
          </p>
        )}
      </div>
      <Button variant="ghost" size="icon-sm" onClick={() => setForm({ modo: "editar", extra: e })}><Pencil /></Button>
      <Button variant="ghost" size="icon-sm"
        onClick={() => confirm(`¿Dar de baja "${e.nombre}"?\n\nLas comandas ya servidas lo conservan.`) &&
          accion(() => api(`/extras/${e.id}`, { method: "DELETE" }), "Extra dado de baja")}>
        <Trash2 />
      </Button>
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      {toast}
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="flex-1 text-xl">Extras y modificaciones</h2>
        <Button variant="secondary" onClick={() => setForm({ modo: "nuevo" })}><Plus /> Nuevo extra</Button>
      </div>

      <p className="text-sm text-muted-foreground">
        Lo que el camarero puede añadir a un producto al pedirlo. Hay dos tipos:
        <b> modificaciones sin coste</b> («sin cebolla», «muy hecho») y <b>extras con
        precio</b> («extra de queso +1,50»), que se suman a la cuenta. Y dos ámbitos:
        <b> generales</b> (valen para cualquier producto) o <b>específicos</b> (solo para
        los productos o categorías que elijas).
      </p>

      {extras.length === 0 ? (
        <Vacio
          titulo="Sin extras configurados"
          texto="Crea las modificaciones y extras que tu cocina admite: se los ofrecerá al camarero al tocar un producto."
          accion={<Button onClick={() => setForm({ modo: "nuevo" })}><Plus /> Crear el primero</Button>}
        />
      ) : (
        <>
          {generales.length > 0 && (
            <Card>
              <CardContent className="flex flex-col gap-2 p-5">
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Generales · válidos para cualquier producto
                </p>
                {generales.map((e) => <Tarjeta key={e.id} e={e} />)}
              </CardContent>
            </Card>
          )}
          {especificos.length > 0 && (
            <Card>
              <CardContent className="flex flex-col gap-2 p-5">
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Específicos · solo donde los asignes
                </p>
                {especificos.map((e) => <Tarjeta key={e.id} e={e} />)}
              </CardContent>
            </Card>
          )}
        </>
      )}

      {form && (
        <FormExtra
          inicial={form.modo === "editar" ? form.extra : undefined}
          categorias={categorias}
          productos={productos}
          onCerrar={() => setForm(null)}
          onOk={(datos) =>
            form.modo === "nuevo"
              ? accion(() => api("/extras", { method: "POST", body: datos }), "Extra creado")
              : accion(() => api(`/extras/${form.extra.id}`, { method: "PUT", body: datos }), "Extra actualizado")
          }
        />
      )}
    </div>
  );
}

function FormExtra({ inicial, categorias, productos, onOk, onCerrar }: {
  inicial?: Extra;
  categorias: Categoria[];
  productos: Producto[];
  onOk: (datos: Record<string, unknown>) => void;
  onCerrar: () => void;
}) {
  const [nombre, setNombre] = useState(inicial?.nombre ?? "");
  const [precio, setPrecio] = useState(inicial ? String(inicial.precio) : "0");
  const [ambito, setAmbito] = useState<"general" | "especifico">(inicial?.ambito ?? "especifico");
  const [grupo, setGrupo] = useState(inicial?.grupo ?? "");
  const [cats, setCats] = useState<string[]>(inicial?.categorias ?? []);
  const [prods, setProds] = useState<string[]>(inicial?.productos ?? []);

  const alternar = (lista: string[], set: (v: string[]) => void, id: string) =>
    set(lista.includes(id) ? lista.filter((x) => x !== id) : [...lista, id]);

  const precioNum = parseFloat(precio.replace(",", ".")) || 0;
  const valido = nombre.trim() && (ambito === "general" || cats.length > 0 || prods.length > 0);

  return (
    <Dialog open onOpenChange={(o) => !o && onCerrar()} title={inicial ? "Editar extra" : "Nuevo extra"}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label>Nombre</Label>
          <Input autoFocus placeholder="Extra de queso / Sin cebolla" value={nombre}
            onChange={(e) => setNombre(e.target.value)} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>Precio (€)</Label>
          <Input inputMode="decimal" className="font-mono" placeholder="0,00" value={precio}
            onChange={(e) => setPrecio(e.target.value)} />
          <p className="text-xs text-muted-foreground">
            Déjalo en <b>0</b> si es una modificación que no cambia el precio. Si pones un
            importe, se sumará al producto cada vez que se aplique.
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>¿Dónde se puede usar?</Label>
          <div className="flex gap-2">
            <Button className="flex-1" variant={ambito === "general" ? "default" : "secondary"}
              onClick={() => setAmbito("general")}>
              En todo
            </Button>
            <Button className="flex-1" variant={ambito === "especifico" ? "default" : "secondary"}
              onClick={() => setAmbito("especifico")}>
              Solo en…
            </Button>
          </div>
        </div>

        {ambito === "especifico" && (
          <>
            <div className="flex flex-col gap-1.5">
              <Label>Categorías</Label>
              <p className="text-xs text-muted-foreground">
                Al elegir una categoría, el extra se ofrece también en sus subcategorías.
              </p>
              <div className="flex max-h-32 flex-wrap gap-1.5 overflow-y-auto">
                {categorias.map((c) => (
                  <button key={c.id} onClick={() => alternar(cats, setCats, c.id)}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-xs font-medium",
                      cats.includes(c.id)
                        ? "border-transparent bg-primary text-primary-foreground"
                        : "bg-card text-muted-foreground hover:text-foreground"
                    )}>
                    {c.nombre}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>Productos concretos (opcional)</Label>
              <div className="flex max-h-32 flex-wrap gap-1.5 overflow-y-auto">
                {productos.map((p) => (
                  <button key={p.id} onClick={() => alternar(prods, setProds, p.id)}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-xs font-medium",
                      prods.includes(p.id)
                        ? "border-transparent bg-primary text-primary-foreground"
                        : "bg-card text-muted-foreground hover:text-foreground"
                    )}>
                    {p.nombre}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        <div className="flex flex-col gap-1.5">
          <Label>Grupo (opcional)</Label>
          <Input placeholder="Punto de la carne, Salsas…" value={grupo}
            onChange={(e) => setGrupo(e.target.value)} />
        </div>

        <Button disabled={!valido}
          onClick={() => onOk({
            nombre: nombre.trim(),
            precio: precioNum,
            ambito,
            grupo: grupo.trim() || null,
            orden: inicial?.orden ?? 0,
            categorias: ambito === "especifico" ? cats : [],
            productos: ambito === "especifico" ? prods : [],
          })}>
          {inicial ? "Guardar cambios" : "Crear extra"}
        </Button>
      </div>
    </Dialog>
  );
}
