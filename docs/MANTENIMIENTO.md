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

## Instalar en un Raspberry nuevo

Usa Raspberry Pi OS de 64 bits con conexión a internet durante la instalación.
Desde la terminal del Raspberry, ejecuta:

```bash
curl -fsSL https://raw.githubusercontent.com/AlejandroMolines/comandasapp/main/deploy/instalar-raspberry.sh | sudo bash
```

El asistente instala Node 22 y pnpm, compila la aplicación, configura HTTPS,
crea un usuario de sistema sin permisos de administrador, inicializa una base
vacía y te pide el nombre, email, contraseña y PIN del administrador. La
contraseña debe tener al menos 16 caracteres. No se cargan mesas, carta ni
datos de demostración: se configuran desde la aplicación.

La aplicación queda en `/opt/comandas`; la base y el secreto de sesión viven en
`/var/lib/comandas`; la configuración privada está en `/etc/comandas`. Las
credenciales no se guardan en el repositorio ni en la configuración de systemd.
La copia nocturna queda en `/var/backups/comandas`.

### Primer acceso

Abre `https://raspberry.local:3000` desde un dispositivo conectado a la WiFi del
local. Si ese nombre no resuelve, usa la IP que imprime el instalador, por
ejemplo `https://192.168.1.25:3000`.

El instalador crea una autoridad certificadora local en
`/etc/comandas/tls/ca.pem`. Para evitar la advertencia del navegador y permitir
la instalación de la PWA, copia ese archivo a cada dispositivo y añádelo como
certificado de confianza (en iPhone/iPad hay que instalar el perfil y habilitar
su confianza; en Android/Windows/macOS se importa en el almacén de certificados
de usuario). Después vuelve a abrir la URL por HTTPS e instala/añade Comandas a
la pantalla de inicio desde el navegador. No compartas `/etc/comandas/tls/ca-key.pem`:
esa clave privada solo debe permanecer en el Raspberry.

### Actualizar

Desde el Raspberry:

```bash
sudo bash /opt/comandas/deploy/actualizar-raspberry.sh
```

El actualizador guarda primero una copia SQLite coherente, descarga la versión
de `main`, recompila y reinicia los servicios. Conserva la base de datos, la
clave de sesión, el certificado y las credenciales. Si falla la compilación,
vuelve a la versión de código anterior.

### Servicios instalados

El instalador configura cuatro unidades de systemd:

| Unidad | Qué hace |
|---|---|
| `comandas-backend.service` | API + PWA en el puerto 3000 |
| `comandas-worker.service` | Impresión |
| `comandas-backup.service` | Una pasada del script de copia |
| `comandas-backup.timer` | Esa pasada cada noche a las 04:30, y al encender si el Pi estaba apagado |

Si prefieres guardar las copias en un USB montado, puedes especificarlo durante
la primera instalación:

```bash
curl -fsSL https://raw.githubusercontent.com/AlejandroMolines/comandasapp/main/deploy/instalar-raspberry.sh | sudo DESTINO_BACKUP=/media/usb/comandas bash
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
