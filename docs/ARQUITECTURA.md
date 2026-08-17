# Arquitectura

## El principio que manda sobre todo

**El restaurante no puede depender de internet.** Un bar en plena hora punta con
cuatro camareros y la cocina a tope no puede pararse porque el router de la calle
tenga un problema. De ahí sale todo el diseño:

- Un **Raspberry Pi por local** que es un servidor completo y autónomo.
- Base de datos **local** (SQLite), no remota.
- La app funciona **sin red** gracias a la cola en IndexedDB.
- El Cloud (cuando exista) será para consultar y agregar, **nunca** para que el
  servicio del día funcione.

## Cómo encaja todo

```
        WiFi del local
   ┌──────────┴──────────┐
   │                     │
móviles              PC admin          ← solo navegadores, nada instalado
(camareros)         (kiosko)
   │                     │
   └──────────┬──────────┘
              │ HTTP + WebSocket
      ┌───────▼────────────────────────────┐
      │      RASPBERRY PI                  │
      │                                    │
      │  raspberry-backend  :3000          │
      │    · API REST                      │
      │    · Socket.IO (tiempo real)       │
      │    · sirve la PWA compilada        │
      │            │                       │
      │       SQLite (WAL)                 │
      │            │                       │
      │  printer-worker (proceso aparte)   │
      └───────┬────────────────────────────┘
              │ TCP :9100 / USB / WebSocket
      ┌───────┴────────┬──────────────┐
   impresora        impresora      pantalla
    cocina            barra          cocina
```

El Cloud sería una cuarta pieza, futura, recibiendo eventos del Raspberry cuando
haya internet. No existe todavía.

## Decisiones y por qué

**SQLite en vez de PostgreSQL.** Un restaurante genera unas pocas miles de filas
al día. Un Postgres en un Raspberry es peso muerto: más RAM, más cosas que
configurar, más cosas que fallar. SQLite es un archivo, y con WAL activado
soporta de sobra la concurrencia de cuatro camareros. En el Cloud sí irá Postgres,
porque ahí sí hay multi-tenant real.

**Worker de impresión separado.** Las impresoras térmicas son lentas y falibles.
Si la impresión estuviera dentro del backend, un socket colgado esperando a una
impresora muerta dejaría al camarero sin poder pedir. Así, el backend hace un
`INSERT` en la cola y responde al instante; el worker se pelea con el hardware.
Si el worker muere, se pierde la impresión pero **nunca la comanda**.

**El backend sirve la PWA.** Un solo puerto, mismo origen, cero problemas de
CORS en producción, y un solo servicio que arrancar. En desarrollo sí hay dos
(Vite en el 5173 para el hot reload).

**UUID generados en el cliente.** Permite que las operaciones sean idempotentes:
si un reintento manda la misma petición dos veces, no se duplica la comanda. Es
lo que hace posible la cola offline.

**Snapshot de precios.** Cada línea guarda el precio del momento de pedir, no una
referencia al producto. Si mañana sube la caña, los tickets de ayer siguen
mostrando lo que se cobró. Lo mismo con la impresora resuelta, para trazabilidad.

**`restaurante_id` en todo desde el día uno.** Aunque cada Raspberry sirva a un
solo local, el modelo es ya el del Cloud multi-tenant. Migrarlo después sería
carísimo; ponerlo ahora fue gratis.

**El turno siempre está abierto.** Si no hay ninguno, se crea al pedirlo. Un
camarero no puede quedarse bloqueado porque nadie haya «abierto caja». Al cerrar,
el siguiente se abre en la misma operación.

## Modelo de roles

| | Camarero | Admin |
|---|---|---|
| Tomar comandas, cobrar | ✅ | ✅ |
| Marcar productos agotados | ✅ | ✅ |
| Ver empresas (para facturar) | ✅ | ✅ |
| Mover/unir mesas | ✅ | ✅ |
| Ver el resumen y los importes del turno | ❌ | ✅ |
| Carta, salas, impresoras, personal, ajustes | ❌ | ✅ |
| Cerrar turno, informes | ❌ | ✅ |

Marcar agotado es deliberadamente de camarero: eso pasa a media hora punta y no
puede depender de que el jefe esté delante del PC.

## Hardware recomendado

**Raspberry Pi 4 de 2 GB.** La carga (Node + SQLite + WebSockets para 4
dispositivos) no roza siquiera esa máquina; el cuello de botella es la tarjeta SD,
no la CPU. La Pi 4 consume menos, calienta menos y tiene Ethernet, que para el
Raspberry y las impresoras conviene por cable. Los precios de la Pi 5 subieron
mucho en 2026 por la crisis de memoria, así que ahora mismo tampoco compensa.

**Lo que de verdad hay que presupuestar además de la placa:**

- **Cargador oficial de 5V/3A.** No un cargador de móvil reciclado: los cuelgues
  aleatorios de Raspberry son casi siempre alimentación mala.
- **Tarjeta SD de calidad A2** (SanDisk Extreme, Samsung Pro Endurance), 32 GB.
  Aquí sí hay que gastar: la SD barata es la causa número uno de muerte. **Un SSD
  por USB en vez de SD es la mejor inversión en fiabilidad de todo el proyecto**,
  porque un bar escribe constantemente y las SD no están hechas para eso.
- **Caja con disipador** (va a estar cerca de una cocina).
- **Una segunda SD clonada en un cajón.** El día que falle, cambias la tarjeta en
  dos minutos en vez de cerrar el bar.

**Un aviso importante:** no alimentes el Raspberry desde un USB del PC. Un puerto
USB da 0,5–0,9 A y la Pi 4 pide 3 A: arranca a veces, funciona un rato y se cuelga
justo en hora punta. Además, apagar el PC corta la corriente en seco sin cerrar
SQleite limpiamente. Enchúfalo a su cargador, en la misma regleta que el PC si
quieres que se enciendan juntos.

Dale **IP fija** en el router (o reserva DHCP): si el router le cambia la IP un
día, todos los móviles dejan de encontrarlo.

**Mejor aún: que el Raspberry sea su propio punto de acceso WiFi.** Así el router
deja de ser un punto único de fallo — si muere, los móviles siguen hablando con el
Raspberry y las comandas se siguen imprimiendo. Ver
[PUNTO-ACCESO.md](./PUNTO-ACCESO.md), incluye script de instalación.

## Despliegue en producción

Los servicios deben arrancar **con el sistema, sin que nadie inicie sesión**, y
reiniciarse solos si se caen. Eso es systemd, dos unidades:
`comandas-backend.service` y `comandas-worker.service`, ambas con
`Restart=always` y `WantedBy=multi-user.target`.

El **PC del admin no ejecuta nada**: es un cliente más. Lo único que se configura
ahí es que el navegador se abra en modo kiosko apuntando al Raspberry cuando el
admin inicia sesión.

Esto es importante entenderlo bien: **el sistema no debe depender del PC**. Si el
PC se estropea o Windows decide actualizarse a media tarde, los camareros siguen
trabajando con los móviles y las impresoras sin enterarse.

Ver también las notas de logs en [raspberry-backend.md](./raspberry-backend.md):
conviene poner el journal de systemd en RAM para no desgastar la SD.

## El Cloud (futuro)

No hace falta para que un restaurante funcione. Serviría para:

1. Ver la facturación de varios locales desde casa.
2. Copia de seguridad del histórico.
3. Comparar entre locales.
4. Actualizar la flota de Raspberries sin ir uno por uno.
5. Enterarse de que un Raspberry está caído antes de que llame el encargado.
6. Informes fiscales agregados.

**Recomendación:** con un solo restaurante, no montarlo. Es una cuota mensual
para resolver problemas que aún no existen. Lo que sí merece la pena ya es un
**backup automático nocturno** de la base de datos a un USB o a la nube: cubre el
90 % del riesgo real (perder los datos) sin infraestructura.

El Cloud empieza a tener sentido con 3-4 locales, o cuando se quiera vender el
sistema a otros bares — ahí un panel multi-tenant pasa de capricho a necesidad,
porque no puedes ir a casa de cada cliente a ver por qué no le imprime.
