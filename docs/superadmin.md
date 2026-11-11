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

Puedes generar el secreto de sesión en tu equipo con:

```bash
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
```

No pongas estos valores en `VITE_*`, en el repositorio, en incidencias ni en
capturas. Después de guardar las variables, vuelve a desplegar la central.
El endpoint `/api/restaurantes` ya no devuelve información sin esa sesión.

## Restaurante de pruebas

La URL `https://comandasapp-theta.vercel.app` hospeda la central, no el backend
de comandas. No puede servir directamente el restaurante: el backend utiliza
SQLite persistente, Socket.IO y un worker de impresión, que no forman parte de
las funciones de esta central. El panel muestra el botón **Abrir restaurante**
cuando `DEMO_RESTAURANT_URL` apunta a una instancia HTTPS real y separada.

En el servidor del restaurante de pruebas configura:

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

Inicializa una base vacía desde `apps/raspberry-backend` con `node
scripts/bootstrap-admin.mjs` y `node scripts/seed-demo.mjs`. En producción el
bootstrap rechaza credenciales predeterminadas: la contraseña debe tener al
menos 16 caracteres, el PIN entre 3 y 6 dígitos. Conserva el directorio de la
base de datos en un volumen persistente. El script de semilla añade zonas,
mesas, carta, extras y destinos de prueba.

No hay una instancia remota de backend configurada en el repositorio ni
credenciales de un proveedor de alojamiento disponibles para este proyecto.
Por eso el panel y la integración quedan listos, pero el botón de prueba no se
activa hasta desplegar ese servicio y definir `DEMO_RESTAURANT_URL`. No uses el
backend de un restaurante real como demo.

## Desarrollo local

El inicio local conserva las credenciales de demostración conocidas para no
romper el flujo de desarrollo (`admin@demo.com`, perfil Admin y PIN `1234`).
Solo sirven para la base local de desarrollo; la inicialización en producción
exige las variables privadas anteriores.
