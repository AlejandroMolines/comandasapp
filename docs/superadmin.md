# Superadmin y entorno privado de pruebas

La central (`apps/nube`) muestra el estado que envían los Raspberry. El listado
de restaurantes queda protegido con una sesión privada: no se guardan usuarios,
contraseñas ni claves en el código ni en el navegador. La sesión dura 12 horas,
usa una cookie `HttpOnly`, `SameSite=Strict` y, en producción, `Secure`.

## Credenciales del superadmin

En el proyecto de Vercel de la central, define como variables privadas de
Production:

| Variable | Valor |
|---|---|
| `SUPERADMIN_USER` | Tu usuario privado |
| `SUPERADMIN_PASSWORD` | Una contraseña de al menos 8 caracteres |
| `SUPERADMIN_SESSION_SECRET` | Secreto aleatorio de al menos 32 caracteres |
| `DEMO_RESTAURANT_URL` | URL HTTPS del backend remoto de pruebas |
| `NUBE_TOKEN` | Token privado compartido por la central y los Raspberry |

Puedes generar el secreto de sesión en tu equipo con:

```bash
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
```

No pongas estos valores en `VITE_*`, en el repositorio, en incidencias ni en
capturas. Después de guardar las variables, vuelve a desplegar la central.
El endpoint `/api/restaurantes` ya no devuelve información sin esa sesión.

## Publicar versiones y revisar diagnósticos

Configura `NUBE_TOKEN` como variable privada de Production en Vercel. Genera un
valor aleatorio de al menos 32 caracteres URL seguros (por ejemplo,
`openssl rand -hex 32`) y usa el mismo en cada Raspberry. La central necesita
Postgres, Upstash KV o Vercel Blob para conservar la versión publicada; el modo
`memoria` no sirve para distribuir actualizaciones.

Después de enlazar una Raspberry con la URL de la central y ese token, aparecerá
en **Central de restaurantes**. En **Versiones de los restaurantes** puedes
escoger uno de los últimos commits de `main` y publicarlo a todos los locales.
Cada Raspberry consulta la central cada cinco minutos, crea una copia local de
SQLite y actualiza los servicios. Si la compilación o el chequeo de salud fallan,
recupera el código anterior y envía un diagnóstico. También se muestran avisos y
errores recientes del backend. La pausa detiene nuevas instalaciones; no
interrumpe una actualización ya iniciada.

Las publicaciones solo avanzan respecto a la versión publicada; el panel no
permite seleccionar una versión anterior, porque los cambios de esquema de la
base pueden no ser reversibles. Los commits seleccionables provienen de los
últimos 30 commits de `main`.

Los Raspberry instalados antes de esta función necesitan actualizarse una vez
manualmente y enlazarse a la central. A partir de entonces queda instalado el
comprobador periódico. El acceso remoto muestra diagnósticos acotados del
backend y de fallos de actualización, no una consola remota ni datos de ventas.

## Restaurante de pruebas

La central no puede ejecutar el backend (SQLite, Socket.IO e impresión). El
demo es otro proceso del mismo código, aislado de los locales reales:

```bash
node iniciar.mjs --demo
```

En el panel, la tarjeta **Restaurante demo** abre el móvil, el PC y la cocina,
y puede reiniciar la semilla. Esas acciones llaman a ese servidor. Configura:

| Variable | Uso |
|---|---|
| `NODE_ENV=production` | Exige TLS en el backend |
| `TLS_CERT_FILE`, `TLS_KEY_FILE` | Certificado HTTPS y clave privada |
| `RESTAURANTE_ID=restaurante-pruebas` | Identificador independiente de otros restaurantes |
| `DB_PATH` | Archivo SQLite dentro de almacenamiento persistente |
| `DEMO_RESTAURANT_NAME` | Nombre que verá el camarero |
| `DEMO_ADMIN_EMAIL`, `DEMO_ADMIN_PASSWORD`, `DEMO_ADMIN_PIN` | Acceso privado al perfil administrador |
| `DEMO_WAITER_NAME`, `DEMO_WAITER_PIN` | Acceso privado al perfil camarero |
| `NUBE_URL`, `NUBE_TOKEN` | Envío de pulsos a la central |
| `MODO_DEMO=1` | Lo pone `node iniciar.mjs --demo`. Impresión simulada y serie `DEMO` |
| `DEMO_BRIDGE_TOKEN` | Misma clave que en la central, para abrir sesión y reiniciar |

Inicializa una base vacía desde `apps/raspberry-backend` con `node
scripts/bootstrap-admin.mjs` y `node scripts/seed-demo.mjs`. En producción el
bootstrap rechaza credenciales predeterminadas: la contraseña debe tener al
menos 16 caracteres, el PIN entre 3 y 6 dígitos. Conserva el directorio de la
base de datos en un volumen persistente. El script de semilla añade zonas,
mesas, carta, extras y destinos de prueba.

No apuntes `DEMO_RESTAURANT_URL` al Raspberry de un cliente. Solo al proceso
arrancado con `--demo`. Ese proceso se anuncia a la central con `esDemo` y no
entra en el listado ni en los conteos de los locales reales.

## Desarrollo local

El inicio local conserva las credenciales de demostración conocidas para no
romper el flujo de desarrollo (`admin@demo.com`, perfil Admin y PIN `1234`).
Solo sirven para la base local de desarrollo; la inicialización en producción
exige las variables privadas anteriores.
