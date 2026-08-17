import { useCallback, useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export function useToast(): [ReactNode, (msg: string, mal?: boolean) => void] {
  const [toast, setToast] = useState<{ msg: string; mal: boolean } | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);
  const nodo = toast ? (
    <div
      onClick={() => setToast(null)}
      className={cn(
        "fixed bottom-5 left-1/2 z-[90] max-w-[92vw] -translate-x-1/2 rounded-lg border bg-popover px-4 py-2.5 text-sm font-medium shadow-2xl animate-in fade-in slide-in-from-bottom-2",
        toast.mal && "border-destructive/50 text-destructive"
      )}
    >
      {toast.msg}
    </div>
  ) : null;
  // useCallback: sin esto, "avisar" es una función NUEVA en cada render.
  // Cualquier useEffect que la tenga como dependencia (p.ej. para cargar
  // datos al montar) se dispararía en bucle infinito — eso es justo lo que
  // pasaba con /auth/usuarios.
  const avisar = useCallback((msg: string, mal = false) => setToast({ msg, mal }), []);
  return [nodo, avisar];
}
