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

diagnostico() {
  local nivel="$1" mensaje="$2" fecha
  fecha="$(date -u +%FT%TZ)"
  [[ -e /var/lib/comandas/central-diagnosticos.log ]] || install -o root -g comandas -m 0640 /dev/null /var/lib/comandas/central-diagnosticos.log
  printf '%s\t%s\t%s\n' "$fecha" "$nivel" "${mensaje//$'\n'/ }" >> /var/lib/comandas/central-diagnosticos.log
  local temporal
  temporal="$(mktemp)"
  tail -n 100 /var/lib/comandas/central-diagnosticos.log > "$temporal"
  install -o root -g comandas -m 0640 "$temporal" /var/lib/comandas/central-diagnosticos.log
  rm -f "$temporal"
  chown root:comandas /var/lib/comandas/central-diagnosticos.log
  chmod 0640 /var/lib/comandas/central-diagnosticos.log
}

leer_config() {
  local clave="$1"
  sed -n "s/^${clave}=//p" /etc/comandas/comandas.env | tail -n 1
}

hay_terminal() {
  [[ -t 0 ]] || ( : </dev/tty ) >/dev/null 2>&1
}

set_version() {
  local version="$1" envfile=/etc/comandas/comandas.env temporal
  temporal="$(mktemp)"
  if [[ -f "$envfile" ]]; then grep -v '^COMANDAS_VERSION=' "$envfile" > "$temporal" || true; fi
  printf 'COMANDAS_VERSION=%s\n' "$version" >> "$temporal"
  install -o root -g root -m 0600 "$temporal" "$envfile"
  rm -f "$temporal"
}

command -v pnpm >/dev/null || npm install --global pnpm@10.33.4
git -C "$APP_DIR" fetch --depth 50 origin main
ANTERIOR="$(git -C "$APP_DIR" rev-parse HEAD)"
OBJETIVO="${COMANDAS_VERSION_OBJETIVO:-$(git -C "$APP_DIR" rev-parse origin/main)}"
[[ "$OBJETIVO" =~ ^[a-f0-9]{40}$ ]] || { echo "La versión solicitada no es un commit válido." >&2; exit 1; }
git -C "$APP_DIR" cat-file -e "$OBJETIVO^{commit}" || { echo "La versión $OBJETIVO no está en main o ya no está disponible." >&2; exit 1; }

NUBE_URL_CONFIG="${NUBE_URL:-$(leer_config NUBE_URL)}"
NUBE_TOKEN_CONFIG="${NUBE_TOKEN:-$(leer_config NUBE_TOKEN)}"
if [[ -z "$NUBE_URL_CONFIG" ]] && hay_terminal; then
  read -r -p "URL HTTPS de la supercentral (Enter para configurar más adelante): " NUBE_URL_CONFIG </dev/tty
  if [[ -n "$NUBE_URL_CONFIG" ]]; then
    [[ "$NUBE_URL_CONFIG" =~ ^https://[^[:space:]]+$ ]] || { echo "La URL debe empezar por https://." >&2; exit 1; }
    NUBE_URL_CONFIG="${NUBE_URL_CONFIG%/}"
    read -r -s -p "NUBE_TOKEN de la supercentral: " NUBE_TOKEN_CONFIG </dev/tty; echo
    [[ "$NUBE_TOKEN_CONFIG" =~ ^[A-Za-z0-9._~-]{20,256}$ ]] || { echo "El token debe contener entre 20 y 256 caracteres URL seguros." >&2; exit 1; }
    temporal="$(mktemp)"
    grep -Ev '^(NUBE_URL|NUBE_TOKEN)=' /etc/comandas/comandas.env > "$temporal" || true
    printf 'NUBE_URL=%s\nNUBE_TOKEN=%s\n' "$NUBE_URL_CONFIG" "$NUBE_TOKEN_CONFIG" >> "$temporal"
    install -o root -g root -m 0600 "$temporal" /etc/comandas/comandas.env
    rm -f "$temporal"
  fi
fi

echo "Creando una copia de seguridad antes de actualizar…"
runuser -u comandas -- env DB_PATH=/var/lib/comandas/local.sqlite DESTINO_BACKUP="$DESTINO_BACKUP" \
  node "$APP_DIR/apps/raspberry-backend/scripts/mantenimiento.mjs"

systemctl stop comandas-worker.service comandas-backend.service || true
if ! git -C "$APP_DIR" reset --hard "$OBJETIVO"; then
  systemctl start comandas-backend.service comandas-worker.service
  exit 1
fi
cd "$APP_DIR"
if ! pnpm install --frozen-lockfile || ! pnpm build; then
  echo "La compilación falló; recuperando la versión anterior $ANTERIOR." >&2
  diagnostico error "Falló la compilación de la versión ${OBJETIVO:0:12}; se recupera ${ANTERIOR:0:12}."
  git -C "$APP_DIR" reset --hard "$ANTERIOR"
  pnpm install --frozen-lockfile && pnpm build || true
  install -D -m 0644 apps/raspberry-backend/src/db/schema.sql apps/raspberry-backend/dist/db/schema.sql || true
  systemctl start comandas-backend.service comandas-worker.service
  exit 1
fi
install -D -m 0644 apps/raspberry-backend/src/db/schema.sql apps/raspberry-backend/dist/db/schema.sql
set_version "$OBJETIVO"
systemctl start comandas-backend.service comandas-worker.service

for intento in {1..30}; do
  if curl --silent --show-error --insecure https://127.0.0.1:3000/salud >/dev/null 2>&1; then
    echo "Actualización completada: $(git -C "$APP_DIR" rev-parse --short HEAD)"
    if [[ -n "$NUBE_URL_CONFIG" && -n "$NUBE_TOKEN_CONFIG" ]]; then
      sed "s|/opt/comandas|$APP_DIR|g" "$APP_DIR/deploy/comandas-update-check.service" > /etc/systemd/system/comandas-update-check.service
      install -m 0644 "$APP_DIR/deploy/comandas-update-check.timer" /etc/systemd/system/comandas-update-check.timer
      systemctl daemon-reload
      systemctl enable --now comandas-update-check.timer
    fi
    exit 0
  fi
  sleep 1
done

echo "El backend no responde; recuperando la versión anterior $ANTERIOR." >&2
diagnostico error "El backend no respondió después de actualizar a ${OBJETIVO:0:12}; se recupera ${ANTERIOR:0:12}."
systemctl stop comandas-worker.service comandas-backend.service || true
git -C "$APP_DIR" reset --hard "$ANTERIOR"
set_version "$ANTERIOR"
pnpm install --frozen-lockfile && pnpm build || true
install -D -m 0644 apps/raspberry-backend/src/db/schema.sql apps/raspberry-backend/dist/db/schema.sql || true
systemctl start comandas-backend.service comandas-worker.service
echo "Revisa los logs: journalctl -u comandas-backend -n 100" >&2
exit 1
