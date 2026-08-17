# pwa-camarero

Una sola aplicación web que sirve para todo: el móvil del camarero y el PC del
admin. No hay dos apps — al hacer login, el rol decide qué se muestra.

- **Stack:** React 18 · Vite 5 · Tailwind CSS 4 · shadcn/ui + Base UI · Recharts ·
  Socket.IO · idb-keyval · SheetJS
- **Puerto en desarrollo:** 5173 (hot reload) · **En producción** la sirve el
  backend en el 3000

## Estructura

```
src/
  main.tsx               Punto de entrada, carga las fuentes empaquetadas
  App.tsx                Router por rol, layout admin (sidebar) y FlujoSala
  acceso.tsx             Acceso en 3 pasos: restaurante -> perfil -> PIN
  vistas-camarero.tsx    Sala, Comanda (árbol + buscador), Cobro, mover mesa
  admin/
    Resumen.tsx          Estadísticas, gráficas, cierre de turno, informes Excel
    Carta.tsx            Árbol de menús/categorías/productos con IVA
    Empresas.tsx         Clientes con factura
    Paneles.tsx          Salas, Impresoras, Turnos, Personal, Ajustes
  components/ui.tsx      Componentes shadcn (Button con cva, Card, Dialog, Switch…)
  lib/utils.ts           cn() = clsx + tailwind-merge
  api.ts                 Cliente HTTP, gestión de los dos tokens
  offline.ts             Cache de maestros y cola de acciones pendientes
  informe.ts             Generación de los .xlsx con SheetJS
  tema.ts                Modo claro/oscuro, acento customizable, formato de € y fechas
  toast.tsx              Avisos flotantes
  uuid.ts                UUID que funciona sin HTTPS
  version.ts             Marcador de versión visible
  index.css              Tokens shadcn en oklch + la clase .ticket
public/
  sw.js                  Service worker
  manifest.webmanifest   Instalable como app
```

## Las dos experiencias

**Camarero (móvil)** — `FlujoSala`: selección de zona → mesas con total y
cronómetro → comanda → cobro.

**Admin (PC)** — sidebar con 9 secciones: Resumen, Tomar comandas (el mismo
`FlujoSala` embebido, porque el PC también pide), Carta, Salas, Impresoras,
Empresas, Turnos, Personal y Ajustes.

## Diseño

El mundo visual es **la pizarra del bar** (fondo oscuro verdoso) y **el papel de
ticket térmico** como elemento firma: la cuenta al cobrar, el top de ventas del
resumen y el cierre de caja se pintan como tickets reales, con borde dentado
(`clip-path`) y tipografía monoespaciada. Dinero, horas y cantidades **siempre en
mono** (IBM Plex Mono), como en una registradora.

Tipografías: Bricolage Grotesque (títulos), Public Sans (cuerpo), IBM Plex Mono
(datos). Van **empaquetadas vía npm (`@fontsource`)**, no desde Google Fonts: el
Raspberry tiene que pintar la app sin internet.

**Customización:** modo claro/oscuro (sigue la preferencia del sistema si no se ha
elegido) y cinco acentos con nombre de bar (Ámbar, Vermú, Oliva, Azulejo, Teja)
más un selector de color libre con contraste calculado automáticamente. Todo
escribe sobre `--primary`, así que tiñe botones, gráficas, ring y sidebar de golpe.

## Offline-first

Esto es lo que hace la app usable en un bar de verdad, donde el WiFi se cae en la
esquina de la terraza.

**Cache de maestros** (`offline.ts`): carta, zonas y mesas se guardan en IndexedDB.
Si al arrancar no hay red, se usa la copia guardada y el camarero puede seguir
tomando notas.

**Cola de acciones** (outbox): abrir comanda y enviar ronda **no** se envían
directamente. Se encolan en IndexedDB con un UUID generado en el cliente y se
vacían en orden (FIFO) cada 3 segundos. Consecuencias:

- El camarero pulsa «Enviar» y la interfaz responde al instante, con o sin red.
- Si el envío falla por red o por un `5xx`, se reintenta en el siguiente ciclo.
- Si falla con un `4xx` (dato inválido), **se descarta**: reintentar algo que el
  servidor rechaza por definición es un bucle infinito. Esto lo aprendimos por
  las malas.
- Al pulsar Cobrar se fuerza el vaciado: no se puede cobrar sin haber
  sincronizado, porque el total tiene que ser el real.
- Si el servidor responde que la mesa ya tenía una comanda abierta (otro camarero
  se adelantó), la cola **adopta ese id** para las rondas pendientes.

**Los UUID los genera el cliente** para que las operaciones sean idempotentes: si
una petición se envía dos veces por un reintento, no se duplica la comanda.

`uuid.ts` existe porque `crypto.randomUUID()` solo está disponible en contextos
seguros (HTTPS o localhost), y desde el móvil se entra por `http://192.168.x.x`.
El helper usa el nativo si está y si no genera el v4 a mano con
`crypto.getRandomValues`.

## Service worker

`public/sw.js`, versionado (`comandas-shell-v3`). La estrategia importa:

- **HTML: red primero.** Si hay conexión, siempre la build recién compilada; sin
  conexión, cae a la copia guardada para poder abrir. Esto arregla un bug real:
  con caché primero, el navegador servía eternamente un `index.html` viejo que
  apuntaba a JS antiguo, y no había forma de ver una actualización.
- **Assets: caché primero.** Los JS y CSS llevan hash en el nombre, así que su
  nombre cambia en cada build y no pueden quedar obsoletos.
- **API: nunca se cachea.** De funcionar sin red se encarga la cola de IndexedDB.

Además `index.html` detecta versiones nuevas (`updatefound` + `reg.update()` cada
60 s) y **recarga sola**: al actualizar el Raspberry, los móviles con la app
abierta se ponen al día sin que nadie toque nada.

## Informes Excel

`informe.ts` genera los `.xlsx` **en el navegador** con SheetJS, no en el
Raspberry: la Pi no gasta recursos y funciona igual sin internet. Cinco hojas:
Ingresos, Cierres de caja, IVA, Productos y Facturas. Rangos diario, semanal y
mensual. Ver [CAJA-E-INFORMES.md](../CAJA-E-INFORMES.md).

## Arrancar

```bash
# Desarrollo (hot reload, accesible desde el móvil)
pnpm --filter pwa-camarero dev
# -> http://localhost:5173 y http://<tu-ip>:5173

# Compilar para que la sirva el backend
pnpm --filter pwa-camarero build
# -> genera dist/, que el backend sirve en el :3000
```

`vite.config.ts` tiene `server: { host: true }`, que escucha en `0.0.0.0`. Sin
eso, Vite se ata solo a `localhost` (que resuelve a IPv6) y tanto `127.0.0.1`
como el móvil se quedan fuera.

| Variable | Para qué |
|---|---|
| `VITE_API` | URL del backend en desarrollo. En producción se deja vacía (mismo origen) |

## Confirmar qué versión estás viendo

`version.ts` exporta un marcador que aparece **abajo en la pantalla de login** y
en la consola del navegador. Si no coincide con la versión esperada, estás
viendo una build antigua: recompila la PWA y borra la caché del sitio
(DevTools → Application → Service Workers → Unregister, luego Clear site data).

## Bugs resueltos que conviene no repetir

- **`crypto.randomUUID` no existe por IP** → `uuid.ts` con fallback.
- **Bucle infinito de peticiones**: `avisar()` del hook de toast se recreaba en
  cada render, y un `useEffect` que lo tenía como dependencia se disparaba sin
  parar. Solución: `useCallback`.
- **Versión pegada**: el service worker servía HTML viejo (arreglado con
  network-first) y el script de arranque no recompilaba la PWA antes de servirla
  (arreglado en `scripts/dev.mjs`).
- **Comanda duplicada al reentrar en una mesa**: el cliente generaba un id nuevo
  e ignoraba el que devolvía el servidor. Ahora consulta `/comandas/abiertas` y
  reutiliza.
- **Cobro «lento»**: no era el servidor (2–7 ms medidos), era un `await` de la
  cola sin feedback visual.

## Pendiente

- **KDS**: la interfaz de pantalla de cocina (el driver del worker ya está).
- Los avisos usan `prompt()`/`confirm()` del navegador en un par de sitios;
  estaría mejor con diálogos propios.
