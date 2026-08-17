# API del raspberry-backend

Todos los endpoints viven en `http://<ip-del-raspberry>:3000`. La API no usa
prefijo `/api`: el backend sirve además la PWA compilada, así que las rutas de
datos y los archivos estáticos conviven en el mismo puerto (mismo origen, cero
problemas de CORS en producción).

## Índice

- [Autenticación](#autenticación)
- [Convenciones y errores](#convenciones-y-errores)
- [/auth — acceso en 3 pasos](#auth--acceso-en-3-pasos)
- [/usuarios — personal](#usuarios--personal)
- [/espacios — zonas y mesas](#espacios--zonas-y-mesas)
- [/carta — menús, categorías y productos](#carta--menús-categorías-y-productos)
- [/destinos — impresoras y pantallas](#destinos--impresoras-y-pantallas)
- [/comandas — comandas y rondas](#comandas--comandas-y-rondas)
- [Cuenta y pagos](#cuenta-y-pagos)
- [/turnos — turnos, resumen e informes](#turnos--turnos-resumen-e-informes)
- [/empresas — clientes con factura](#empresas--clientes-con-factura)
- [/ajustes — configuración](#ajustes--configuración)
- [/salud](#salud)
- [Eventos WebSocket](#eventos-websocket)

---

## Autenticación

Hay **dos niveles de token**, ambos enviados como `Authorization: Bearer <token>`:

| Nivel | Se obtiene en | Sirve para |
|---|---|---|
| **Restaurante** | `POST /auth/restaurante` | Listar perfiles y entrar en uno. Nada más. |
| **Usuario** | `POST /auth/entrar` | Todo el resto de la API. |

El token de usuario lleva `usuarioId`, `restauranteId`, `rol` y `dispositivoId`.
El middleware `requireAuth` comprueba en cada petición que **el usuario sigue
existiendo y está activo** en la base de datos; si no, responde `401` y la PWA
limpia la sesión y vuelve al login.

> **Aviso de seguridad, importante para producción:** el token es un JSON en
> base64 **sin firmar**, y los PIN y la contraseña del restaurante se guardan en
> texto plano. Es aceptable en una LAN cerrada donde el riesgo real es bajo, pero
> antes de exponer nada a internet hay que cambiarlo por JWT firmado y bcrypt.
> Está marcado con `TODO` en `middleware/auth.ts` y `usuarios/routes.ts`.

**Roles:** `admin` y `camarero`. Los endpoints marcados con 🔒 exigen `admin`.

## Convenciones y errores

- Cuerpos y respuestas en JSON. Fechas siempre en ISO 8601 (`2026-08-04T18:30:00.000Z`).
- Los nombres de campo de **entrada** van en `camelCase` (`mesaId`, `cajaInicial`);
  los de **salida** suelen venir tal cual de SQLite, en `snake_case`
  (`mesa_id`, `caja_inicial`). No es elegante, pero evita una capa de traducción
  en un sistema que corre en un Raspberry.
- Validación con Zod. Un cuerpo inválido devuelve `400` con el formato de
  `error.flatten()` de Zod (`{ formErrors, fieldErrors }`).
- Errores de negocio: `{ "error": "mensaje legible en español" }`.

| Código | Cuándo |
|---|---|
| `400` | Datos inválidos, o acción imposible (cobrar de más, NIF incorrecto…) |
| `401` | Sin token, token inválido, o el usuario ya no existe |
| `403` | Rol insuficiente |
| `404` | El recurso no existe |
| `409` | Conflicto de estado (mesa con comanda abierta, turno ya cerrado…) |
| `500` | Error no controlado (hay un manejador global que evita tumbar el proceso) |

---

## /auth — acceso en 3 pasos

El flujo replica la experiencia tipo Netflix: el dispositivo se vincula una vez
al restaurante, y luego cada camarero elige su perfil.

### `POST /auth/restaurante`
Login del restaurante. **No requiere token.**

```json
{ "email": "admin@demo.com", "password": "admin", "dispositivoId": "uuid-del-dispositivo" }
```
→ `200` `{ "tokenRestaurante": "...", "restaurante": { "id": "...", "nombre": "..." } }`
→ `401` si las credenciales no cuadran.

### `GET /auth/usuarios`
Perfiles disponibles. **Requiere token de restaurante.**

→ `200` `[{ "id": "...", "nombre": "Ana", "rol": "camarero", "tienePin": false }]`

Nunca devuelve el PIN, solo si el perfil tiene uno (`tienePin`), que es lo que
la app necesita para saber si pintar el teclado o entrar directo.

### `POST /auth/entrar`
Entrar en un perfil. **Requiere token de restaurante.**

```json
{ "usuarioId": "...", "pin": "1234" }
```
El `pin` solo es obligatorio si ese perfil tiene uno configurado.

→ `200` `{ "token": "...", "usuario": { "id": "...", "nombre": "...", "rol": "..." } }`
→ `401` PIN incorrecto · `404` perfil no encontrado.

---

## /usuarios — personal

### `POST /usuarios` 🔒
```json
{ "nombre": "Ana", "rol": "camarero", "pin": "5678" }
```
`pin` es **opcional**: sin él, el perfil entra directo al seleccionarlo.

### `GET /usuarios` 🔒
→ `[{ "id", "nombre", "rol", "activo" }]`

### `PATCH /usuarios/:id/activo` 🔒
```json
{ "activo": false }
```
Baja lógica: el usuario desaparece de la selección de perfiles pero se conserva
en el histórico de comandas. No se puede desactivar al propio admin.

---

## /espacios — zonas y mesas

### `GET /espacios/zonas` · `GET /espacios/mesas`
Lectura abierta a cualquier rol (el camarero necesita la sala).

### `POST /espacios/zonas` 🔒 · `PUT /espacios/zonas/:id` 🔒 · `DELETE /espacios/zonas/:id` 🔒
`{ "nombre": "Terraza", "orden": 0 }`
El `DELETE` da `409` si la zona todavía tiene mesas.

### `POST /espacios/mesas` 🔒
`{ "zonaId": "...", "nombre": "T1", "capacidad": 4 }`

### `POST /espacios/mesas/lote` 🔒
Crear muchas mesas de golpe.

```json
{ "zonaId": "...", "prefijo": "T", "cantidad": 12, "desde": 1, "capacidad": 4 }
```
→ `201` `{ "creadas": ["T1", …, "T12"], "omitidas": [] }`

`prefijo` es opcional (sin él las mesas son `1`, `2`, `3`…). Las que ya existan
se devuelven en `omitidas` en lugar de duplicarse o fallar.

**Los nombres son únicos por zona, no por restaurante**: puede haber una mesa
`1` en Sala y otra `1` en Terraza.

### `PUT /espacios/mesas/:id` 🔒 · `DELETE /espacios/mesas/:id` 🔒
El `DELETE` da `409` si la mesa tiene comanda abierta, y también si aparece en
comandas históricas (en ese caso hay que renombrarla, no borrarla, para no
romper el histórico).

---

## /carta — menús, categorías y productos

Las categorías forman un **árbol**: `categoria_padre_id` apunta a la categoría
superior o es `null` en la raíz. Hay protección anti-ciclos al reasignar padres.

### `GET /carta/completa`
El endpoint que usa la PWA al arrancar: devuelve todo de una vez para poder
funcionar offline.

→ `{ "menus": [...], "categorias": [...], "productos": [...] }`

### Menús: `GET/POST /carta/menus`, `PUT/DELETE /carta/menus/:id` 🔒
### Categorías: `POST /carta/categorias` 🔒, `PUT/DELETE /carta/categorias/:id` 🔒
```json
{ "menuId": "...", "categoriaPadreId": null, "nombre": "Bebidas", "orden": 0 }
```
También: `GET /carta/menus/:menuId/categorias`

### Productos: `POST /carta/productos` 🔒, `PUT/DELETE /carta/productos/:id` 🔒
```json
{ "categoriaId": "...", "nombre": "Caña", "precio": 2.00, "tipoIva": 21 }
```
`precio` es **con IVA incluido** (así se muestra en carta, como exige la
normativa de cara al consumidor). `tipoIva` admite `0`, `4`, `10` o `21`; por
defecto `10`. En hostelería: 10 % comida y refrescos, 21 % alcohol.

También: `GET /carta/categorias/:categoriaId/productos`

### `PATCH /carta/productos/:id/disponibilidad`
```json
{ "disponible": false }
```
**Sin 🔒 a propósito:** marcar algo como agotado lo hace el camarero desde el
móvil en plena hora punta, no el admin desde el PC.

---

## /destinos — impresoras y pantallas

Un "destino" (`punto_destino`) es donde acaba una comanda: una impresora térmica,
una pantalla de cocina, o la impresora de tickets de caja.

### `GET /destinos`
→ `[{ "id", "nombre", "tipo", "protocolo", "config", "estado_salud" }]`

- `tipo`: `impresora_termica` | `pantalla_kds` | `impresora_ticket`
- `protocolo`: `escpos_red` | `escpos_usb` | `websocket_kds`
- `estado_salud`: `ok` | `caido` | `desconocido` (lo actualiza el printer-worker)

### `POST /destinos` 🔒 · `PUT /destinos/:id` 🔒 · `DELETE /destinos/:id` 🔒
```json
{
  "nombre": "Cocina",
  "tipo": "impresora_termica",
  "protocolo": "escpos_red",
  "config": { "ip": "192.168.1.50", "puerto": 9100 }
}
```
La forma de `config` depende del protocolo:

| Protocolo | config |
|---|---|
| `escpos_red` | `{ "ip": "192.168.1.50", "puerto": 9100 }` |
| `escpos_usb` | `{ "rutaDispositivo": "/dev/usb/lp0" }` |
| `websocket_kds` | `{ "canal": "cocina-fria" }` |

### Enrutado producto → impresora
- `POST /destinos/categorias/:categoriaId/asignar` 🔒 — `{ "puntoDestinoId": "..." }`
- `DELETE /destinos/categorias/:categoriaId/asignar/:puntoDestinoId` 🔒
- `POST /destinos/productos/:productoId/asignar` 🔒 — `{ "puntoDestinoId": "..." }`
- `DELETE /destinos/productos/:productoId/asignar/:puntoDestinoId` 🔒

Un producto o categoría puede tener **varios** destinos (los `INSERT` son
`INSERT OR IGNORE`, así que asignar dos veces no duplica). No se puede borrar un
destino que esté asignado a algo: da `409`.

La resolución es **en cascada**: destino del producto → destino de su categoría →
destino de la categoría padre → … Si no encuentra ninguno, la línea se guarda
igual pero se avisa (ver `alerta:producto_sin_destino`).

**Herencia:** basta asignar una categoria raiz para que todo lo que cuelgue de
ella lo herede. "Bebidas -> Barra" hace que Refrescos, Cervezas y Vinos impriman
en barra sin configurar nada mas. Un destino asignado directamente a un producto
gana sobre el heredado.

**Las impresoras de tipo `impresora_ticket` NO pueden recibir productos.** Son la
caja: solo imprimen el comprobante de pago. Intentar asignarles una categoria o
un producto devuelve `400` con una explicacion. Y por si quedara una asignacion
antigua en la base de datos, la cascada tambien las ignora: el producto sale como
"sin destino" para que el admin lo vea, en lugar de mandar la comanda a un sitio
donde nadie la va a leer.

### `GET /destinos/mapa` 🔒
Que impresora tiene cada categoria y cada producto, distinguiendo lo asignado a
mano de lo heredado. Es lo que pinta el enrutado en la vista Carta.

-> `{ "categorias": { "<id>": "Barra" },
     "productos": { "<id>": { "propio": null, "resuelto": "Barra", "heredado": true } } }`

### `GET /destinos/sin-destino` 🔒
Auditoría: productos que no imprimirían en ninguna parte. Es lo que alimenta el
aviso «sin impresora» de la vista Carta.

### `GET /destinos/incidencias` 🔒
Tickets que agotaron los reintentos (`estado = 'error_definitivo'`).

### `POST /destinos/incidencias/:logId/reintentar`
Devuelve el ticket a la cola (`estado = 'pendiente'`, `intentos = 0`). El worker
lo recoge en menos de 2 segundos.

---

## /comandas — comandas y rondas

Una **comanda** es la cuenta de una mesa (o un pedido para llevar). Una **ronda**
es cada envío a cocina dentro de esa comanda: una mesa puede pedir cinco veces y
todo se acumula en la misma comanda.

### `POST /comandas`
```json
{ "id": "uuid-generado-en-el-cliente", "turnoId": "...", "mesaId": "...", "tipo": "mesa" }
```
- `id` es **opcional pero recomendado**: el cliente lo genera para que la
  operación sea idempotente y funcione offline.
- `tipo`: `mesa` | `llevar` | `domicilio`. Con `llevar`, `mesaId` va a `null`.
- Estados posibles de una comanda: `abierta`, `en_cocina`, `servida`, `cerrada`,
  `cancelada` (los tres primeros cuentan como "viva").

→ `201` `{ "id", "tipo", "mesaId", "estado": "abierta" }`
→ `200` `{ "id": "<comanda existente>", "yaAbiertaPor": "...", "mensaje": "..." }`
  si la mesa **ya tenía** una comanda abierta. **El cliente debe adoptar ese
  `id`**, no seguir con el suyo.
→ `404` si el turno o la mesa no existen (se valida antes de insertar para no
  reventar con un error de clave ajena).

**La mesa NO se marca ocupada aquí**, sino al enviar la primera ronda: entrar en
una mesa por error y salir sin pedir la deja libre.

### `GET /comandas/abiertas`
Todas las comandas vivas con su total. Es lo que pinta los importes y el
cronómetro en la vista de sala.

→ `[{ "id", "mesa_id", "tipo", "creado_en", "camarero", "total", "unidades" }]`

### `GET /comandas/:id`
→ `{ "comanda": {...}, "lineas": [...], "total": 42.10 }`

Las líneas llegan con el **nombre del producto ya resuelto** y sus notas, para
que la app no tenga que cruzar la carta.

### `POST /comandas/:id/rondas`
Enviar productos a cocina.

```json
{ "lineas": [ { "productoId": "...", "cantidad": 2, "notas": "Muy hecho, sin sal" } ] }
```
→ `201` `{ "rondaId", "avisosSinDestino": [], "destinos": ["..."], "impreso": true }`

**`imprimir`** (booleano, por defecto `true`) separa dos acciones distintas:
- `true` -> **guardar e imprimir**: entra en la cuenta y sale el papel en cocina.
- `false` -> **solo guardar**: entra en la cuenta pero no se imprime nada. Para
  lo que el camarero sirve el mismo (una cana de la barra) o para apuntar algo
  sin dar trabajo a cocina.

Guardar es siempre seguro; imprimir implica guardar, nunca al reves. Cada linea
admite ademas `extraIds: string[]`.

Qué hace por dentro, en una sola transacción:
1. Congela el `precio_unitario` de cada línea (snapshot histórico: si mañana
   subes el precio, los tickets viejos siguen mostrando lo que cobraste).
2. Resuelve la impresora de cada línea y la congela en `impresora_resuelta_id`.
3. Marca la mesa como ocupada.
4. Encola un ticket por cada destino implicado en `log_impresion`.

`impreso: false` significa que **no** se encoló nada: pasa con los pedidos para
llevar cuando el ajuste `imprimir_llevar` está desactivado.

Las `notas` son los comentarios y agregados del producto, y **se imprimen** para
que cocina los vea.

### `POST /comandas/:id/mover`
Mover o unir una cuenta a otra mesa.

```json
{ "mesaDestinoId": "..." }
```
→ `200` `{ "modo": "movida" | "unida", "comandaId": "...", "mesaDestino": "T4" }`

- **Mesa destino libre** → `modo: "movida"`: la comanda cambia de mesa y la de
  origen se libera.
- **Mesa destino ocupada** → `modo: "unida"`: las líneas, rondas y pagos
  parciales pasan a la comanda de destino, la de origen se marca `cancelada` y
  su mesa se libera. **`comandaId` es entonces la comanda de destino**, ojo.

Los precios y las impresoras resueltas no se recalculan: son histórico de lo ya
pedido e impreso.

---

## Cuenta y pagos

Estos dos viven en el módulo `pagos` pero se montan en la raíz, así que las
rutas quedan bajo `/comandas`.

### `GET /comandas/:comandaId/cuenta`
→ `{ "comandaId", "total": 42.10, "pagado": 0, "pendiente": 42.10 }`

### `POST /comandas/:comandaId/pagos`
```json
{
  "metodo": "tarjeta",
  "importe": 42.10,
  "propina": 0,
  "impresoraTicketId": "...",
  "empresaId": null
}
```
- `metodo`: `efectivo` | `tarjeta` | `otro`.
- Admite **pagos partidos**: varias llamadas hasta saldar la cuenta.
- Rechaza con `400` cobrar más de lo pendiente (tolera 1 céntimo de redondeo).
- `impresoraTicketId` es opcional: un pago parcial intermedio puede no imprimir.
- **`empresaId`**: si viene, además del cobro se **emite una factura completa**
  a esa empresa, con numeración correlativa y desglose de IVA.

→ `201` `{ "pagoId", "comandaCerrada": true, "pendiente": 0, "factura": {...} | null }`

Al saldar la cuenta, la comanda pasa a `cerrada` y **la mesa se libera**
automáticamente.

Si se pide factura y faltan los datos fiscales del restaurante, devuelve `400`
con un mensaje explicando qué rellenar; la factura se emite **dentro de la misma
transacción** que el pago, así que nunca puede quedar un pago sin su factura ni
al contrario.

---

## /turnos — turnos, resumen e informes

**El turno siempre está abierto.** No hay que abrirlo: si no existe ninguno,
`GET /turnos/activo` lo crea. Al cerrar uno, se abre el siguiente al instante.

### `POST /turnos` 🔒
Abrir un turno explícitamente. **Rara vez hace falta**: el turno se
autogestiona (`GET /turnos/activo` crea uno si no hay). Se mantiene por
compatibilidad y para casos excepcionales. Da error si ya hay uno abierto.

### `GET /turnos/activo`
→ `{ "id", "abierto_en" }` — accesible a cualquier rol (el móvil necesita saber
a qué turno cuelga las comandas).

### `GET /turnos` 🔒
Historial (últimos 30) con `caja_inicial` y `caja_final`.

### `PATCH /turnos/:id/caja-inicial` 🔒
```json
{ "cajaInicial": 100 }
```
Cambia la caja del turno abierto **y la guarda como fondo de caja fijo**: todos
los turnos siguientes nacerán con ese valor. No se arrastra nunca lo contado al
cerrar; solo cambia aquí, a mano. Da `409` si el turno ya está cerrado.

### `POST /turnos/:id/cerrar` 🔒
```json
{ "cajaFinal": 250 }
```
→ `{ "id", "cajaFinal", "efectivoEsperado", "descuadre", "comandasAbiertas", "nuevoTurnoId" }`

`efectivoEsperado` = caja inicial + todo lo cobrado en efectivo.
`descuadre` = contado − esperado (positivo sobra, negativo falta).

### `GET /turnos/:id/resumen` 🔒
Todo lo que pinta la pantalla de Resumen:

```json
{
  "turno": { "id", "abierto_en", "cerrado_en", "caja_inicial" },
  "facturacion": { "total", "propinas", "numPagos", "ticketMedio" },
  "porMetodo": [{ "metodo": "efectivo", "total": 50 }],
  "comandasPorTipo": [{ "tipo": "mesa", "n": 12 }],
  "mesasSentadas": 12,
  "comandasCerradas": 14,
  "topProductos": [{ "nombre", "unidades", "importe" }],
  "porCamarero": [{ "nombre", "rol", "comandas", "mesas", "llevar", "importe" }],
  "duracionMesa": { "media": 47, "maxima": 132 }
}
```
`duracionMesa` va en minutos, desde que se abre la comanda hasta que se cobra.

### `GET /turnos/informe` 🔒
Datos agregados para el Excel.

`?desde=2026-08-01&hasta=2026-08-31&agrupacion=dia|semana|mes`

→ `{ "desde", "hasta", "agrupacion", "filas": [...], "totales": {...},
     "turnos": [...], "productos": [...], "desgloseIva": [...], "facturas": [...] }`

Agrupa por la fecha del **pago**, no del turno: es lo que cuadra con la
contabilidad (lo que entró en caja ese día). El `desgloseIva` trae base y cuota
por cada tipo, que es lo que se necesita para la declaración trimestral.

---

## /empresas — clientes con factura

### `GET /empresas`
Lectura abierta a cualquier rol: el camarero la necesita al cobrar. Admite
`?q=texto` para filtrar por razón social o NIF.

### `POST /empresas` 🔒 · `PUT /empresas/:id` 🔒
```json
{
  "razonSocial": "Construcciones Ejemplo S.L.",
  "nif": "B44444446",
  "direccion": "Av. Industria 45",
  "codigoPostal": "28040", "ciudad": "Madrid", "provincia": "Madrid", "pais": "España",
  "email": "facturas@ejemplo.com", "telefono": "600123456",
  "personaContacto": "Ana Pérez", "notas": "Comen los jueves"
}
```
`razonSocial`, `nif` y `direccion` son obligatorios: sin ellos la factura no es
válida y el cliente no puede deducir el IVA.

**El NIF se valida de verdad**, comprobando el dígito de control (DNI, NIE y
CIF). Un NIF con dígito incorrecto se rechaza con `400`, porque una factura con
NIF erróneo no le sirve para nada al cliente. Duplicados → `409`.

### `DELETE /empresas/:id` 🔒
**Baja lógica** (`activo = 0`), nunca borrado: las facturas emitidas apuntan a
esta empresa y hay que conservarlas un mínimo de 4 años.

### `GET /empresas/:id/facturas` 🔒
Historial de facturas de esa empresa, lo típico que piden a fin de mes.

---

## /ajustes — configuración

### `GET /ajustes`
Lectura abierta (la PWA necesita saber cómo comportarse).

### `PUT /ajustes` 🔒
```json
{ "clave": "imprimir_llevar", "valor": "false" }
```

Claves usadas:

| Clave | Por defecto | Qué hace |
|---|---|---|
| `imprimir_llevar` | `"true"` | Si es `"false"`, los pedidos para llevar se registran y cuentan para caja y estadísticas, pero **no se imprimen** |
| `caja_inicial_fija` | `"0"` | Fondo de caja con el que nace cada turno |
| `fiscal_razon_social` | `""` | Emisor de las facturas |
| `fiscal_nif` | `""` | Emisor |
| `fiscal_direccion` | `""` | Emisor |
| `fiscal_serie` | `"FAC"` | Serie de numeración de facturas |

Sin los tres campos `fiscal_*` no se pueden emitir facturas (los tickets
normales siguen funcionando con normalidad).

---

## /salud

Sin autenticación, para monitorización y para que los scripts sepan cuándo el
backend está listo.

→ `{ "ok": true, "restauranteId": "restaurante-demo", "hora": "2026-08-04T..." }`

---

## Eventos WebSocket

Socket.IO en el mismo puerto. Los clientes entran en la sala del restaurante y
reciben:

| Evento | Emisor | Contenido |
|---|---|---|
| `ronda:creada` | backend | Nueva ronda enviada a cocina |
| `mesa:liberada` | backend | `{ mesaId }` — al cobrar o al mover |
| `comanda:movida` | backend | `{ comandaId, mesaDestinoId, modo }` |
| `pago:registrado` | backend | `{ comandaId, pagoId, importe, comandaCerrada }` |
| `producto:disponibilidad` | backend | Un producto se agotó o volvió |
| `alerta:producto_sin_destino` | backend | Se pidió algo que no imprime en ninguna parte |
| `impresion:ok` / `impresion:fallida` | backend | Retransmite lo que informa el worker |
| `destino:salud` | backend | Cambio de estado de una impresora |
| `kds:nuevo_ticket` | backend | Ticket para una pantalla de cocina |

El printer-worker se conecta como cliente y emite `worker:impresion_ok`,
`worker:impresion_fallida`, `worker:salud_destino` y `worker:kds_ticket`, que el
backend traduce a los eventos de arriba para el resto de clientes.

La PWA escucha `ronda:creada`, `mesa:liberada`, `producto:disponibilidad` e
`impresion:fallida`.
