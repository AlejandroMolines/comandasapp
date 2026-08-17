// SW mínimo: la app debe ABRIR sin red, pero sin quedarse pegada a una
// versión vieja. Clave: el HTML va "red primero" (así siempre coges la build
// nueva si hay conexión) y los assets con hash en el nombre van "caché
// primero" (su nombre cambia en cada build, así que nunca sirven algo obsoleto).
const CACHE = "comandas-shell-v3";

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(["/", "/manifest.webmanifest", "/icon.svg"])));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.pathname.startsWith("/socket.io") || e.request.method !== "GET") return;

  // API: siempre red, nunca caché (de su modo offline se encarga la app con IndexedDB).
  const esApi = ["/usuarios", "/espacios", "/carta", "/destinos", "/comandas", "/turnos", "/salud", "/auth", "/ajustes"]
    .some((p) => url.pathname.startsWith(p));
  if (esApi) return;

  // Documentos HTML: RED PRIMERO. Si hay conexión, siempre la versión recién
  // compilada; si no hay, cae a la copia guardada para poder abrir offline.
  if (e.request.mode === "navigate") {
    e.respondWith(
      fetch(e.request)
        .then((resp) => {
          const copia = resp.clone();
          caches.open(CACHE).then((c) => c.put("/", copia));
          return resp;
        })
        .catch(() => caches.match("/"))
    );
    return;
  }

  // Assets (JS/CSS con hash, fuentes, iconos): caché primero, rellenando.
  e.respondWith(
    caches.match(e.request).then(
      (hit) =>
        hit ||
        fetch(e.request).then((resp) => {
          const copia = resp.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copia));
          return resp;
        })
    )
  );
});
