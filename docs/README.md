# Documentación · sistema de comandas

## Índice

| Documento | Contenido |
|---|---|
| [ARQUITECTURA.md](./ARQUITECTURA.md) | Visión de conjunto, decisiones de diseño y despliegue |
| [PUNTO-ACCESO.md](./PUNTO-ACCESO.md) | Red del local: el Raspberry como punto de acceso WiFi |
| [API.md](./API.md) | Todos los endpoints del backend y eventos WebSocket |
| [TICKETS.md](./TICKETS.md) | Formato legal del ticket y numeración |
| [EXTRAS.md](./EXTRAS.md) | Extras y modificaciones de productos |
| [HISTORIAL.md](./HISTORIAL.md) | Historial de tickets, retencion y mantenimiento |
| [raspberry-backend.md](./raspberry-backend.md) | El backend: módulos, base de datos, logs |
| [printer-worker.md](./printer-worker.md) | El worker de impresión: drivers, reintentos, ESC/POS |
| [pwa-camarero.md](./pwa-camarero.md) | La app: diseño, offline-first, service worker |
| [MODELO-DATOS.md](./MODELO-DATOS.md) | Las tablas y por qué están así |
| [../FACTURACION.md](../FACTURACION.md) | Facturas a empresas, IVA y Verifactu |
| [../CAJA-E-INFORMES.md](../CAJA-E-INFORMES.md) | Caja inicial fija e informes en Excel |

## Qué es esto en dos párrafos

Un sistema de comandas para restaurantes. Los camareros toman nota desde el móvil,
las comandas salen impresas en cocina y barra, y se cobra desde el mismo sitio.
El admin gestiona la carta, la sala, el personal y ve las estadísticas del
servicio.

La pieza central es un **Raspberry Pi por restaurante** que hace de servidor
local. Todo funciona en la red WiFi del local **sin depender de internet**: si se
cae la línea, el bar sigue trabajando exactamente igual. Los móviles y el PC son
solo navegadores; no hay nada que instalar en ellos.

## Los tres paquetes

```
comandas-app/
├── apps/
│   ├── raspberry-backend/   API + SQLite + sirve la PWA        (Node, :3000)
│   ├── printer-worker/      Cola de impresión → impresoras     (Node, sin puerto)
│   └── pwa-camarero/        La app (camarero y admin)          (React, :5173 en dev)
├── packages/
│   └── shared-types/        Tipos TypeScript compartidos
├── scripts/dev.mjs          Arranca todo de una vez
└── docs/
```

Monorepo con **pnpm workspaces**. Node 22 (fijado en `.nvmrc`: Node 26 rompe
`better-sqlite3` y Node 20 es demasiado viejo para el pnpm actual).

## Arrancar en 30 segundos

```bash
nvm use 22
pnpm install
pnpm start:all --fake      # --fake levanta una impresora simulada
```

El script compila la PWA, arranca el backend, crea el admin si no existe, lanza
el worker y Vite, y te dice por qué URL entrar (incluida la de tu móvil).

Login: **admin@demo.com / admin** → perfil **Admin** → PIN **1234**

Desde el móvil, en la misma WiFi: `http://<ip-que-indica-el-script>:3000`

## Primeros pasos dentro de la app

Recién instalado no hay nada configurado. En el panel admin:

1. **Salas** → crea una zona y sus mesas (hay alta en lote: prefijo + cantidad).
2. **Carta** → un menú, dentro categorías, dentro productos con su precio e IVA.
3. **Impresoras** → añade al menos una. Para probar sin hardware: red,
   `127.0.0.1`, puerto `9100` (la impresora simulada de `--fake`).
4. **Carta** → en cada categoría, el icono de impresora para decir dónde imprime.
5. **Personal** → crea camareros (el PIN es opcional).
6. **Turnos** → pon el fondo de caja fijo.

El turno ya está abierto: no hay que abrirlo nunca.

## Estado del proyecto

**Funcionando y probado:** todo el flujo de servicio (comandas, rondas, notas para
cocina, mover y unir mesas, cobros con método de pago, pagos partidos, cierre de
caja con descuadre), la carta como árbol con buscador, facturación a empresas con
IVA desglosado, informes en Excel, modo claro/oscuro, y funcionamiento offline.

**Pendiente, por orden de importancia práctica:**

1. **Backup automático de la base de datos.** Es el riesgo real: el día que muera
   la tarjeta SD se pierde el histórico. Barato de hacer y no está.
2. **Seguridad para producción**: JWT firmado y bcrypt. Ahora el token es base64
   sin firma y las contraseñas van en claro. Aceptable en LAN cerrada, no si se
   expone.
3. **Verifactu** (obligatorio en 2027): hash encadenado, QR y registro de eventos.
   Ver [FACTURACION.md](../FACTURACION.md).
4. **KDS**: la pantalla de cocina. El driver del worker ya existe.
5. **Cloud**: sincronización multi-restaurante. La tabla `eventos_sync` está
   preparada pero vacía. No hace falta hasta tener varios locales.
