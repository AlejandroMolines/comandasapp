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
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6 py-10">
      <h1 className="mb-1 text-2xl">Alta de camarero</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Este móvil quedará registrado en el local. El código del QR caduca en unos minutos.
      </p>
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
    </div>
  );
}
