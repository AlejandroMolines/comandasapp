// Tema customizable: --primary persistido en localStorage.
export const ACENTOS = [
  { nombre: "Ámbar", color: "#e8a33d", tinta: "#231503" },
  { nombre: "Vermú", color: "#d05a4e", tinta: "#fff5f3" },
  { nombre: "Oliva", color: "#9fb050", tinta: "#191c07" },
  { nombre: "Azulejo", color: "#5b93cf", tinta: "#0a1523" },
  { nombre: "Teja", color: "#cd7a45", tinta: "#221002" },
];

// ── Modo claro / oscuro ───────────────────────────────────────────────
export type Modo = "claro" | "oscuro";

export function getModo(): Modo {
  const guardado = localStorage.getItem("modo") as Modo | null;
  if (guardado) return guardado;
  // Sin preferencia guardada: seguimos la del sistema operativo.
  return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "claro" : "oscuro";
}

export function aplicarModo(modo: Modo) {
  document.documentElement.classList.toggle("light", modo === "claro");
  localStorage.setItem("modo", modo);
}

export function alternarModo(): Modo {
  const nuevo: Modo = getModo() === "claro" ? "oscuro" : "claro";
  aplicarModo(nuevo);
  return nuevo;
}

export function aplicarAcento(color: string, tinta: string) {
  document.documentElement.style.setProperty("--primary", color);
  document.documentElement.style.setProperty("--primary-foreground", tinta);
  localStorage.setItem("tema", JSON.stringify({ color, tinta }));
}

export function cargarTema() {
  aplicarModo(getModo());
  const raw = localStorage.getItem("tema");
  if (!raw) return;
  try {
    const { color, tinta } = JSON.parse(raw);
    aplicarAcento(color, tinta);
  } catch { /* tema corrupto: ignorar */ }
}

/** contraste automático para el picker libre */
export function tintaPara(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const lum = 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
  return lum > 150 ? "#1c1408" : "#fdf8ef";
}

export const eur = (n: number) => `${n.toFixed(2).replace(".", ",")} €`;
export const hora = (iso: string) => new Date(iso).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
export const fecha = (iso: string) =>
  new Date(iso).toLocaleDateString("es-ES", { day: "numeric", month: "short" }) + " · " + hora(iso);
