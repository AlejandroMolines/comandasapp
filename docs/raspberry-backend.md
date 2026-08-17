# raspberry-backend

El cerebro del restaurante. Corre en el Raspberry Pi y es **autónomo**: si se cae
internet, el bar sigue trabajando al 100 % — comandas, impresión, cobros y cierre
de caja son todos locales.

- **Stack:** Node 22 · Express 4 · better-sqlite3 · Socket.IO · Zod
- **Puerto:** 3000
- **Qué hace:** expone la API, guarda todo en SQLite, y **sirve también la PWA
  compilada** desde `../pwa-camarero/dist`. Un solo puerto para todo.

Para el detalle de cada endpoint: [API.md](./API.md).

## Estructura

```
src/
  server.ts              Express, Socket.IO, montaje de routers, manejador global de errores
  db/
    connection.ts        Abre SQLite, activa WAL, aplica el schema
    schema.sql           Todas las tablas (se ejecuta al arrancar, es idempotente)
  middleware/
    auth.ts              requireAuth / requireRole, firmarToken
  modules/
    auth/                Login de restaurante, perfiles, entrada por PIN
    usuarios/            Personal
    espacios/            Zonas y mesas (incluido el alta en lote)
    carta/               Menús, categorías (árbol), productos
    destinos/            Impresoras y pantallas, enrutado producto→impresora
    comandas/            routes.ts + service.ts (crearRonda)
    pagos/               Cuenta y cobros
    turnos/              Turnos, resumen del servicio, informes
    empresas/            Clientes con factura, validación de NIF
    facturas/            service.ts: numeración correlativa y desglose de IVA
    ajustes/             Configuración clave/valor
scripts/
  bootstrap-admin.mjs    Crea el restaurante demo y el perfil Admin (idempotente)
```

## La base de datos

Un solo archivo: `data/local.sqlite`. Verás tres ficheros porque está en **modo
WAL** (`local.sqlite`, `-wal`, `-shm`); los tres son la base de datos.

**Por qué WAL, que es la decisión más importante aquí:** en modo normal SQLite
escribe directamente sobre el archivo de datos, así que un corte de luz a mitad
de una escritura lo corrompe. Con WAL las escrituras van primero a un archivo
aparte y solo se consolidan cuando están completas. Si se va la luz a media
comanda, al arrancar SQLite descarta lo incompleto y el archivo principal sigue
íntegro: pierdes la última comanda, no la base de datos entera. Además permite
varios lectores mientras uno escribe, que con cuatro camareros pidiendo a la vez
y el worker leyendo la cola de impresión importa.

**Tamaño:** irrisorio. Unos pocos megas al año para un restaurante normal.

### Tablas

| Tabla | Para qué |
|---|---|
| `restaurantes` | Credenciales de acceso (email + contraseña) |
| `usuarios` | Personal, con `pin_hash` (`''` = sin PIN) |
| `ajustes` | Configuración clave/valor |
| `empresas` | Clientes que necesitan factura completa |
| `facturas` | Facturas emitidas, con emisor y cliente **congelados** |
| `zonas` / `mesas` | La sala. Nombres de mesa únicos **por zona** |
| `menus` / `categorias` / `productos` | La carta. `categorias` es un árbol vía `categoria_padre_id` |
| `puntos_destino` | Impresoras y pantallas |
| `producto_destino` / `categoria_destino` | Enrutado producto→impresora |
| `turnos` | Servicios, con caja inicial y final |
| `comandas` / `rondas` / `lineas_comanda` | Los pedidos |
| `pagos` | Cobros, con método |
| `log_impresion` | Cola de impresión con estado y reintentos |
| `eventos_sync` | Outbox preparado para el Cloud (todavía sin usar) |

### Decisiones de diseño que conviene entender

**Snapshot de precios.** `lineas_comanda.precio_unitario` guarda el precio del
momento de pedir, no una referencia al producto. Si mañana subes la caña, los
tickets de ayer siguen mostrando lo que cobraste de verdad. Lo mismo con
`impresora_resuelta_id`: se congela para tener trazabilidad de dónde se imprimió.

**Datos fiscales congelados en las facturas.** Cada factura guarda razón social,
NIF y dirección de emisor y cliente tal como estaban al emitirla. Un documento
fiscal no puede cambiar retroactivamente porque el bar se mude.

**`restaurante_id` en todas las tablas desde el día uno.** Este Raspberry sirve
a un solo restaurante, pero el modelo es idéntico al que necesitará el Cloud
multi-tenant. Migrar luego sería un infierno; ponerlo ahora es gratis.

**Turno perpetuo.** Nunca hay un momento «sin turno»: si no existe uno abierto,
se crea al pedirlo. Un camarero no puede quedarse bloqueado porque el jefe no
haya abierto caja.

## Arrancar

```bash
# Desarrollo (con recarga automática)
pnpm --filter raspberry-backend dev

# Producción
pnpm --filter raspberry-backend build
cp src/db/schema.sql dist/db/          # el schema no lo copia tsc
cd apps/raspberry-backend && node dist/server.js
```

Al arrancar debe aparecer:

```
[db] SQLite lista en .../data/local.sqlite
[raspberry-backend] sirviendo PWA desde .../apps/pwa-camarero/dist
[raspberry-backend] escuchando en http://localhost:3000
```

Si falta la línea de «sirviendo PWA», el `:3000` responderá `Cannot GET /`: es
que no encuentra la carpeta `dist` de la PWA (hay que compilarla).

**El primer arranque necesita el bootstrap** para crear el restaurante y el
admin:

```bash
cd apps/raspberry-backend && node scripts/bootstrap-admin.mjs
# -> admin@demo.com / admin, perfil Admin con PIN 1234
```

Es idempotente: si ya existen, no hace nada.

## Variables de entorno

| Variable | Por defecto | Para qué |
|---|---|---|
| `PORT` | `3000` | Puerto |
| `RESTAURANTE_ID` | `restaurante-demo` | Tenant que sirve esta instancia |
| `DB_PATH` | `data/local.sqlite` | Ruta de la base de datos |

## Logs

Ahora mismo solo `console.log`, así que en producción los recoge systemd
(`journalctl -u comandas-backend -f`).

**Cuidado con esto en el Raspberry:** cada línea de log es una escritura en la
tarjeta SD, y las SD mueren por desgaste de escritura. Recomendado poner el
journal en RAM en `/etc/systemd/journald.conf`:

```
Storage=volatile
RuntimeMaxUse=32M
```

Los logs se pierden al reiniciar, y está bien: **lo que de verdad importa no vive
en los logs, vive en la base de datos**. Los tickets fallidos están en
`log_impresion` con su error, los cobros en `pagos`, los cierres en `turnos`.
Los logs de texto son para diagnosticar por qué algo no arranca; la BD es para
responder preguntas de negocio.

## Consultas útiles a mano

```bash
sqlite3 apps/raspberry-backend/data/local.sqlite

-- facturación de hoy
SELECT SUM(importe) FROM pagos WHERE date(creado_en) = date('now');

-- estado de la cola de impresión
SELECT estado, COUNT(*) FROM log_impresion GROUP BY estado;

-- mesas ocupadas ahora
SELECT m.nombre, c.creado_en FROM comandas c JOIN mesas m ON m.id = c.mesa_id
 WHERE c.estado = 'abierta';
```

## Pendiente

- **Seguridad:** JWT firmado en vez de base64 sin firma, y bcrypt para PIN y
  contraseña. Marcado con `TODO` en el código. Imprescindible antes de exponer
  nada fuera de la LAN.
- **Backup automático** de la BD. Es el riesgo real del sistema. La forma
  correcta con SQLite no es copiar el archivo (puede estar a media escritura)
  sino `sqlite3 local.sqlite ".backup /media/usb/comandas-$(date +%F).sqlite"`,
  que es consistente aunque la BD esté en uso. Con un temporizador de systemd
  de madrugada y rotación de 30 días.
- **Limpieza de `log_impresion`**: crece indefinidamente y guarda los bytes de
  cada ticket. Conviene borrar lo que está en `ok` de hace más de una semana. Los
  datos de negocio (`comandas`, `pagos`, `facturas`) **no se tocan nunca**.
- **Sync con el Cloud**: la tabla `eventos_sync` está creada pero no se rellena.
- **Idempotencia de rondas**: aceptar un `rondaId` del cliente, como ya se hace
  con el `id` de comanda.
