# Modelo de datos

Todo vive en un único archivo SQLite: `apps/raspberry-backend/data/local.sqlite`.
El esquema está en `src/db/schema.sql` y se aplica al arrancar (es idempotente,
todo son `CREATE TABLE IF NOT EXISTS`).

Convención: nombres de tabla y columna en **español y `snake_case`**. Es
deliberado: el dominio es un restaurante español y traducir mentalmente
`table`/`mesa` o `shift`/`turno` en cada consulta solo añade fricción.

## Diagrama de relaciones

```
restaurantes
 ├── usuarios ──────────────┐
 ├── ajustes                │
 ├── empresas ── facturas   │
 ├── zonas ── mesas ────┐   │
 ├── menus              │   │
 │    └── categorias ───┼───┼── (árbol: categoria_padre_id)
 │         └── productos┤   │
 ├── puntos_destino     │   │
 │    ├── producto_destino  │
 │    └── categoria_destino │
 └── turnos                 │
      └── comandas ─────────┴── (mesa_id, camarero_id)
           ├── rondas
           │    └── lineas_comanda ── (producto_id, impresora_resuelta_id)
           └── pagos ── facturas
                 └── log_impresion
```

## Tablas

### `restaurantes`
Credenciales de acceso del local (`email`, `password_hash`). Una sola fila en un
Raspberry, pero la tabla existe porque el Cloud será multi-tenant.

### `usuarios`
El personal. `rol` es `admin` o `camarero`. `pin_hash` con cadena vacía significa
**sin PIN**: ese perfil entra directo al seleccionarlo. `activo = 0` es baja
lógica — desaparece de la selección pero se conserva en el histórico de comandas.

### `ajustes`
Clave/valor por restaurante. Claves en uso: `imprimir_llevar`,
`caja_inicial_fija`, `fiscal_razon_social`, `fiscal_nif`, `fiscal_direccion`,
`fiscal_serie`.

### `empresas`
Clientes que necesitan factura completa. `razon_social`, `nif` y `direccion` son
obligatorios porque sin ellos la factura no es válida. Baja lógica (`activo`),
nunca borrado: las facturas emitidas apuntan aquí y hay que conservarlas 4 años.

### `facturas`
Facturas completas emitidas.

Lo importante de esta tabla:

- **Numeración correlativa**: `UNIQUE (restaurante_id, serie, ejercicio, numero)`.
  La ley exige que no haya saltos ni duplicados dentro de una serie y año.
- **Datos congelados**: `emisor_razon_social`, `emisor_nif`, `emisor_direccion` y
  los equivalentes del cliente se copian al emitir. Si el bar cambia de dirección,
  las facturas viejas siguen mostrando la de entonces — un documento fiscal no
  puede cambiar retroactivamente.
- `desglose_iva` es un JSON: `[{"tipo":10,"base":27.27,"cuota":2.73}, ...]`.
- `anulada` en vez de borrado, por lo mismo.

### `zonas` / `mesas`
La sala. `mesas.estado` es `libre`, `ocupada` o `reservada`.

**Los nombres de mesa son únicos por zona, no por restaurante**: puede haber una
mesa `1` en Sala y otra `1` en Terraza, y se distinguen por la zona.

La mesa pasa a `ocupada` al enviarse la **primera ronda**, no al abrir la comanda:
entrar por error y salir sin pedir la deja libre.

### `menus` / `categorias` / `productos`
La carta. `categorias.categoria_padre_id` forma un **árbol** de profundidad
arbitraria (Bebidas → Vinos → Tintos), con protección anti-ciclos al reasignar
padres.

`productos.precio` es **con IVA incluido**, como se muestra en carta. `tipo_iva`
(`0`, `4`, `10` o `21`) sirve para el desglose de las facturas: la base se calcula
hacia atrás, `base = precio / (1 + tipo/100)`.

`disponible = 0` es «agotado»: sigue en la carta, tachado, no se puede pedir.

### `puntos_destino`
Impresoras y pantallas. `tipo` (`impresora_termica`, `pantalla_kds`,
`impresora_ticket`) es **qué papel juega**; `protocolo` (`escpos_red`,
`escpos_usb`, `websocket_kds`) es **cómo se le habla**. Separarlos permite, por
ejemplo, una impresora de tickets conectada por USB y otra por red.

`config` es JSON porque cada protocolo necesita datos distintos (IP y puerto, o
ruta de dispositivo, o canal). `estado_salud` lo mantiene el worker.

### `producto_destino` / `categoria_destino`
Enrutado producto → impresora. La resolución es **en cascada**: destino del
producto → destino de su categoría → destino de la categoría padre → …

Se hizo así porque configurar producto por producto en una carta de 200 platos es
inviable: se asigna «Bebidas → barra», «Cocina → cocina», y solo las excepciones
se configuran individualmente.

### `turnos`
Servicios. `caja_inicial` viene del ajuste `caja_inicial_fija` (**no se arrastra**
lo contado del turno anterior). `caja_final` es el efectivo contado al cerrar.
`cerrado_en` a `NULL` significa turno en curso — y siempre hay exactamente uno.

### `comandas`
La cuenta de una mesa o un pedido para llevar.

- `id` lo genera el **cliente** (UUID), para idempotencia y funcionamiento offline.
- `tipo`: `mesa`, `llevar` o `domicilio`.
- `estado`: `abierta`, `en_cocina`, `servida`, `cerrada` o `cancelada`. Los tres
  primeros cuentan como comanda «viva» en las consultas. Al unir dos mesas, la de
  origen queda `cancelada`.
- `creado_en` y `cerrado_en` permiten calcular cuánto tiempo estuvo la mesa
  ocupada, que es la métrica de rotación del resumen.

### `rondas`
Cada envío a cocina dentro de una comanda. Una mesa que pide cinco veces tiene
una comanda y cinco rondas. Existe como entidad propia porque **la unidad de
impresión es la ronda**: cada envío genera su papel.

### `lineas_comanda`
Los productos pedidos. Las dos columnas que importan entender:

- **`precio_unitario`**: snapshot del precio al pedir. No se consulta
  `productos.precio` al calcular la cuenta, se usa este. Así los tickets
  históricos son fieles a lo que se cobró.
- **`impresora_resuelta_id`**: la impresora a la que se envió, congelada. Si
  mañana se reconfigura el enrutado, sigue constando dónde se imprimió aquello.

`notas` son los comentarios y agregados («Muy hecho, sin sal») y **se imprimen**.

### `pagos`
Cobros. `metodo` es `efectivo`, `tarjeta` u `otro`. Varias filas por comanda
permiten **pagos partidos**. `impresora_ticket_id` es la caja que imprimió el
ticket (opcional: un pago parcial puede no imprimir).

### `log_impresion`
La cola de impresión, y el punto de unión entre backend y worker. Apunta a una
`ronda_id` **o** a un `pago_id`. `estado`: `pendiente`, `ok` o `error_definitivo`. Guarda `intentos`, `ultimo_error` y `ultimo_intento_en`.

Es también el registro de auditoría de impresión: si cocina dice «no me llegó la
comanda de la mesa 4», la prueba está aquí, no en un log de texto volátil.

**Crece indefinidamente y guarda los bytes de cada ticket** → conviene limpiar lo
que está en `ok` de hace más de una semana. Está pendiente.

### `eventos_sync`
Outbox para el Cloud: eventos idempotentes que el Raspberry irá enviando cuando
haya internet. **La tabla existe pero todavía no se rellena.**

## Qué se conserva y qué se puede limpiar

| Se conserva para siempre | Se puede limpiar |
|---|---|
| `comandas`, `lineas_comanda`, `rondas` | `log_impresion` (lo que está en `ok`) |
| `pagos`, `turnos` | |
| `facturas`, `empresas` (mínimo 4 años por ley) | |

## Resetear la base de datos en desarrollo

Si cambia el esquema y da errores raros:

```bash
rm apps/raspberry-backend/data/local.sqlite*
# arranca el backend (recrea las tablas) y luego:
cd apps/raspberry-backend && node scripts/bootstrap-admin.mjs
```

**Ojo con un detalle que muerde:** si borras la BD con la app abierta en el
navegador, el token guardado apunta a un usuario que ya no existe. El backend lo
detecta y responde `401`, y la app limpia la sesión y vuelve al login sola — pero
si ves comportamientos raros, borra también los datos del sitio en el navegador.
