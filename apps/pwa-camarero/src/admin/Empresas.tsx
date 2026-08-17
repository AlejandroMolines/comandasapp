import { Building2, FileText, Pencil, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Dialog, Input, Label, Vacio } from "@/components/ui";
import { eur, fecha } from "../tema";
import { useToast } from "../toast";

export interface Empresa {
  id: string;
  razon_social: string;
  nif: string;
  direccion: string;
  codigo_postal: string | null;
  ciudad: string | null;
  provincia: string | null;
  pais: string;
  email: string | null;
  telefono: string | null;
  persona_contacto: string | null;
  notas: string | null;
}

interface FacturaResumen {
  id: string; serie: string; numero: number; ejercicio: number;
  fecha_expedicion: string; base_imponible: number; cuota_iva: number;
  total: number; metodo_pago: string | null;
}

export function VistaEmpresas() {
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [busqueda, setBusqueda] = useState("");
  const [form, setForm] = useState<{ modo: "nueva" } | { modo: "editar"; empresa: Empresa } | null>(null);
  const [verFacturas, setVerFacturas] = useState<Empresa | null>(null);
  const [toast, avisar] = useToast();

  const cargar = useCallback(async () => setEmpresas(await api<Empresa[]>("/empresas")), []);
  useEffect(() => { void cargar(); }, [cargar]);

  const accion = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); avisar(ok); setForm(null); await cargar(); }
    catch (e) { avisar((e as Error).message, true); }
  };

  const filtradas = empresas.filter((e) => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return true;
    return e.razon_social.toLowerCase().includes(q) || e.nif.toLowerCase().includes(q);
  });

  return (
    <div className="flex flex-col gap-4">
      {toast}
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="flex-1 text-xl">Empresas para facturar</h2>
        <Button variant="secondary" onClick={() => setForm({ modo: "nueva" })}><Plus /> Nueva empresa</Button>
      </div>

      <p className="text-sm text-muted-foreground">
        Clientes que necesitan <b>factura completa</b> a nombre de su empresa (típico de comidas
        de trabajo pagadas con tarjeta de empresa). Al cobrar podrás elegir la empresa y saldrá
        la factura con sus datos fiscales y el desglose de IVA en lugar del ticket normal.
      </p>

      {empresas.length > 3 && (
        <Input placeholder="Buscar por nombre o NIF…" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
      )}

      {empresas.length === 0 ? (
        <Vacio
          titulo="Ninguna empresa dada de alta"
          texto="Añade los datos fiscales de los clientes que te piden factura y los tendrás listos para cobrar en un toque."
          accion={<Button onClick={() => setForm({ modo: "nueva" })}><Plus /> Añadir la primera</Button>}
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {filtradas.map((e) => (
            <Card key={e.id}>
              <CardContent className="flex flex-col gap-1.5 p-5">
                <div className="flex items-start gap-2">
                  <Building2 className="mt-0.5 size-4 shrink-0 text-primary" />
                  <b className="flex-1 leading-tight">{e.razon_social}</b>
                </div>
                <Badge className="self-start font-mono">{e.nif}</Badge>
                <p className="text-sm text-muted-foreground">
                  {e.direccion}
                  {e.codigo_postal && `, ${e.codigo_postal}`}
                  {e.ciudad && ` ${e.ciudad}`}
                  {e.provincia && ` (${e.provincia})`}
                </p>
                {(e.persona_contacto || e.email) && (
                  <p className="text-xs text-muted-foreground">
                    {e.persona_contacto}{e.persona_contacto && e.email && " · "}{e.email}
                  </p>
                )}
                <div className="mt-1 flex gap-1">
                  <Button variant="ghost" size="sm" onClick={() => setVerFacturas(e)}>
                    <FileText /> Facturas
                  </Button>
                  <span className="flex-1" />
                  <Button variant="ghost" size="icon-sm" onClick={() => setForm({ modo: "editar", empresa: e })}>
                    <Pencil />
                  </Button>
                  <Button variant="ghost" size="icon-sm"
                    onClick={() => confirm(`¿Dar de baja a "${e.razon_social}"?\n\nLas facturas ya emitidas se conservan.`) &&
                      accion(() => api(`/empresas/${e.id}`, { method: "DELETE" }), "Empresa dada de baja")}>
                    <Trash2 />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {form && (
        <FormEmpresa
          inicial={form.modo === "editar" ? form.empresa : undefined}
          onCerrar={() => setForm(null)}
          onOk={(datos) =>
            form.modo === "nueva"
              ? accion(() => api("/empresas", { method: "POST", body: datos }), "Empresa creada")
              : accion(() => api(`/empresas/${form.empresa.id}`, { method: "PUT", body: datos }), "Empresa actualizada")
          }
        />
      )}

      {verFacturas && <DialogoFacturas empresa={verFacturas} onCerrar={() => setVerFacturas(null)} />}
    </div>
  );
}

function FormEmpresa({ inicial, onOk, onCerrar }: {
  inicial?: Empresa;
  onOk: (datos: Record<string, string>) => void;
  onCerrar: () => void;
}) {
  const [d, setD] = useState({
    razonSocial: inicial?.razon_social ?? "",
    nif: inicial?.nif ?? "",
    direccion: inicial?.direccion ?? "",
    codigoPostal: inicial?.codigo_postal ?? "",
    ciudad: inicial?.ciudad ?? "",
    provincia: inicial?.provincia ?? "",
    pais: inicial?.pais ?? "España",
    email: inicial?.email ?? "",
    telefono: inicial?.telefono ?? "",
    personaContacto: inicial?.persona_contacto ?? "",
    notas: inicial?.notas ?? "",
  });
  const set = (k: keyof typeof d) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setD({ ...d, [k]: e.target.value });

  // Estos tres son los que exige la ley para que la factura sea válida.
  const valido = d.razonSocial.trim() && d.nif.trim().length >= 8 && d.direccion.trim();

  return (
    <Dialog open onOpenChange={(o) => !o && onCerrar()} title={inicial ? "Editar empresa" : "Nueva empresa"}>
      <div className="flex flex-col gap-3.5">
        <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
          Los campos marcados con * son <b>obligatorios por ley</b> en una factura: sin ellos
          el cliente no puede deducir el IVA.
        </p>

        <div className="flex flex-col gap-1.5">
          <Label>Razón social *</Label>
          <Input autoFocus placeholder="Construcciones Ejemplo S.L." value={d.razonSocial} onChange={set("razonSocial")} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>NIF / CIF *</Label>
          <Input placeholder="B12345678" className="font-mono uppercase" value={d.nif} onChange={set("nif")} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Domicilio fiscal *</Label>
          <Input placeholder="Calle Mayor 12, 3º B" value={d.direccion} onChange={set("direccion")} />
        </div>
        <div className="flex gap-3">
          <div className="flex w-28 flex-col gap-1.5">
            <Label>C. Postal</Label>
            <Input className="font-mono" placeholder="28001" value={d.codigoPostal} onChange={set("codigoPostal")} />
          </div>
          <div className="flex flex-1 flex-col gap-1.5">
            <Label>Ciudad</Label>
            <Input placeholder="Madrid" value={d.ciudad} onChange={set("ciudad")} />
          </div>
        </div>
        <div className="flex gap-3">
          <div className="flex flex-1 flex-col gap-1.5">
            <Label>Provincia</Label>
            <Input placeholder="Madrid" value={d.provincia} onChange={set("provincia")} />
          </div>
          <div className="flex flex-1 flex-col gap-1.5">
            <Label>País</Label>
            <Input value={d.pais} onChange={set("pais")} />
          </div>
        </div>

        <hr className="my-1 border-border" />
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Contacto (opcional)</p>
        <div className="flex flex-col gap-1.5">
          <Label>Persona de contacto</Label>
          <Input placeholder="Ana Pérez" value={d.personaContacto} onChange={set("personaContacto")} />
        </div>
        <div className="flex gap-3">
          <div className="flex flex-1 flex-col gap-1.5">
            <Label>Email</Label>
            <Input type="email" placeholder="facturas@empresa.com" value={d.email} onChange={set("email")} />
          </div>
          <div className="flex w-36 flex-col gap-1.5">
            <Label>Teléfono</Label>
            <Input className="font-mono" placeholder="600123456" value={d.telefono} onChange={set("telefono")} />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Notas internas</Label>
          <Input placeholder="Cliente habitual, comen los jueves…" value={d.notas} onChange={set("notas")} />
        </div>

        <Button disabled={!valido} onClick={() => onOk(d)}>
          {inicial ? "Guardar cambios" : "Crear empresa"}
        </Button>
      </div>
    </Dialog>
  );
}

function DialogoFacturas({ empresa, onCerrar }: { empresa: Empresa; onCerrar: () => void }) {
  const [facturas, setFacturas] = useState<FacturaResumen[] | null>(null);
  useEffect(() => {
    void api<FacturaResumen[]>(`/empresas/${empresa.id}/facturas`).then(setFacturas);
  }, [empresa.id]);

  const total = facturas?.reduce((a, f) => a + f.total, 0) ?? 0;

  return (
    <Dialog open onOpenChange={(o) => !o && onCerrar()} title={`Facturas · ${empresa.razon_social}`}>
      {!facturas ? (
        <p className="text-sm text-muted-foreground">Cargando…</p>
      ) : facturas.length === 0 ? (
        <p className="text-sm text-muted-foreground">Todavía no se ha emitido ninguna factura a esta empresa.</p>
      ) : (
        <div className="flex flex-col">
          {facturas.map((f) => (
            <div key={f.id} className="flex items-center gap-3 border-b py-2.5 text-sm last:border-0">
              <span className="font-mono text-xs">
                {f.serie}-{f.ejercicio}/{String(f.numero).padStart(5, "0")}
              </span>
              <span className="flex-1 text-muted-foreground">{fecha(f.fecha_expedicion)}</span>
              <span className="font-mono">{eur(f.total)}</span>
            </div>
          ))}
          <div className="mt-2 flex justify-between font-bold">
            <span>{facturas.length} facturas</span>
            <span className="font-mono">{eur(total)}</span>
          </div>
        </div>
      )}
    </Dialog>
  );
}
