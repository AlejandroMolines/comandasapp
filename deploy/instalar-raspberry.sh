#!/usr/bin/env bash
# Instalación guiada para Raspberry Pi OS / Debian de 64 bits.
# Uso inicial: curl -fsSL https://raw.githubusercontent.com/AlejandroMolines/comandasapp/main/deploy/instalar-raspberry.sh | sudo bash
set -Eeuo pipefail

REPO_URL="https://github.com/AlejandroMolines/comandasapp.git"
RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." 2>/dev/null && pwd || true)"
DESTINO_BACKUP="${DESTINO_BACKUP:-/var/backups/comandas}"
APP_DIR="${COMANDAS_DIR:-/opt/comandas}"
STATE_DIR=/var/lib/comandas
ENV_DIR=/etc/comandas
TLS_DIR="$ENV_DIR/tls"

die() { echo "Error: $*" >&2; exit 1; }
como_root() { [[ "$(id -u)" -eq 0 ]] || die "Ejecuta el instalador con sudo."; }
preguntar() { local variable="$1" prompt="$2" valor; read -r -p "$prompt" valor </dev/tty; printf -v "$variable" '%s' "$valor"; }
preguntar_secreto() { local variable="$1" prompt="$2" valor; read -r -s -p "$prompt" valor </dev/tty; echo >/dev/tty; printf -v "$variable" '%s' "$valor"; }

como_root

# Si se ejecuta desde curl | sudo bash, el script no tiene un checkout local.
if [[ ! -f "$RAIZ/pnpm-lock.yaml" ]]; then
  command -v git >/dev/null || { apt-get update; DEBIAN_FRONTEND=noninteractive apt-get install -y git; }
  if [[ ! -d "$APP_DIR/.git" ]]; then
    git clone --depth 1 "$REPO_URL" "$APP_DIR"
  elif [[ -e "$STATE_DIR/.setup-complete" ]]; then
    git -C "$APP_DIR" fetch --depth 50 origin main
    git -C "$APP_DIR" show origin/main:deploy/actualizar-raspberry.sh > "$APP_DIR/deploy/actualizar-raspberry.sh"
    chmod 0755 "$APP_DIR/deploy/actualizar-raspberry.sh"
    exec bash "$APP_DIR/deploy/actualizar-raspberry.sh"
  else
    git -C "$APP_DIR" fetch --depth 1 origin main
    git -C "$APP_DIR" reset --hard origin/main
  fi
  exec bash "$APP_DIR/deploy/instalar-raspberry.sh"
fi

RAIZ="$(cd "$RAIZ" && pwd)"
[[ -f /etc/os-release ]] || die "No se pudo identificar el sistema operativo."
. /etc/os-release
[[ "${ID:-}" == debian || "${ID:-}" == raspbian || "${ID_LIKE:-}" == *debian* ]] || die "Requiere Debian o Raspberry Pi OS de 64 bits."
[[ "$(getconf LONG_BIT)" == 64 ]] || die "Requiere un sistema operativo de 64 bits."
command -v systemctl >/dev/null || die "Requiere systemd."

if [[ -e "$STATE_DIR/.setup-complete" ]]; then
  echo "Esta instalación ya está inicializada. No se tocarán el restaurante ni sus credenciales."
  exec bash "$APP_DIR/deploy/actualizar-raspberry.sh"
fi

echo "Instalación inicial de Comandas en $APP_DIR"
echo "Se crearán un restaurante vacío y el acceso administrador. No se cargan datos de demostración."
echo
preguntar nombre "Nombre del restaurante: "
preguntar email "Email para iniciar sesión como administrador: "
[[ -n "$nombre" ]] || die "El nombre no puede estar vacío."
[[ "$email" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]] || die "Introduce un email válido."
while true; do
  preguntar_secreto clave "Contraseña del restaurante (mínimo 16 caracteres): "
  preguntar_secreto clave2 "Repite la contraseña: "
  [[ "$clave" == "$clave2" ]] || { echo "Las contraseñas no coinciden."; continue; }
  [[ ${#clave} -ge 16 && ${#clave} -le 1024 ]] || { echo "Debe tener entre 16 y 1024 caracteres."; continue; }
  break
done
while true; do
  preguntar_secreto pin "PIN del perfil administrador (3 a 6 dígitos): "
  [[ "$pin" =~ ^[0-9]{3,6}$ ]] && break
  echo "El PIN debe tener entre 3 y 6 dígitos."
done
echo
preguntar central_url "URL de la supercentral para gestionar versiones y logs (Enter para omitir): "
central_token=""
if [[ -n "$central_url" ]]; then
  [[ "$central_url" =~ ^https://[^[:space:]]+$ ]] || die "La URL de la supercentral debe empezar por https://."
  central_url="${central_url%/}"
  preguntar_secreto central_token "NUBE_TOKEN configurado en la supercentral: "
  [[ "$central_token" =~ ^[A-Za-z0-9._~-]{20,256}$ ]] || die "El token debe contener entre 20 y 256 caracteres URL seguros."
fi

echo
echo "Preparando dependencias y compilando (puede tardar varios minutos)…"
apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y ca-certificates curl git openssl build-essential python3 make g++
if ! command -v node >/dev/null || ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) === 22 ? 0 : 1)'; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs
fi
node -e 'process.exit(Number(process.versions.node.split(".")[0]) === 22 ? 0 : 1)' || die "No se pudo instalar Node.js 22."
npm install --global pnpm@10.33.4

# Mantener la instalación en /opt para que el servicio de ejecución no dependa de una sesión de usuario.
if [[ "$RAIZ" != "$APP_DIR" ]]; then
  install -d -m 0755 "$APP_DIR"
  tar -C "$RAIZ" --exclude=node_modules --exclude='*/node_modules' -cf - . | tar -C "$APP_DIR" -xf -
  RAIZ="$APP_DIR"
fi
cd "$RAIZ"
pnpm install --frozen-lockfile
pnpm build
install -D -m 0644 apps/raspberry-backend/src/db/schema.sql apps/raspberry-backend/dist/db/schema.sql

if ! id comandas >/dev/null 2>&1; then
  useradd --system --home-dir "$STATE_DIR" --no-create-home --shell /usr/sbin/nologin comandas
fi

# Un certificado local permite HTTPS y Socket.IO seguro en la LAN. Cada dispositivo
# deberá confiar en cert.pem para que el navegador habilite la PWA sin avisos.
IP_LAN="$(hostname -I 2>/dev/null | awk '{print $1}')"
IP_LAN="${IP_LAN:-127.0.0.1}"
install -d -o root -g comandas -m 0750 "$TLS_DIR"
cat > "$TLS_DIR/openssl.cnf" <<EOF
[req]
distinguished_name=dn
prompt=no
[dn]
CN=raspberry.local
[ca_ext]
basicConstraints=critical,CA:TRUE
keyUsage=critical,digitalSignature,keyEncipherment,keyCertSign
[server_ext]
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=@alt_names
[alt_names]
DNS.1=raspberry.local
DNS.2=localhost
IP.1=127.0.0.1
IP.2=$IP_LAN
EOF
openssl req -x509 -newkey rsa:3072 -sha256 -nodes -days 3650 \
  -keyout "$TLS_DIR/ca-key.pem" -out "$TLS_DIR/ca.pem" \
  -config "$TLS_DIR/openssl.cnf" -extensions ca_ext
openssl req -new -newkey rsa:3072 -sha256 -nodes \
  -keyout "$TLS_DIR/private-key.pem" -out "$TLS_DIR/server.csr" \
  -config "$TLS_DIR/openssl.cnf"
openssl x509 -req -sha256 -days 825 -in "$TLS_DIR/server.csr" \
  -CA "$TLS_DIR/ca.pem" -CAkey "$TLS_DIR/ca-key.pem" -CAcreateserial \
  -out "$TLS_DIR/cert.pem" -extfile "$TLS_DIR/openssl.cnf" -extensions server_ext
rm -f "$TLS_DIR/server.csr" "$TLS_DIR/ca.srl" "$TLS_DIR/openssl.cnf"
chmod 0640 "$TLS_DIR/private-key.pem"
chmod 0644 "$TLS_DIR/cert.pem"
chmod 0644 "$TLS_DIR/ca.pem"
chmod 0600 "$TLS_DIR/ca-key.pem"

install -d -o comandas -g comandas -m 0750 "$STATE_DIR" "$DESTINO_BACKUP"
chown -R root:root "$APP_DIR"
chmod -R a-w "$APP_DIR"
chown root:comandas "$TLS_DIR" "$TLS_DIR/private-key.pem"

local_id="$(cat /proc/sys/kernel/random/uuid | tr -d '-')"
version_inicial="$(git -C "$APP_DIR" rev-parse HEAD)"
cat > "$ENV_DIR/comandas.env" <<EOF
NODE_ENV=production
PORT=3000
RESTAURANTE_ID=$local_id
COMANDAS_VERSION=$version_inicial
NUBE_URL=$central_url
NUBE_TOKEN=$central_token
DB_PATH=$STATE_DIR/local.sqlite
TOKEN_SECRET_FILE=$STATE_DIR/token.secret
TLS_CERT_FILE=$TLS_DIR/cert.pem
TLS_KEY_FILE=$TLS_DIR/private-key.pem
EOF
chmod 0600 "$ENV_DIR/comandas.env"
chown root:root "$ENV_DIR/comandas.env"

for unidad in comandas-backend.service comandas-worker.service comandas-backup.service comandas-backup.timer comandas-update-check.service comandas-update-check.timer; do
  sed "s|/opt/comandas|$APP_DIR|g; s|/var/backups/comandas|$DESTINO_BACKUP|g" \
    "$RAIZ/deploy/$unidad" > "/etc/systemd/system/$unidad"
done
systemctl daemon-reload
systemctl enable --now comandas-backend.service

for intento in {1..30}; do
  if curl --silent --show-error --insecure https://127.0.0.1:3000/salud >/dev/null 2>&1; then break; fi
  sleep 1
done
curl --fail --silent --show-error --insecure https://127.0.0.1:3000/salud >/dev/null || {
  journalctl -u comandas-backend.service -n 40 --no-pager
  die "El backend no arrancó."
}

RESTAURANTE_ID="$local_id" DEMO_RESTAURANT_NAME="$nombre" DEMO_ADMIN_EMAIL="$email" \
DEMO_ADMIN_PASSWORD="$clave" DEMO_ADMIN_PIN="$pin" DB_PATH="$STATE_DIR/local.sqlite" NODE_ENV=production \
  runuser -u comandas -- node "$RAIZ/apps/raspberry-backend/scripts/bootstrap-admin.mjs"
unset clave clave2 pin
touch "$STATE_DIR/.setup-complete"
chown comandas:comandas "$STATE_DIR/.setup-complete"
systemctl enable --now comandas-worker.service comandas-backup.timer
if [[ -n "$central_url" ]]; then systemctl enable --now comandas-update-check.timer; fi

echo
echo "Instalación terminada. Desde la misma red WiFi: https://raspberry.local:3000"
echo "También puedes usar https://$IP_LAN:3000"
echo "Usuario: $email (usa la contraseña que acabas de introducir)."
echo "Certificado CA para confiar en cada dispositivo: $TLS_DIR/ca.pem"
echo "Guía para confiar en él y añadir la app a inicio: https://github.com/AlejandroMolines/comandasapp/blob/main/docs/MANTENIMIENTO.md#primer-acceso"
echo "Datos y clave de sesiones: $STATE_DIR · copias: $DESTINO_BACKUP"
echo "Para actualizar en el futuro: sudo bash $APP_DIR/deploy/actualizar-raspberry.sh"
if [[ -n "$central_url" ]]; then echo "La supercentral comprobará versiones y diagnósticos automáticamente."; fi
