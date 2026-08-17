# El Raspberry como punto de acceso WiFi

## El problema que resuelve

Sin esto, la red del bar tiene un **punto único de fallo**: el router. Si el
router se avería, se moja, alguien lo desenchufa para conectar el aspirador o
simplemente se cuelga, los móviles no llegan al Raspberry y el servicio se para.

Con el Raspberry emitiendo su propia WiFi, el router pasa a ser opcional: solo
sirve para tener internet, y el internet no hace falta para trabajar.

**Importante:** esto no hace que funcione «sin WiFi». Sigue habiendo WiFi — la
crea el Raspberry en lugar del router. No existe forma de que un móvil hable con
un servidor sin una red que los una; lo que se elimina es la dependencia de un
aparato ajeno.

## Cómo montar la red

```
        Comandas-Bar (WiFi del Raspberry)
              ↕
    móviles de los camareros
              ↕
    ┌─────────────────────┐
    │   RASPBERRY PI      │  wlan0 = punto de acceso (192.168.4.1)
    │                     │  eth0  = red cableada    (192.168.1.10)
    └──────────┬──────────┘
               │ cable
          ┌────▼────┐
          │ SWITCH  │  ← 20-25 €, no necesita configuración
          └─┬──┬──┬─┘
            │  │  └──── router (solo para internet)
            │  └─────── impresora cocina  192.168.1.50
            └────────── impresora barra   192.168.1.51
```

**La clave está en el switch.** Todo lo que importa (Raspberry e impresoras) va
colgado del switch, no del router. Un switch es un aparato tonto que solo reparte
cable, así que sigue funcionando aunque el router muera. El router se conecta a
un puerto más y aporta únicamente internet.

### La regla que hace que funcione: IPs fijas

Esto es lo más fácil de olvidar y lo que rompe todo el montaje: **el Raspberry y
las impresoras deben tener IP fija configurada en ellos mismos**, no asignada por
el router.

Si dependen del router para recibir su IP (DHCP), cuando el router muera se
quedarán sin dirección y no podrán hablar entre ellos, aunque el switch funcione
perfectamente. Con IPs fijas, el segmento cableado es autónomo.

- Raspberry en `eth0`: `192.168.1.10`
- Impresoras: `192.168.1.50`, `192.168.1.51`… (se configura en el menú de la
  propia impresora)
- Todas en la misma subred que el router, para que también haya internet cuando
  el router esté vivo.

## Instalación

```bash
cd ~/comandas-app
sudo CLAVE="una-clave-buena" SSID="Comandas-Bar" ./scripts/punto-acceso.sh
```

El script comprueba que existe NetworkManager y la interfaz, valida la
contraseña, crea la red y la deja activa y arrancando sola al encender.

Luego, en cada móvil: conectarse a `Comandas-Bar` y abrir
**http://192.168.4.1:3000**

### Un detalle que evita disgustos

**Olvida la WiFi del bar en los móviles de trabajo.** Si un móvil tiene guardadas
las dos redes, puede cambiarse solo a la del router en cualquier momento —
justamente cuando el router está fallando y por eso da mala señal. Los móviles de
servicio deben conocer solo la red del Raspberry.

## Decisiones del script, explicadas

**Banda 2.4 GHz y no 5 GHz.** La de 5 GHz es más rápida pero atraviesa peor las
paredes y llega menos lejos. En un bar el alcance importa mucho más que la
velocidad: una comanda son unos pocos kilobytes. Además todos los móviles
soportan 2.4 GHz.

**Canal 1, 6 u 11.** Son los únicos que no se solapan entre sí en 2.4 GHz. Si en
tu calle hay muchas redes, prueba los tres y quédate con el que vaya mejor.

**WPA2 y no WPA3.** WPA3 es más seguro, pero algunos móviles con unos años no se
conectan. En un bar donde los teléfonos son los que son, la compatibilidad gana.

**`ipv4.method shared`.** Hace dos cosas de golpe: levanta un DHCP para que los
móviles reciban IP solos, y hace NAT hacia el cable, así que los móviles también
tienen internet cuando el router está disponible.

## Qué pasa en cada escenario

| Qué falla | Comandas | Impresión | Cobros | Internet |
|---|---|---|---|---|
| Se cae internet (avería de la operadora) | ✅ | ✅ | ✅ | ❌ |
| Muere el router | ✅ | ✅ | ✅ | ❌ |
| Un camarero sale de cobertura | ⏳ en cola | ⏳ al volver | ❌ | — |
| Se apaga el Raspberry | ❌ | ❌ | ❌ | ✅ |
| Corte de luz general | ❌ | ❌ | ❌ | ❌ |

Los dos últimos son los que quedan, y para eso está lo siguiente.

## Lo que falta para que sea de verdad fiable

**Un SAI pequeño (50-70 €)** con el Raspberry, el switch y las impresoras
enchufados. En un bar con cocina eléctrica, freidoras y cámaras arrancando, los
microcortes y los saltos del diferencial son bastante más frecuentes que una
avería de fibra. Un SAI de 500 VA te da unos 20-30 minutos, que es tiempo de
sobra para terminar el servicio o para apagar limpiamente.

Y protege contra algo peor que el corte: **el apagado en seco corrompe la tarjeta
SD**. El modo WAL de SQLite protege la base de datos, pero el sistema de archivos
del sistema operativo también sufre.

**Una tarjeta SD clonada de repuesto en un cajón.** El día que falle (fallará),
cambias la tarjeta en dos minutos en lugar de cerrar.

## Limitaciones honestas

**El WiFi interno del Raspberry no es un punto de acceso profesional.** Va bien
para 5-10 móviles en un espacio normal. Si tienes una terraza grande, dos plantas
o paredes gruesas, un AP dedicado de 50-60 € da mucho mejor alcance y aguanta
más dispositivos.

En ese caso, el montaje ideal combina las dos cosas: el AP dedicado colgado del
switch como red principal, y el punto de acceso del Raspberry como **red de
emergencia** con otro nombre (`Comandas-Backup`). Si el AP falla, los camareros
cambian de red a mano y siguen trabajando.

**NetworkManager en modo AP puede dar guerra en algunas versiones.** Hay casos
reportados de puntos de acceso que aparecen y luego dejan de emitir. Si te ocurre:

```bash
journalctl -b | grep NetworkManager | tail -30
```

Si no consigues que sea estable, el método clásico con `hostapd` + `dnsmasq` es
más viejo pero muy sólido. Pruébalo un día completo antes de confiarle un
servicio real.

**Una sola radio no puede ser AP y cliente a la vez** de forma fiable. Por eso el
Raspberry va al router **por cable**: la WiFi la dedica entera a emitir.

## Comprobar que va bien

```bash
# ¿está activo el punto de acceso?
nmcli con show --active

# ¿quién está conectado?
iw dev wlan0 station dump | grep Station

# calidad de la señal de cada móvil conectado
iw dev wlan0 station dump | grep -E "Station|signal"
```

Un consejo práctico: **prueba la cobertura en la mesa más alejada antes de
abrir**, no en plena hora punta. Si en la esquina de la terraza la señal está por
debajo de -75 dBm, ahí vas a tener problemas.
