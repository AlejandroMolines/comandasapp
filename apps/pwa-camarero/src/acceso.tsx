import { ChevronLeft, Delete, Lock, LogOut } from "lucide-react";
import { useEffect, useState } from "react";
import {
  api, cerrarSesionRestaurante, getRestauranteNombre, getTokenRestaurante,
  setSesion, setSesionRestaurante,
} from "./api";
import { uuid } from "./uuid";
import { BotonModo } from "./BotonModo";
import { VERSION } from "./version";
import { Button, Input, Label } from "@/components/ui";
import { cn } from "@/lib/utils";
import { useToast } from "./toast";

function deviceId(): string {
  let id = localStorage.getItem("dispositivoId");
  if (!id) { id = uuid(); localStorage.setItem("dispositivoId", id); }
  return id;
}

interface Perfil { id: string; nombre: string; rol: "admin" | "camarero"; tienePin: boolean }

/**
 * Acceso en tres pasos:
 *  1. Login del RESTAURANTE (email + contraseña) — una vez por dispositivo.
 *  2. Selección de PERFIL (tipo Netflix).
 *  3. PIN, solo si ese perfil lo tiene configurado.
 */
export function Acceso({ onOk }: { onOk: () => void }) {
  const [fase, setFase] = useState<"restaurante" | "perfiles">(
    getTokenRestaurante() ? "perfiles" : "restaurante"
  );
  if (fase === "restaurante") return <LoginRestaurante onOk={() => setFase("perfiles")} />;
  return <SeleccionPerfil onOk={onOk} onCambiarRestaurante={() => { cerrarSesionRestaurante(); setFase("restaurante"); }} />;
}

/* ── Paso 1: email + contraseña del restaurante ── */
function LoginRestaurante({ onOk }: { onOk: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(false);

  const entrar = async () => {
    setCargando(true); setError("");
    try {
      const r = await api<{ tokenRestaurante: string; restaurante: { nombre: string } }>(
        "/auth/restaurante",
        { method: "POST", body: { email, password, dispositivoId: deviceId() } }
      );
      setSesionRestaurante(r.tokenRestaurante, r.restaurante.nombre);
      onOk();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCargando(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6 py-10">
      <div className="absolute right-4 top-4"><BotonModo /></div>
      <div className="mb-8 text-center">
        <span className="mb-3 inline-flex size-14 items-center justify-center rounded-2xl bg-primary font-display text-3xl font-bold text-primary-foreground">C</span>
        <h1 className="text-2xl">Comandas</h1>
        <p className="mt-1 text-sm text-muted-foreground">Accede con la cuenta de tu restaurante</p>
      </div>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label>Email</Label>
          <Input type="email" autoComplete="email" placeholder="tu@restaurante.com"
            value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Contraseña</Label>
          <Input type="password" autoComplete="current-password" placeholder="••••••••"
            value={password} onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && email && password && entrar()} />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button size="lg" className="mt-1 font-semibold" disabled={!email || !password || cargando} onClick={entrar}>
          {cargando ? "Entrando…" : "Entrar al restaurante"}
        </Button>
      </div>
      <p className="mt-8 text-center font-mono text-[0.68rem] text-muted-foreground/60">{VERSION}</p>
    </div>
  );
}

/* ── Paso 2: selección de perfil ── */
const COLORES_AVATAR = ["bg-primary text-primary-foreground", "bg-sky-600 text-white", "bg-emerald-600 text-white", "bg-rose-600 text-white", "bg-violet-600 text-white", "bg-orange-600 text-white"];

function SeleccionPerfil({ onOk, onCambiarRestaurante }: { onOk: () => void; onCambiarRestaurante: () => void }) {
  const [perfiles, setPerfiles] = useState<Perfil[] | null>(null);
  const [pinPara, setPinPara] = useState<Perfil | null>(null);
  const [toast, avisar] = useToast();

  useEffect(() => {
    api<Perfil[]>("/auth/usuarios", { nivelRestaurante: true })
      .then(setPerfiles)
      .catch(() => { avisar("La sesión del restaurante caducó", true); onCambiarRestaurante(); });
  }, [avisar, onCambiarRestaurante]);

  const elegir = async (p: Perfil) => {
    if (p.tienePin) return setPinPara(p);
    // Sin PIN: entra directo.
    try {
      const r = await api<{ token: string; usuario: { id: string; nombre: string; rol: string } }>(
        "/auth/entrar", { method: "POST", body: { usuarioId: p.id }, nivelRestaurante: true }
      );
      setSesion(r.token, r.usuario);
      onOk();
    } catch (e) { avisar((e as Error).message, true); }
  };

  if (pinPara) return <PinPerfil perfil={pinPara} onVolver={() => setPinPara(null)} onOk={onOk} />;

  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center px-6 py-10">
      {toast}
      <div className="mb-9 text-center">
        <h1 className="text-2xl">{getRestauranteNombre() ?? "Restaurante"}</h1>
        <p className="mt-1 text-sm text-muted-foreground">¿Quién está trabajando?</p>
      </div>

      {!perfiles ? (
        <p className="text-center text-sm text-muted-foreground">Cargando perfiles…</p>
      ) : (
        <div className="flex flex-wrap justify-center gap-5">
          {perfiles.map((p, i) => (
            <button key={p.id} onClick={() => elegir(p)}
              className="group flex w-24 flex-col items-center gap-2.5 rounded-xl p-2 transition-transform hover:-translate-y-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <span className={cn(
                "relative flex size-20 items-center justify-center rounded-2xl font-display text-3xl font-bold shadow-lg transition-shadow group-hover:shadow-xl",
                COLORES_AVATAR[i % COLORES_AVATAR.length]
              )}>
                {p.nombre.charAt(0).toUpperCase()}
                {p.tienePin && (
                  <span className="absolute -bottom-1.5 -right-1.5 flex size-6 items-center justify-center rounded-full border-2 border-background bg-secondary">
                    <Lock className="size-3 text-muted-foreground" />
                  </span>
                )}
              </span>
              <span className="text-sm font-medium leading-tight">{p.nombre}</span>
              {p.rol === "admin" && <span className="-mt-1.5 text-[0.65rem] font-semibold uppercase tracking-wider text-primary">admin</span>}
            </button>
          ))}
        </div>
      )}

      <button onClick={onCambiarRestaurante}
        className="mx-auto mt-10 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
        <LogOut className="size-3.5" /> Salir del restaurante
      </button>
    </div>
  );
}

/* ── Paso 3: PIN del perfil (solo si lo tiene) ── */
function PinPerfil({ perfil, onVolver, onOk }: { perfil: Perfil; onVolver: () => void; onOk: () => void }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");

  const entrar = async (valor: string) => {
    try {
      const r = await api<{ token: string; usuario: { id: string; nombre: string; rol: string } }>(
        "/auth/entrar", { method: "POST", body: { usuarioId: perfil.id, pin: valor }, nivelRestaurante: true }
      );
      setSesion(r.token, r.usuario);
      onOk();
    } catch {
      setError("PIN incorrecto");
      setPin("");
    }
  };

  const tecla = (d: string) => {
    setError("");
    const nuevo = pin + d;
    if (nuevo.length <= 6) setPin(nuevo);
  };

  return (
    <div className="mx-auto flex min-h-dvh max-w-[22rem] flex-col justify-center px-5 py-10">
      <button onClick={onVolver} className="mb-6 flex items-center gap-1 self-start text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4" /> Perfiles
      </button>
      <div className="mb-6 text-center">
        <h2 className="text-xl">Hola, {perfil.nombre}</h2>
        <p className="mt-1 text-sm text-muted-foreground">Introduce tu PIN</p>
      </div>
      <div className={cn(
        "mb-4 flex h-16 items-center justify-center rounded-xl border bg-card font-mono text-2xl tracking-[0.4em]",
        error && "border-destructive/60 text-destructive text-base tracking-normal"
      )}>
        {error || (pin ? "●".repeat(pin.length) : <span className="text-muted-foreground/40">····</span>)}
      </div>
      <div className="grid grid-cols-3 gap-2.5">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
          <Button key={d} variant="secondary" className="h-14 font-mono text-xl" onClick={() => tecla(d)}>{d}</Button>
        ))}
        <Button variant="secondary" className="h-14" onClick={() => setPin(pin.slice(0, -1))} aria-label="Borrar"><Delete className="!size-5" /></Button>
        <Button variant="secondary" className="h-14 font-mono text-xl" onClick={() => tecla("0")}>0</Button>
        <Button className="h-14 font-semibold" disabled={pin.length < 3} onClick={() => entrar(pin)}>Entrar</Button>
      </div>
    </div>
  );
}
