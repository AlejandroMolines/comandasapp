import { useState } from "react";
import { api, setSesion, setSesionRestaurante } from "./api";
import { Button, Input, Label } from "@/components/ui";

/**
 * Alta de camarero abierta al escanear el QR del PC.
 * El token del QR es la autorización: no hace falta la contraseña del local.
 */
export function AltaCamarero() {
  const token = new URLSearchParams(window.location.search).get("t") ?? "";
  const [nombre, setNombre] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState(token ? "" : "Este enlace no trae el código del PC. Escanéalo de nuevo.");
  const [enviando, setEnviando] = useState(false);

  const enviar = async () => {
    setEnviando(true);
    setError("");
    try {
      const r = await api<{
        token: string;
        tokenRestaurante: string;
        usuario: { id: string; nombre: string; rol: string };
        restaurante: { nombre: string };
      }>("/auth/alta-camarero", {
        method: "POST",
        body: { token, nombre: nombre.trim(), ...(pin ? { pin } : {}) },
      });
      setSesionRestaurante(r.tokenRestaurante, r.restaurante.nombre);
      setSesion(r.token, r.usuario);
      window.location.replace("/");
    } catch (e) {
      setError((e as Error).message);
      setEnviando(false);
    }
  };

  return (
    <main className="flex min-h-dvh items-center justify-center bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-primary/10 via-background to-background px-5 py-8">
      <section className="w-full max-w-sm rounded-2xl border bg-card/95 p-6 shadow-xl shadow-black/20 sm:p-8">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-3 grid size-20 place-items-center rounded-3xl border border-primary/20 bg-[#fff9f1] shadow-sm">
            <img src="/marca-comandas.svg" alt="" className="size-14" />
          </div>
          <span className="mb-4 text-xs font-bold uppercase tracking-[0.22em] text-primary">Comandas</span>
          <h1 className="mb-2 text-2xl">Alta de camarero</h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Registra este móvil en el restaurante para empezar a recibir y enviar comandas.
          </p>
        </div>
        <div className="mb-5 flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2.5 text-xs text-muted-foreground">
          <span className="size-2 shrink-0 rounded-full bg-primary" />
          El QR es temporal y caduca en unos minutos.
        </div>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="alta-nombre">Tu nombre</Label>
          <Input id="alta-nombre" autoFocus value={nombre} maxLength={40}
            onChange={(e) => setNombre(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="alta-pin">PIN (opcional)</Label>
          <Input id="alta-pin" inputMode="numeric" className="font-mono" maxLength={6} value={pin}
            placeholder="Sin PIN entras directo"
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button size="lg" disabled={!token || !nombre.trim() || enviando || (pin.length > 0 && pin.length < 3)}
          onClick={() => void enviar()}>
          {enviando ? "Registrando…" : "Registrarme"}
        </Button>
      </div>
      </section>
    </main>
  );
}
