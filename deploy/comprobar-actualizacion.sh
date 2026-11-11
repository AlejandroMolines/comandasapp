#!/usr/bin/env bash
# El Raspberry solo consulta la versión deseada; la central nunca abre conexiones entrantes al local.
set -Eeuo pipefail

[[ -n "${NUBE_URL:-}" && -n "${NUBE_TOKEN:-}" ]] || exit 0
APP_DIR="${COMANDAS_DIR:-/opt/comandas}"
URL="${NUBE_URL%/}/api/actualizacion"
RESPUESTA="$(curl --silent --show-error --fail --max-time 10 \
  -H "Authorization: Bearer $NUBE_TOKEN" "$URL")" || {
  echo "No se pudo consultar la versión publicada; se mantiene la versión local."
  exit 0
}
OBJETIVO="$(printf '%s' "$RESPUESTA" | node -e '
let s=""; process.stdin.on("data", d => s += d).on("end", () => {
  try { const sha = JSON.parse(s)?.release?.sha ?? ""; process.stdout.write(/^[a-f0-9]{40}$/i.test(sha) ? sha.toLowerCase() : ""); }
  catch { process.stdout.write(""); }
});')"
[[ -n "$OBJETIVO" ]] || exit 0
ACTUAL="${COMANDAS_VERSION:-}"
[[ "$OBJETIVO" != "$ACTUAL" ]] || exit 0
if git -C "$APP_DIR" merge-base --is-ancestor "$OBJETIVO" HEAD 2>/dev/null; then
  echo "El restaurante ya tiene esta versión o una posterior; no se aplicará una regresión."
  exit 0
fi

echo "Versión $OBJETIVO publicada; iniciando actualización protegida por copia de seguridad."
COMANDAS_VERSION_OBJETIVO="$OBJETIVO" bash "$APP_DIR/deploy/actualizar-raspberry.sh"
