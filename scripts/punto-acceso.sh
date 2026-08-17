#!/usr/bin/env bash
#
# Convierte el Raspberry en PUNTO DE ACCESO WiFi propio.
#
# Por qué: si el router del bar se cae (se moja, lo desenchufan, se avería),
# el sistema entero se queda sin red y los camareros no pueden pedir. Con el
# Raspberry emitiendo su propia WiFi, el router deja de ser un punto único de
# fallo: aunque muera, los móviles siguen hablando con el Raspberry y las
# comandas siguen imprimiéndose.
#
# Requisitos:
#   · Raspberry Pi OS Bookworm o posterior (usa NetworkManager)
#   · El Raspberry conectado al router POR CABLE (eth0) si se quiere internet
#   · Ejecutar con sudo
#
# Uso:
#   sudo ./punto-acceso.sh                          (valores por defecto)
#   sudo SSID="Comandas-Pepe" CLAVE="micl4ve" ./punto-acceso.sh
#
set -euo pipefail

# --- Configuración (se puede sobreescribir con variables de entorno) --------
SSID="${SSID:-Comandas-Bar}"
CLAVE="${CLAVE:-}"
IP_AP="${IP_AP:-192.168.4.1}"
CANAL="${CANAL:-6}"          # 1, 6 u 11 en 2.4GHz: son los que no se solapan
CONEXION="comandas-ap"
INTERFAZ="${INTERFAZ:-wlan0}"

rojo()  { printf '\033[31m%s\033[0m\n' "$*"; }
verde() { printf '\033[32m%s\033[0m\n' "$*"; }
info()  { printf '\033[90m%s\033[0m\n' "$*"; }

# --- Comprobaciones previas ------------------------------------------------
if [[ $EUID -ne 0 ]]; then
  rojo "Ejecútalo con sudo: sudo ./punto-acceso.sh"
  exit 1
fi

if ! command -v nmcli >/dev/null; then
  rojo "No se encuentra nmcli (NetworkManager)."
  info "Este script necesita Raspberry Pi OS Bookworm o posterior."
  info "En versiones anteriores hay que usar hostapd + dnsmasq (ver docs/PUNTO-ACCESO.md)."
  exit 1
fi

if ! nmcli device status | grep -q "^${INTERFAZ}"; then
  rojo "No existe la interfaz ${INTERFAZ}."
  nmcli device status
  exit 1
fi

if [[ -z "$CLAVE" ]]; then
  rojo "Falta la contraseña de la WiFi."
  info 'Usa: sudo CLAVE="tu-clave-de-al-menos-8-caracteres" ./punto-acceso.sh'
  exit 1
fi

if [[ ${#CLAVE} -lt 8 ]]; then
  rojo "La contraseña debe tener al menos 8 caracteres (lo exige WPA2)."
  exit 1
fi

echo
info "════════════════════════════════════════════"
info "  SSID:      $SSID"
info "  IP del AP: $IP_AP"
info "  Canal:     $CANAL (banda 2.4GHz)"
info "  Interfaz:  $INTERFAZ"
info "════════════════════════════════════════════"
echo

# --- Crear el punto de acceso ---------------------------------------------
# Si ya existía una configuración con este nombre, se rehace desde cero:
# es más predecible que intentar parchear una configuración a medias.
if nmcli con show "$CONEXION" >/dev/null 2>&1; then
  info "Ya existía '$CONEXION', se recrea..."
  nmcli con delete "$CONEXION" >/dev/null
fi

nmcli con add type wifi ifname "$INTERFAZ" mode ap con-name "$CONEXION" ssid "$SSID" >/dev/null

# Banda 2.4GHz (bg) a propósito: llega más lejos y atraviesa mejor las paredes
# de un bar que la de 5GHz, y todos los móviles la soportan. En un restaurante
# el alcance importa mucho más que la velocidad: mover comandas son unos pocos
# kilobytes.
nmcli con modify "$CONEXION" 802-11-wireless.band bg
nmcli con modify "$CONEXION" 802-11-wireless.channel "$CANAL"

# WPA2 (wpa-psk) y no WPA3: WPA3 es más seguro, pero móviles algo antiguos no
# se conectan, y en un bar con teléfonos variados eso es un problema real.
nmcli con modify "$CONEXION" wifi-sec.key-mgmt wpa-psk
nmcli con modify "$CONEXION" wifi-sec.psk "$CLAVE"

# ipv4.method shared: NetworkManager levanta su propio DHCP en esta interfaz
# (los móviles reciben IP solos) y hace NAT hacia eth0, así que si hay internet
# por cable, los móviles también lo tienen.
nmcli con modify "$CONEXION" ipv4.method shared ipv4.address "${IP_AP}/24"
nmcli con modify "$CONEXION" ipv6.method disabled

# Que se levante solo al arrancar: el bar abre y la red ya está.
nmcli con modify "$CONEXION" connection.autoconnect yes
nmcli con modify "$CONEXION" connection.autoconnect-priority 100

verde "Configuración creada. Levantando el punto de acceso..."
nmcli con up "$CONEXION"

sleep 3
echo
if nmcli -t -f NAME,DEVICE con show --active | grep -q "^${CONEXION}:"; then
  verde "════════════════════════════════════════════"
  verde "  Punto de acceso FUNCIONANDO"
  verde "════════════════════════════════════════════"
  echo
  info "  Red WiFi:  $SSID"
  info "  La app:    http://${IP_AP}:3000"
  echo
  info "Siguiente paso: conecta los móviles a '$SSID' y abre esa dirección."
  info "Y OLVIDA la WiFi del bar en esos móviles, para que no se cambien solos."
else
  rojo "El punto de acceso no ha levantado."
  info "Mira los logs con:  journalctl -b | grep NetworkManager | tail -30"
  info "Causa habitual: la interfaz $INTERFAZ está ocupada como cliente WiFi."
  info "Desconéctala con: sudo nmcli device disconnect $INTERFAZ"
  exit 1
fi
