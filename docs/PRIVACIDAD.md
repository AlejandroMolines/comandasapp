# Privacidad y protección de datos

ComandasApp instala la aplicación y su base SQLite en el restaurante. Antes de
ponerla en servicio, el responsable del establecimiento debe documentar sus
finalidades, base jurídica, plazos de conservación, información a empleados y
clientes, y quién puede acceder a datos personales. Este documento técnico no
sustituye esa evaluación ni una política de privacidad del restaurante.

## Datos que puede contener la instalación

- Nombres, roles, PIN derivado y actividad de los usuarios del equipo.
- Comandas, notas, turnos, pagos e información de facturación de clientes empresa.
- Diagnósticos operativos enviados a la supercentral cuando el local está enlazado.

No incluyas datos personales innecesarios en observaciones de platos. Limita las
cuentas de administración, protege físicamente el Raspberry y mantén actualizado
el sistema operativo y la aplicación. La conexión de la app local requiere HTTPS.

## Copias y restauración

El backup incluye la base de datos y puede incluir el secreto de sesión. Guarda las
copias en un soporte separado del equipo, restringe su acceso y aplica cifrado del
dispositivo o del volumen cuando sea posible. No publiques copias ni secretos en
GitHub. Prueba periódicamente que una copia se puede restaurar; una copia que nunca
se restaura no demuestra que el plan de recuperación funcione.

Define un plazo de conservación para cada categoría con asesoría. Los plazos fiscales
y mercantiles no justifican conservar indefinidamente datos personales accesorios.
Cuando una instalación se desvincule de la supercentral, revisa también los datos de
diagnóstico enviados y los accesos que deban revocarse.
