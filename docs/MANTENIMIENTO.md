# Mantenimiento en el Raspberry

El servicio tiene que seguir con el local abierto aunque se caiga internet.
Eso se consigue dejando **todo en la máquina del bar**: base de datos, app e
impresión. Este documento es cómo no perderlo el día que falle el hardware.

El script ya hace la copia y la purga de la cola de impresión:

```bash
cd apps/raspberry-backend
DB_PATH=/var/lib/comandas/local.sqlite DESTINO_BACKUP=/var/backups/comandas \
  node scripts/mantenimiento.mjs
```

Usa el backup de SQLite (coherente aunque haya camareros cobrando), comprueba
`integrity_check`, copia también `token.secret` (la clave de las sesiones) y
borra las copias de más de 30 días. La facturación no se purga.

## Arranque solo, sin que nadie inicie sesión

Con la build hecha (`pnpm -r build` y el `schema.sql` copiado a `dist/db/`):

```bash
sudo bash deploy/instalar-raspberry.sh
```

Instala cuatro unidades de systemd:

| Unidad | Qué hace |
|---|---|
| `comandas-backend.service` | API + PWA en el puerto 3000 |
| `comandas-worker.service` | Impresión |
| `comandas-backup.service` | Una pasada del script de copia |
| `comandas-backup.timer` | Esa pasada cada noche a las 04:30, y al encender si el Pi estaba apagado |

Si hay un USB para las copias:

```bash
sudo DESTINO_BACKUP=/media/usb/comandas bash deploy/instalar-raspberry.sh
```

## Qué hacer con el hardware

- **SSD por USB, no la SD, para el sistema y para `/var/lib/comandas`.** La
  tarjeta se corrompe con los cortes de luz y con la escritura constante de
  SQLite. La SD puede quedar solo como rescate, clonada y guardada en un cajón.
- **SAI pequeño** en la misma regleta que el Pi y las impresoras. Un corte a
  mitad de una escritura es el otro modo típico de perder la caja del día.
- **No alimentar el Pi desde un USB del PC.** Se queda corto de corriente y,
  al apagar el PC, la base se cierra en seco.
- **Journal de systemd en RAM** (`Storage=volatile` en
  `/etc/systemd/journald.conf`). Los logs no son la facturación; la facturación
  está en la base. Así la SD o el SSD no se gastan en texto de diagnóstico.
- **IP fija o reserva DHCP.** Si el router le cambia la IP, los móviles dejan
  de encontrar el servidor.
- **Mejor: que el Pi sea el punto de acceso WiFi** (`scripts/punto-acceso.sh`).
  Si el router de la calle muere, la sala sigue hablando con el Pi y las
  comandas se siguen imprimiendo. Hace falta internet cero.

## Restaurar

1. Parar backend y worker.
2. Sustituir `local.sqlite` por la copia del día (no hace falta el `-wal`).
3. Copiar el `token-AAAA-MM-DD.secret` del mismo día a `token.secret` junto a
   la base, si se quiere que las sesiones abiertas sigan valiendo.
4. Arrancar los dos servicios.

Comprobar la copia a mano:

```bash
sqlite3 /var/backups/comandas/comandas-AAAA-MM-DD.sqlite "PRAGMA integrity_check;"
```
