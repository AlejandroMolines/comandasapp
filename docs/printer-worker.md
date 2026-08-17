# printer-worker

Proceso **separado** del backend, dedicado a una sola cosa: sacar los tickets por
las impresoras. Lee la cola `log_impresion` de la misma base de datos SQLite y va
entregando.

- **Stack:** Node 22 · better-sqlite3 · socket.io-client
- **No expone ningún puerto**: es un consumidor de cola, no un servidor.

## Por qué es un proceso aparte

Es la decisión clave de este módulo. Las impresoras térmicas son lentas y poco
fiables: se quedan sin papel, alguien las desenchufa, la red va mal. Si la
impresión viviera dentro del backend, un socket colgado esperando cinco segundos
a una impresora muerta dejaría al camarero mirando la pantalla sin poder pedir.

Separándolo: el backend solo hace un `INSERT` en la cola (microsegundos) y
responde al instante. El worker se pelea con el hardware por su cuenta. Si el
worker se cae, se pierde la impresión pero **no la comanda** — está en la base de
datos, y al volver el worker se imprime. Y si una impresora está muerta, solo
afecta a esa cola, no al resto del servicio.

## Estructura

```
src/
  worker.ts              Bucle principal, reintentos, health checks
  escpos.ts              Constructor de comandos ESC/POS
  types.ts               TicketData, DestinoDriver, PuntoDestinoRow
  drivers/
    escpos-red.ts        Impresora por IP (TCP 9100) + formato de ticket y factura
    otros.ts             escpos_usb (escribe en /dev/usb/lpX) y websocket_kds
scripts/
  impresora-fake.mjs     Impresora simulada para desarrollo
```

## Cómo funciona el bucle

1. Lee de `log_impresion` los registros en estado `pendiente`.
2. **Uno por destino a la vez** (FIFO): las comandas de una mesa salen en orden,
   nunca mezcladas ni al revés. Varios destinos sí trabajan en paralelo.
3. Construye el `TicketData` leyendo la ronda o el pago de la base de datos.
4. Se lo pasa al driver que toque según el `protocolo` del destino.
5. Si va bien: `estado = 'ok'` y avisa por WebSocket.
6. Si falla: incrementa `intentos`, guarda `ultimo_error` y **reintenta con
   backoff**.

### Reintentos

```
MAX_INTENTOS = 4
BACKOFF_MS   = [0, 2000, 5000, 15000]
```

Primer intento inmediato, luego 2 s, 5 s y 15 s. Agotados los cuatro, el ticket
pasa a `error_definitivo` y se emite una alerta que la app muestra al camarero
(«⚠ Cocina no responde — comanda sin imprimir»). Desde el panel de Impresoras se
puede pulsar **Reintentar** y vuelve a la cola.

El backoff escalonado tiene sentido práctico: la mayoría de fallos son
transitorios (un momento de red, la impresora ocupada). Reintentar al instante
mil veces solo llena el log; esperar de más deja a cocina sin la comanda.

### Health checks

Cada 30 segundos hace un `ping` ligero a cada destino (abrir y cerrar socket) y
actualiza `puntos_destino.estado_salud` a `ok` o `caido`. Es lo que pinta el
semáforo verde/rojo del panel de Impresoras, y permite enterarse de que la
impresora de cocina está apagada **antes** de la primera comanda del servicio.

## Drivers

Los tres implementan la misma interfaz (`DestinoDriver`: `enviar` y `ping`), así
que añadir un tipo de impresora nuevo no toca el bucle principal.

| Protocolo | Cómo entrega | `config` |
|---|---|---|
| `escpos_red` | Socket TCP al puerto 9100 (estándar de facto en impresoras de red) | `{ ip, puerto }` |
| `escpos_usb` | Escribe directamente en el dispositivo | `{ rutaDispositivo: "/dev/usb/lp0" }` |
| `websocket_kds` | Emite por WebSocket a una pantalla de cocina, esperando confirmación | `{ canal: "cocina-fria" }` |

El driver KDS espera un **ack** de la pantalla: sin confirmación se considera
fallo y entra en el ciclo de reintentos, igual que una impresora de papel. Una
pantalla que no ha recibido el ticket es tan grave como un papel que no salió.

## ESC/POS

`escpos.ts` implementa a mano el subconjunto que hace falta (inicializar, negrita,
tamaño doble, alineación, corte de papel). No usamos librería porque las de npm
arrastran dependencias nativas que complican el cross-compile a ARM, y solo
necesitamos una docena de comandos.

**Detalle importante:** las impresoras térmicas baratas usan la página de códigos
CP437, que no tiene acentos ni `ñ`. El builder **translitera** automáticamente
(`Jamón` → `Jamon`) para que no salgan símbolos raros en cocina. Es preferible un
ticket sin tildes que uno ilegible.

## Formatos de ticket

**Comanda de cocina** — grande y sin precios, que en cocina solo importa qué
hacer:

```
      MESA 4
   18:32 · Ana
--------------------------------
2 x Entrecot
   >> Muy hecho, sin sal
1 x Ensalada
```

**Ticket de caja** — con el **total de la cuenta completa**, no el importe del
pago (si es un pago partido, el cliente quiere ver lo que se ha consumido) y la
forma de pago.

**Factura completa** — cuando el cobro lleva `empresaId`, el papel deja de ser un
ticket y pasa a ser el documento fiscal: numeración de serie, fecha, datos de
emisor y destinatario, conceptos con importe, desglose de IVA por tipos, base,
cuota y total. Ver [FACTURACION.md](../FACTURACION.md).

## Arrancar

```bash
# Desarrollo
pnpm --filter printer-worker dev

# Producción
pnpm --filter printer-worker build
cd apps/printer-worker && node dist/worker.js
```

El worker necesita **la misma base de datos** que el backend (accede al archivo
directamente) y la URL del backend para el WebSocket.

| Variable | Por defecto |
|---|---|
| `BACKEND_URL` | `http://127.0.0.1:3000` |
| `DB_PATH` | la BD del backend |

## Probar sin impresora

```bash
node apps/printer-worker/scripts/impresora-fake.mjs
```

Levanta un servidor TCP en el 9100 que guarda lo que reciba en
`/tmp/impresora-recibido.bin`. Se da de alta un destino con `ip: 127.0.0.1` y
`puerto: 9100` y ya se puede ver el ticket:

```bash
cat /tmp/impresora-recibido.bin | tr -d '\000-\011\013-\037'
```

Con `pnpm start:all --fake` se arranca sola junto al resto del sistema.

Si sale `EADDRINUSE: 9100`, es que quedó una instancia viva de antes:
`pkill -f impresora-fake`.

## Pendiente

- **Limpieza de `log_impresion`**: la tabla crece sin límite y guarda los bytes
  de cada ticket. Borrar lo que está en `ok` de hace más de una semana.
- **Cliente KDS**: el driver `websocket_kds` está listo, pero falta la interfaz
  de pantalla de cocina que lo consuma.
