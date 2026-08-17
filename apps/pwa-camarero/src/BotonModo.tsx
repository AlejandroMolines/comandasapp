import { Moon, Sun } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui";
import { alternarModo, getModo, type Modo } from "./tema";

/** Botón de sol/luna. Disponible tanto en el panel admin como en el móvil. */
export function BotonModo({ size = "icon-sm" }: { size?: "icon" | "icon-sm" }) {
  const [modo, setModo] = useState<Modo>(getModo());
  return (
    <Button
      variant="ghost"
      size={size}
      title={modo === "claro" ? "Cambiar a modo oscuro" : "Cambiar a modo claro"}
      aria-label="Cambiar tema"
      onClick={() => setModo(alternarModo())}
    >
      {modo === "claro" ? <Moon /> : <Sun />}
    </Button>
  );
}
