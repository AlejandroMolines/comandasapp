# Comandas

Sistema de comandas para restaurantes que funciona **sin depender de internet**.
Los camareros toman nota desde el móvil, las comandas salen impresas en cocina y
barra, y se cobra desde el mismo sitio.

La pieza central es un **Raspberry Pi por restaurante** que hace de servidor
local. Si se cae la línea de internet, el bar sigue trabajando exactamente igual:
comandas, impresión, cobros y cierre de caja son todos locales. Los móviles y el
PC son solo navegadores, no hay nada que instalar en ellos.

## Qué hace

**Servicio**
- Acceso en tres pasos: cuenta del restaurante → perfil del camarero → PIN opcional
- Sala por zonas, con el total y el tiempo de cada mesa ocupada
- Carta como árbol navegable con buscador
- Extras y modificaciones por producto (con coste o sin coste), heredables por categoría
- Guardar sin imprimir o enviar a cocina, según el caso
- Mover o unir mesas
- Cobro con método de pago, pagos partidos y pedidos para llevar
- Funcionamiento offline: la app guarda las comandas y las envía al recuperar la red

**Administración**
- Resumen del turno: facturación, métodos de pago, top de productos, rendimiento
  por camarero y tiempo medio de mesa
- Gestión de carta, salas (con alta de mesas en lote), impresoras y personal
- Turno perpetuo con fondo de caja fijo y cierre con descuadre
- Historial de tickets con reimpresión marcada como copia
- Informes en Excel (diario, semanal, mensual) con desglose de IVA

**Facturación**
- Tickets como factura simplificada, con numeración correlativa y datos fiscales
- Facturas completas a empresas, con validación real de NIF/CIF y desglose de IVA
- Enrutado de productos a impresoras en cascada por el árbol de categorías

## Arquitectura

```
móviles (camareros) ─┐
                     ├── WiFi ── RASPBERRY PI ── cable ── impresoras
PC admin (kiosko) ───┘                 │
                              backend :3000 (API + sirve la PWA)
                              SQLite (WAL)
                              printer-worker (proceso aparte)
```

| Paquete | Qué es | Stack |
|---|---|---|
| `apps/raspberry-backend` | API, base de datos y servidor de la PWA | Node 22, Express, better-sqlite3, Socket.IO, Zod |
| `apps/printer-worker` | Cola de impresión → impresoras | Node 22, ESC/POS propio |
| `apps/pwa-camarero` | La app (camarero y admin) | React 18, Vite 5, Tailwind 4, shadcn/ui |
| `packages/shared-types` | Tipos compartidos | TypeScript |

Monorepo con **pnpm workspaces**. Node 22 (fijado en `.nvmrc`).

## Arrancar

```bash
nvm use 22
pnpm install
pnpm start:all --fake     # --fake levanta una impresora simulada
```

El script compila la PWA, arranca el backend, crea el admin si no existe, lanza
el worker y Vite, y muestra las URLs (incluida la del móvil).

**Login de demostración:** `admin@demo.com` / `admin` → perfil Admin → PIN `1234`

Desde el móvil, en la misma WiFi: `http://<ip-que-indica-el-script>:3000`

### Primeros pasos

Recién instalado no hay nada configurado. En el panel admin:

1. **Salas** → una zona y sus mesas (hay alta en lote: prefijo + cantidad)
2. **Carta** → un menú, dentro categorías, dentro productos con precio e IVA
3. **Impresoras** → al menos una. Para probar sin hardware: red, `127.0.0.1`, puerto `9100`
4. **Carta** → en cada categoría, el icono de impresora para decir dónde imprime
5. **Personal** → los camareros (el PIN es opcional)
6. **Turnos** → el fondo de caja fijo

El turno ya está abierto: no hay que abrirlo nunca.

## Documentación

| Documento | Contenido |
|---|---|
| [docs/ARQUITECTURA.md](./docs/ARQUITECTURA.md) | Visión de conjunto, decisiones, hardware y despliegue |
| [docs/API.md](./docs/API.md) | Todos los endpoints y eventos WebSocket |
| [docs/MODELO-DATOS.md](./docs/MODELO-DATOS.md) | Las tablas y por qué están así |
| [docs/raspberry-backend.md](./docs/raspberry-backend.md) | El backend y la base de datos |
| [docs/printer-worker.md](./docs/printer-worker.md) | El worker de impresión |
| [docs/pwa-camarero.md](./docs/pwa-camarero.md) | La app (camarero y admin) |
| [docs/TICKETS.md](./docs/TICKETS.md) | Formato legal del ticket y numeración |
| [docs/EXTRAS.md](./docs/EXTRAS.md) | Extras y modificaciones de productos |
| [docs/HISTORIAL.md](./docs/HISTORIAL.md) | Historial, retención y mantenimiento |
| [docs/PUNTO-ACCESO.md](./docs/PUNTO-ACCESO.md) | El Raspberry como punto de acceso WiFi |
| [FACTURACION.md](./FACTURACION.md) | Facturas a empresas, IVA y Verifactu |
| [CAJA-E-INFORMES.md](./CAJA-E-INFORMES.md) | Caja inicial e informes en Excel |

## Estado del proyecto

En desarrollo. El flujo completo de servicio funciona y está probado, pero
**antes de usarlo en un restaurante real** hay que resolver:

1. **Seguridad.** El token es base64 sin firmar y los PIN y contraseñas se
   guardan en texto plano. Es aceptable en una LAN cerrada, pero hay que pasar a
   JWT firmado y bcrypt antes de exponer nada. Está marcado con `TODO` en el código.
2. **Backup automático.** Existe el script (`scripts/mantenimiento.mjs`) pero hay
   que instalarlo como tarea de systemd. Es el riesgo real: el día que muera la
   tarjeta SD se pierde el histórico.
3. **Verifactu.** Obligatorio en 2027 (enero para sociedades, julio para
   autónomos). Falta el hash encadenado, el QR y el registro de eventos. La
   sanción por software no conforme es de 50.000 € por ejercicio.

Pendiente además: pantalla de cocina (KDS), y sincronización con un servidor
cloud para gestionar varios locales.

> Esto no es asesoramiento fiscal. Antes de emitir facturas reales, confirma con
> un gestor los tipos de IVA y los requisitos que te aplican.

## Licencia

MIT

---

<details>
<summary>Notas de desarrollo (historial de cambios)</summary>

Monorepo pnpm. Contiene por ahora:

- `packages/shared-types`: entidades TypeScript compartidas (Usuario, Mesa, Producto, Comanda, Ronda, PuntoDestino, EventoSync...).
- `apps/raspberry-backend`: API que corre en el Raspberry de cada restaurante (Express + Socket.IO + SQLite/better-sqlite3). En producción sirve también la PWA compilada.
- `apps/printer-worker`: proceso independiente que imprime (ESC/POS red/USB, pantallas KDS).
- `apps/pwa-camarero`: PWA React para el móvil del camarero (offline-first con IndexedDB).

## Cómo ejecutar TODO (desarrollo)

## Requisitos

- **Node 20 o 22 (LTS)**. El proyecto trae un `.nvmrc` — si usas `nvm`, con `nvm use` en la raíz ya coge la versión correcta.
- pnpm (`npm i -g pnpm`).

> ⚠️ **No uses Node 24/26 todavía.** `better-sqlite3` compila un módulo nativo contra la API de V8, y las versiones muy recientes de Node (26.x en el momento de escribir esto) cambiaron esa API (`GetPrototype`, `GetIsolate`, `PropertyCallbackInfo::This` ya no existen), así que la compilación falla con errores tipo `has no member named 'GetPrototype'`. Si te pasa esto:
> ```bash
> nvm install 22        # o: nvm install 20
> nvm use 22
> rm -rf node_modules apps/*/node_modules packages/*/node_modules pnpm-lock.yaml
> pnpm install
> ```

**Opción rápida — un solo comando** (Linux/Arch, macOS y Windows):

```bash
pnpm start:all          # equivale a: node scripts/dev.mjs --fake
```

Arranca en orden: backend (:3000) → crea el restaurante demo (login **admin@demo.com / admin**) y el perfil Admin (PIN 1234) si no existen →
impresora térmica falsa (:9100) → worker de impresión → PWA en dev (:5173).
Instala dependencias y compila `shared-types` él solo si es la primera vez.
`Ctrl+C` para todo el árbol de procesos de golpe. Sin `--fake`
(`node scripts/dev.mjs`) no levanta la impresora falsa, para cuando tengas
una térmica real en la red.

**Opción manual — terminal a terminal:**

```bash
# 1. Instalar y compilar tipos compartidos (una vez)
pnpm install
pnpm --filter @comandas/shared-types build

# 2. Terminal A — backend (crea la SQLite sola al arrancar)
pnpm --filter raspberry-backend dev

# 3. Crear el primer admin (una sola vez, con el backend ya arrancado)
cd apps/raspberry-backend && node scripts/bootstrap-admin.mjs   # PIN 1234

# 4. Terminal B — worker de impresión
pnpm --filter printer-worker dev

# 5. (opcional) Terminal C — impresora térmica FALSA para probar sin hardware
node apps/printer-worker/scripts/impresora-fake.mjs   # escucha en :9100

# 6. Terminal D — PWA en modo desarrollo (hot reload)
cd apps/pwa-camarero && VITE_API=http://127.0.0.1:3000 pnpm dev
# abre http://localhost:5173 — login con PIN 1234
```

Primeros pasos dentro de la app (como admin, vía API o curl de momento):
abrir turno (`POST /turnos`), crear zona+mesas, menú→categoría→productos,
punto de destino (impresora) y asignarlo a la categoría. Con eso, la PWA
ya muestra mesas y carta, y las rondas se imprimen.

## Cómo ejecutar en el Raspberry (producción)

```bash
pnpm install
pnpm -r build                       # compila tipos, backend, worker y PWA
cp apps/raspberry-backend/src/db/schema.sql apps/raspberry-backend/dist/db/

# El backend sirve la PWA compilada él solo:
node apps/raspberry-backend/dist/server.js     # servicio systemd 1
node apps/printer-worker/dist/worker.js        # servicio systemd 2
```

Los móviles de los camareros abren `http://<ip-del-raspberry>:3000` en el
navegador y añaden la app a la pantalla de inicio (es una PWA instalable).
Todo es same-origin: API, websocket y app en el mismo puerto. Variables útiles:
`PORT`, `RESTAURANTE_ID`, `DB_PATH` (backend y worker deben compartir `DB_PATH`).

## PWA del camarero (añadido)

- **Login por PIN** con teclado táctil; token en localStorage; id de dispositivo autogenerado.
- **Mesas por zona** con semáforo de estado (libre/ocupada/reservada) y botón "Para llevar".
- **Toma de comanda**: categorías raíz como pestañas (los productos de subcategorías se muestran con su padre), líneas con cantidad y notas para cocina (tocando la línea), envío de ronda.
- **Offline-first**: la carta/zonas/mesas se cachean en IndexedDB (si no hay red, se sirve la última copia); abrir comanda y enviar ronda se encolan en una cola FIFO local (`idb-keyval`) con UUIDs generados en el cliente, y un flusher las entrega cada 3s o al evento `online`. Errores 4xx descartan la acción con aviso (no bloquean la cola); errores de red reintentan. Badge "⏳ N sin enviar" visible en la barra.
- **Cobro**: cuenta (total/pagado/pendiente), método efectivo/tarjeta, selector de caja si hay varias impresoras de ticket, y cierre que libera la mesa. El cobro exige cola vacía (no se puede cobrar una comanda que aún no llegó al servidor).
- **Tiempo real**: Socket.IO refresca mesas al liberarse, disponibilidad de productos, y muestra la alerta "⚠️ impresora no responde" cuando el worker agota reintentos.
- **Instalable**: manifest + service worker propio que cachea el shell (la app abre sin red; los datos vienen de IndexedDB).


## Flujo probado end-to-end

1. `POST /usuarios/login` con el PIN → token.
2. `POST /espacios/zonas` y `POST /espacios/mesas` (requieren rol admin).
3. Crear Menú → Categoría → Producto → PuntoDestino → CategoriaDestino (de momento a mano en la BD, falta el CRUD de carta/destinos en rutas — ver TODOs).
4. `POST /comandas` para abrir una mesa.
5. `POST /comandas/:id/rondas` para enviar una ronda — resuelve el destino de cada línea en cascada (producto → categoría → categoría padre) y encola un ticket agrupado por destino en `log_impresion`.

## CRUD de carta y destinos (añadido)

- `/carta`: CRUD completo de menús, categorías (árbol con `categoriaPadreId`, protección anti-ciclos) y productos.
  - `GET /carta/completa`: toda la carta en una llamada — es lo que la PWA cacheará en IndexedDB para el modo offline.
  - `PATCH /carta/productos/:id/disponibilidad`: acción rápida de agotado, accesible también al camarero (no solo admin), emite `producto:disponibilidad` por Socket.IO a todos los dispositivos.
  - `DELETE /carta/productos/:id`: si el producto aparece en comandas históricas se desactiva en vez de borrarse (protege el histórico de ventas).
  - Borrados de menú/categoría bloqueados (409) mientras tengan contenido.
- `/destinos`: CRUD de puntos de destino con validación de config por protocolo (discriminated union: `escpos_red` exige ip/puerto, `websocket_kds` exige canal, etc.).
  - `POST /destinos/categorias/:id/asignar` y `POST /destinos/productos/:id/asignar`: mapeos de la cascada de resolución.
  - `GET /destinos/sin-destino`: auditoría de productos que quedarían huérfanos al enviarse (para el panel del admin).
  - Borrado de destino bloqueado (409) mientras haya productos/categorías apuntándole.

## printer-worker (añadido)

Proceso independiente (`apps/printer-worker`) que comparte la SQLite con el backend (modo WAL) y consume la cola `log_impresion`:

- **Drivers** intercambiables por protocolo: `escpos_red` (TCP a IP:9100, con builder ESC/POS propio y transliteración de acentos/ñ para CP437), `escpos_usb` (escritura directa a `/dev/usb/lpX`), `websocket_kds` (envía el ticket como JSON vía backend al canal de la pantalla, con ack).
- **Cola**: FIFO por destino (secuencial dentro de un destino, paralelo entre destinos), backoff 2s/5s/15s, 4 intentos máximo → `error_definitivo` + evento `impresion:fallida` a todos los dispositivos.
- **Health check** cada 30s por destino (`estado_salud` ok/caido en BD) con evento `destino:salud` solo en transiciones.
- El backend hace de puente Socket.IO: `kds:registrar` para pantallas, y rebota los eventos del worker (`impresion:ok`, `impresion:fallida`, `destino:salud`) a la room del restaurante.
- Testing: `scripts/impresora-fake.mjs` levanta una impresora TCP falsa en :9100 que vuelca los bytes recibidos a `/tmp/impresora-recibido.bin`.

Arrancar: `pnpm --filter printer-worker dev` (variables: `DB_PATH`, `BACKEND_URL`, `RESTAURANTE_ID`).

## Turnos y pagos (añadido)

- `/turnos`: `POST /` abre turno con caja inicial (solo admin, bloquea segundo turno simultáneo con 409); `GET /activo` lo puede consultar cualquier rol (el móvil lo necesita para colgar comandas, sin datos económicos); `POST /:id/cerrar` calcula efectivo esperado (caja inicial + cobros en efectivo) y devuelve el **descuadre** contra la caja contada, avisando de comandas aún abiertas.
- `GET /turnos/:id/resumen` — **exclusivo admin (403 para camareros, verificado)**: facturación total, propinas, desglose por método de pago, comandas por tipo, mesas sentadas, ticket medio y top 10 productos.
- `/comandas/:id/cuenta`: total/pagado/pendiente para cantar la cuenta antes de cobrar.
- `POST /comandas/:id/pagos`: pagos partidos (varios pagos por comanda), rechaza sobrecobros (importe > pendiente), y al saldar cierra la comanda y **libera la mesa automáticamente** (eventos `pago:registrado` y `mesa:liberada` por Socket.IO). Si se indica `impresoraTicketId` (validada como tipo `impresora_ticket`), encola el ticket de caja en `log_impresion` — el worker lo imprime con el TOTAL de la cuenta completa (no del pago parcial).

## Acceso en tres pasos (añadido)

1. **Login del restaurante** (email + contraseña) — una vez por dispositivo. Demo: `admin@demo.com` / `admin`.
2. **Seleccion de perfil** tipo Netflix (avatares con inicial; candado si el perfil tiene PIN).
3. **PIN** — solo si el perfil lo tiene; sin PIN se entra directo. Al crear camareros el PIN es opcional.

"Salir" vuelve a la seleccion de perfiles (la sesion del restaurante persiste); "Salir del restaurante" pide credenciales de nuevo. Endpoints: `POST /auth/restaurante`, `GET /auth/usuarios`, `POST /auth/entrar`. El login viejo por PIN global se elimino.

## Interfaz visual completa (añadido)

Un único frontend (`pwa-camarero`) con dos experiencias según el rol al hacer login:

- **Camarero (móvil)**: login por PIN con teclado táctil, sala con semáforo de mesas por zona, comanda con categorías como pestañas y notas de cocina, y cobro donde la cuenta se muestra como **ticket de papel térmico** (borde dentado, tipografía mono) — la firma visual de la app.
- **Admin (PC)**: panel con sidebar y 8 secciones — Resumen (stats + gráficas recharts + top ventas en formato ticket), Tomar comandas (el mismo flujo de sala embebido), Carta (árbol de menús/categorías/productos con alta/edición/borrado, toggle de agotado, asignación de impresora por categoría y aviso de productos sin impresora), Salas (CRUD de zonas y mesas), Impresoras (alta con formulario según conexión red/USB/pantalla, semáforo de salud en vivo, panel de incidencias con botón Reintentar), Turnos (abrir/cerrar con descuadre mostrado como ticket de cierre, historial), Personal (alta de camareros, activar/desactivar) y Ajustes.
- **Customizable**: en Ajustes, 5 acentos predefinidos (Ámbar, Vermú, Oliva, Azulejo, Teja) + selector de color libre con contraste automático, persistido en localStorage.
- **Identidad**: pizarra verde-negra de fondo, papel de ticket como elemento firma, y dinero/horas/datos siempre en IBM Plex Mono. Tipografías Bricolage Grotesque + Public Sans **empaquetadas vía @fontsource** (npm), no CDN — la app carga sus fuentes sin internet, como exige el Raspberry.
- Librerías: `lucide-react` (iconos), `recharts` (gráficas), `@fontsource/*` (tipografía offline).

El script `pnpm start:all` no cambia: la UI nueva vive dentro de la misma PWA que ya arrancaba.

## Cambios recientes (6)

1. **Se pueden añadir productos las veces que se quiera.** Bug: al reentrar en
   una mesa ya abierta, el cliente generaba un id de comanda NUEVO e intentaba
   usarlo; el servidor devolvia la comanda existente pero el cliente lo
   ignoraba, asi que las rondas iban a una comanda inexistente -> error.
   Arreglado: ahora consulta /comandas/abiertas y reutiliza la comanda de esa
   mesa. Ademas la cola offline adopta el id que devuelve el servidor si la
   mesa ya estaba abierta por otro camarero.
   Probado: 4 tandas seguidas sobre la misma mesa, 20 EUR / 10 uds acumulados.

2. **El cobro ya no tarda.** La causa no era el servidor (las peticiones del
   cobro tardan 2-7 ms medidos): era el await vaciarCola() bloqueante sin
   ningun feedback visual. Ahora: camino rapido cuando no hay nada pendiente,
   aviso Sincronizando... cuando si lo hay, vaciarCola devuelve el envio en
   curso en vez de ignorarlo (antes daba un falso sin sincronizar), las
   impresoras de caja no bloquean, y el boton muestra Cobrando...

## Cambios recientes (5) — bug de sesion tras resetear la BD

Causa real de los FOREIGN KEY constraint failed en bucle: requireAuth
decodificaba el token pero NUNCA comprobaba que ese usuario siguiera
existiendo en la BD. Al borrar/recrear data/ durante pruebas, el navegador
se quedaba con un token de un usuario ya inexistente; cualquier insert que
referenciara camarero_id (rondas, comandas...) reventaba sin control.

Arreglado:
- requireAuth (middleware/auth.ts) ahora consulta la BD y exige que el
  usuario del token exista y este activo; si no, 401 limpio.
- api.ts (frontend): un 401 fuera del propio login/PIN limpia la sesion y
  recarga la app sola, en vez de dejar que cada accion falle en silencio.

Probado en vivo: token de un usuario borrado -> 401 limpio (antes: crash
en bucle). Login normal, sesion valida y PIN incorrecto siguen igual.

## Cambios recientes (4) — IMPORTANTE

El bug de la version vieja era del script, no del navegador: pnpm start:all
arrancaba el backend sirviendo la PWA desde apps/pwa-camarero/dist, pero esa
carpeta NUNCA se recompilaba sola. Si ya habia una build vieja ahi (de una
sesion anterior), el puerto :3000 la seguia sirviendo para siempre, sin
importar cuantas veces se recargara el navegador o se cambiara de dispositivo.

Arreglado: scripts/dev.mjs ahora COMPILA SIEMPRE la PWA antes de arrancar
el backend, en cada ejecucion de pnpm start:all, sin excepcion. Ademas
imprime la version servida directamente en la terminal (leida de
src/version.ts), asi que se puede confirmar la build sin tocar el navegador.

## Cambios recientes (3)

- La zona seleccionada ya no se pierde al volver de una mesa con la flecha de atras.
- Mesa ocupada -> primero resumen de lo pedido, con boton + Anadir productos.
- Marcador de version visible en el login y en consola.

## Cambios recientes (2)

- **Vite escucha en toda la red** (host: true): hot reload por localhost, 127.0.0.1 y desde el movil. El script imprime la IP de la LAN.
- **La mesa solo se pone en rojo cuando tiene algo pedido**: abrirla y salir sin pedir la deja libre (ocupada se marca al enviar la primera ronda).
- **Cronometro por mesa**: tiempo desde que se abre hasta que se cobra, en la sala (ambar a 1h, rojo a 2h) y medio/maximo en el resumen.
- **Seleccion de zona primero**, luego sus mesas. Con una sola zona entra directo.
- **Nombres de mesa unicos POR ZONA**: 1-10 en Sala y 1-10 en Terraza a la vez.
- **Carta como arbol navegable** con migas de pan + **buscador** de productos sobre toda la carta.
- **Contadores por producto (0-99)** con + y -; tocar el nombre abre **comentarios y agregados** (chips rapidos + texto libre + cantidad), que se imprimen para cocina.

## Cambios recientes

- **Modo claro / oscuro** en toda la app (admin y movil): boton sol/luna en la barra y en Ajustes. Sigue la preferencia del sistema si no se ha elegido nada.
- **Caja inicial editable** durante el turno abierto (PATCH /turnos/:id/caja-inicial).
- **Mesas en lote** (POST /espacios/mesas/lote): prefijo opcional + cantidad + desde. Ej. T y 12 -> T1..T12. Sin prefijo -> 1..12. Omite las que ya existan.
- **Ajuste imprimir_llevar** (/ajustes): si se desactiva, los pedidos para llevar se registran y cuentan para caja/estadisticas pero no se imprimen.
- **Conteo por camarero** en el resumen de turno: comandas, mesas, pedidos para llevar e importe por persona.
- **Resumen de mesa en la sala**: cada mesa ocupada muestra total, unidades y quien la atiende (GET /comandas/abiertas).
- **Ya pedido** en la comanda: bloque desplegable con las rondas anteriores de esa mesa y su total.
- **Cierre de cuenta** con recuento de productos y metodo de pago en el ticket; totales por metodo en el resumen.

## Pendiente (siguientes pasos naturales)

- Sync Raspberry ↔ Cloud: rellenar `eventos_sync` (outbox) desde las escrituras y el proceso que las empuja al Cloud.
- Vistas admin en la PWA (gestión de carta/destinos/turnos desde el PC — hoy se hace vía API).
- Idempotencia de rondas: aceptar `rondaId` del cliente en `POST /comandas/:id/rondas` para deduplicar reintentos tras corte de red a mitad de respuesta (las comandas ya lo soportan con `id`).
- Sustituir el "token" base64 sin firmar por JWT firmado, y el PIN en texto plano por hash (bcrypt) — está marcado con `TODO` en `middleware/auth.ts` y `modules/usuarios/routes.ts`.
- `pwa-camarero`: la app React con IndexedDB + Service Worker para el modo offline.


</details>
