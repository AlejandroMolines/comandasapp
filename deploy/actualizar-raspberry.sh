#!/usr/bin/env bash
# Actualiza la aplicación sin tocar las credenciales ni reinicializar el restaurante.
set -Eeuo pipefail

APP_DIR="${COMANDAS_DIR:-/opt/comandas}"
DESTINO_BACKUP="${DESTINO_BACKUP:-/var/backups/comandas}"
RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

[[ "$(id -u)" -eq 0 ]] || { echo "Ejecuta con sudo: sudo bash $0" >&2; exit 1; }
[[ -f /var/lib/comandas/.setup-complete ]] || { echo "No existe una instalación inicializada. Ejecuta instalar-raspberry.sh." >&2; exit 1; }
[[ -d "$APP_DIR/.git" ]] || { echo "No encuentro el repositorio en $APP_DIR/.git." >&2; exit 1; }
[[ "$RAIZ" == "$APP_DIR" ]] || { echo "Ejecuta este script desde $APP_DIR/deploy/actualizar-raspberry.sh." >&2; exit 1; }

command -v pnpm >/dev/null || npm install --global pnpm@10.33.4
git -C "$APP_DIR" fetch --depth 1 origin main
ANTERIOR="$(git -C "$APP_DIR" rev-parse HEAD)"

echo "Creando una copia de seguridad antes de actualizar…"
runuser -u comandas -- env DB_PATH=/var/lib/comandas/local.sqlite DESTINO_BACKUP="$DESTINO_BACKUP" \
  node "$APP_DIR/apps/raspberry-backend/scripts/mantenimiento.mjs"

systemctl stop comandas-worker.service comandas-backend.service || true
if ! git -C "$APP_DIR" reset --hard origin/main; then
  systemctl start comandas-backend.service comandas-worker.service
  exit 1
fi
cd "$APP_DIR"
if ! pnpm install --frozen-lockfile || ! pnpm build; then
  echo "La compilación falló; recuperando la versión anterior $ANTERIOR." >&2
  git -C "$APP_DIR" reset --hard "$ANTERIOR"
  pnpm install --frozen-lockfile && pnpm build || true
  install -D -m 0644 apps/raspberry-backend/src/db/schema.sql apps/raspberry-backend/dist/db/schema.sql || true
  systemctl start comandas-backend.service comandas-worker.service
  exit 1
fi
install -D -m 0644 apps/raspberry-backend/src/db/schema.sql apps/raspberry-backend/dist/db/schema.sql
systemctl start comandas-backend.service comandas-worker.service

for intento in {1..30}; do
  if curl --silent --show-error --insecure https://127.0.0.1:3000/salud >/dev/null 2>&1; then
    echo "Actualización completada: $(git -C "$APP_DIR" rev-parse --short HEAD)"
    exit 0
  fi
  sleep 1
done

echo "El backend no responde; recuperando la versión anterior $ANTERIOR." >&2
systemctl stop comandas-worker.service comandas-backend.service || true
git -C "$APP_DIR" reset --hard "$ANTERIOR"
pnpm install --frozen-lockfile && pnpm build || true
install -D -m 0644 apps/raspberry-backend/src/db/schema.sql apps/raspberry-backend/dist/db/schema.sql || true
systemctl start comandas-backend.service comandas-worker.service
echo "Revisa los logs: journalctl -u comandas-backend -n 100" >&2
exit 1
