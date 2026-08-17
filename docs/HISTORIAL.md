# Historial de tickets, retención y mantenimiento

## Cuánto se guarda, y por qué esos límites

La intuición dice «no puedo guardar tickets para siempre, ocuparán muchísimo».
Los números dicen otra cosa. Para un restaurante con **mucha** actividad
(120 comandas al día, 5 líneas por comanda):

| Qué | Al año | 5 años |
|---|---|---|
| Datos de negocio (comandas, líneas, pagos, rondas) | **57 MB** | **286 MB** |
| `log_impresion` (guarda los bytes de cada ticket) | **75 MB** | — |

286 MB en cinco años es **menos del 1 %** de una tarjeta de 32 GB. Borrar el
historial de ventas para ahorrar ese espacio sería tirar información valiosa a
cambio de nada.

Así que la política es:

| Dato | Retención | Motivo |
|---|---|---|
| Comandas, pagos, facturas | **5 años** | La ley obliga a 4 (prescripción fiscal); uno más de margen |
| `log_impresion` ya impreso | **7 días** | Es lo único que crece de verdad y no aporta nada pasadas unas horas |
| Reimprimir tickets | **90 días** | Límite operativo, no de espacio: más allá de tres meses no tiene sentido reimprimir un ticket |
| Consulta en la app | Sin límite, paginada de 50 en 50 | El filtro por fechas evita cargar años de golpe |

**Por qué se puede borrar la cola de impresión sin miedo:** guarda el contenido
del ticket ya generado. Si se imprimió bien, ese contenido se puede reconstruir
en cualquier momento desde la comanda, que sí se conserva. Es caché, no dato.

## La sección Historial

En **Panel → Historial**. Cada ticket muestra:

- Número correlativo y fecha
- Mesa y zona, o etiqueta «llevar»
- Camarero
- **Hora de apertura y de cobro, y los minutos que estuvo ocupada**
- Unidades e importe, con el método de pago
- Si generó factura a empresa, con el nombre del cliente

Filtros: rango de fechas (con atajos a hoy, ayer, últimos 7 días y este mes),
búsqueda libre por número de ticket, mesa, camarero o cliente, filtro por método
de pago, y un botón para ver solo las facturas.

Al tocar un ticket se abre el detalle con el ticket **tal como se imprimió**
(productos, extras, notas, desglose de IVA y total), los pagos si la cuenta se
partió, los datos de la factura si la hubo, y cuántas veces se ha reimpreso.

## Reimpresión: la parte legal

Un mismo número de factura **no puede circular dos veces como original**. Por eso
toda reimpresión sale marcada:

```
      BAR LA ESQUINA S.L.
   Calle Mayor 1, Madrid
        NIF: B98765431
--------------------------------
      *** COPIA ***
     (no es el original)
FACTURA SIMPLIFICADA
SIM-2026/00001
...
```

La marca la pone el worker leyendo el campo `es_copia` de la cola de impresión,
que se activa solo en las reimpresiones. El número, la fecha y los importes son
los del ticket original: no se emite nada nuevo, se reproduce lo que ya existía.

Cada reimpresión queda registrada, y el detalle del ticket avisa de cuántas veces
se ha hecho.

## Mantenimiento automático

`apps/raspberry-backend/scripts/mantenimiento.mjs` hace dos cosas cada noche:

**1. Backup de la base de datos.** Este es el riesgo real del sistema: el día que
muera la tarjeta SD se pierde el histórico. Usa el comando `.backup` de SQLite,
no una copia del archivo, porque **copiar el archivo a mano puede dar una base de
datos corrupta** si pilla una transacción a medias. Rota los últimos 30.

**2. Purga de la cola de impresión** de más de 7 días, y `VACUUM` para recuperar
el espacio — solo si se borró algo, porque reescribe el archivo entero y en una
tarjeta SD eso es desgaste que no conviene provocar a diario sin motivo.

### Instalarlo como tarea nocturna

Dos archivos en `/etc/systemd/system/`:

`comandas-mantenimiento.service`
```ini
[Unit]
Description=Mantenimiento de comandas (backup y purga)

[Service]
Type=oneshot
User=pi
WorkingDirectory=/home/pi/comandas-app/apps/raspberry-backend
Environment=DESTINO_BACKUP=/media/usb/backups
ExecStart=/usr/bin/node scripts/mantenimiento.mjs
```

`comandas-mantenimiento.timer`
```ini
[Unit]
Description=Mantenimiento nocturno de comandas

[Timer]
OnCalendar=*-*-* 05:00:00
Persistent=true

[Install]
WantedBy=timers.target
```

```bash
sudo systemctl enable --now comandas-mantenimiento.timer
systemctl list-timers comandas-mantenimiento    # comprobar cuándo toca
```

**Las 5 de la mañana a propósito**: el bar está cerrado, no hay comandas abiertas
y el `VACUUM` puede bloquear la base de datos unos segundos.

`Persistent=true` importa: si el Raspberry estaba apagado a esa hora, la tarea se
ejecuta en el siguiente arranque en lugar de saltarse el día.

**Guarda los backups en un USB** (`DESTINO_BACKUP=/media/usb/backups`), no en la
propia tarjeta SD. Un backup en el mismo disco que puede morir no es un backup.

## Desde la app

La sección Historial incluye un bloque de **Almacenamiento** que muestra cuántos
tickets, facturas y comandas hay, el ticket más antiguo, y cuántos registros de
impresión se podrían limpiar, con un botón para hacerlo a mano. Útil para ver el
estado sin entrar por SSH.

## API

| Endpoint | Qué hace |
|---|---|
| `GET /historial` 🔒 | Listado con filtros y paginación |
| `GET /historial/:pagoId` 🔒 | Detalle completo del ticket |
| `POST /historial/:pagoId/reimprimir` 🔒 | Reimprime marcado como COPIA |
| `GET /historial/mantenimiento/estado` 🔒 | Ocupación y qué se podría purgar |
| `POST /historial/mantenimiento/purgar` 🔒 | Purga la cola de impresión |

Parámetros del listado: `desde`, `hasta`, `q`, `metodo`, `soloFacturas`,
`limite` (máx. 200), `offset`.

## Verificado en pruebas reales

- Tres tickets generados y listados con su número, mesa, unidades, importe,
  método y los minutos de entrada a salida.
- Filtro por método: 1 de 3 con tarjeta.
- Detalle con extras («Extra queso» sobre el Menú, línea a 16,50 €), desglose de
  IVA correcto (10 %: base 15,00 + 1,50 · 21 %: base 4,13 + 0,87) y total 21,50 €.
- Reimpresión: el papel sale con `*** COPIA ***` y `(no es el original)`,
  conservando número, fecha e importes del original.
- Mantenimiento: backup consistente creado y estado reportado.
