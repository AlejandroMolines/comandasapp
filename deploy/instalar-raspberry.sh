#!/usr/bin/env bash
# Deja el Raspberry arrancando solo el servicio, sin login y sin internet.
# No descarga nada: Node, pnpm install y pnpm -r build tienen que estar hechos.
#
#   sudo bash deploy/instalar-raspberry.sh
#
# Opcional: DESTINO_BACKUP=/media/usb/comandas si hay un USB montado.
set -euo pipefail

RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
DESTINO_BACKUP="${DESTINO_BACKUP:-/var/backups/comandas}"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Hay que ejecutarlo con sudo para copiar las unidades de systemd."
  echo "  sudo bash deploy/instalar-raspberry.sh"
  exit 1
fi

if [[ ! -f "$RAIZ/apps/raspberry-backend/dist/server.js" ]]; then
  echo "Falta la build. Desde la raíz del repo, sin depender de la red si"
  echo "node_modules ya está instalado:"
  echo "  pnpm -r build"
  echo "  cp apps/raspberry-backend/src/db/schema.sql apps/raspberry-backend/dist/db/"
  exit 1
fi

install -d -m 0750 /var/lib/comandas
install -d -m 0750 "$DESTINO_BACKUP"
if [[ ! -f /var/lib/comandas/local.sqlite ]]; then
  echo "La base vivirá en /var/lib/comandas/local.sqlite (mejor en SSD que en la SD)."
fi

for unidad in comandas-backend.service comandas-worker.service comandas-backup.service comandas-backup.timer; do
  sed "s|/opt/comandas|$RAIZ|g; s|/var/backups/comandas|$DESTINO_BACKUP|g" \
    "$RAIZ/deploy/$unidad" > "/etc/systemd/system/$unidad"
done

systemctl daemon-reload
systemctl enable --now comandas-backend.service comandas-worker.service
systemctl enable --now comandas-backup.timer

echo
echo "Servicios activos. La app queda en http://<ip-de-esta-maquina>:3000"
echo "Copia de seguridad cada noche (04:30) en $DESTINO_BACKUP"
echo "Si hay un USB, vuélvelo a lanzar con DESTINO_BACKUP=/media/usb/comandas"
echo
echo "Recomendado en el mismo Raspberry, sin tocar el código:"
echo "  · Arrancar desde SSD USB, no desde la SD (la SD es lo que se corrompe)."
echo "  · Journal en RAM: Storage=volatile en /etc/systemd/journald.conf"
echo "  · SAI pequeño: un corte de luz a media escritura es el otro modo de perder la caja."
echo "  · El propio Pi como punto de acceso WiFi: bash scripts/punto-acceso.sh"
