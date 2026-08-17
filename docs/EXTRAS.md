# Extras y modificaciones

Lo que el camarero puede añadir a un producto al pedirlo. Se gestionan desde
**Panel → Extras**, así que cada restaurante define los suyos: no hay nada
hardcodeado en la app.

## Dos ejes independientes

### Con coste o sin coste

| Precio | Qué es | Ejemplos | Efecto en la cuenta |
|---|---|---|---|
| `0` | **Modificación** | «sin cebolla», «muy hecho», «sin gluten» | Ninguno |
| `> 0` | **Extra** | «extra de queso +1,50», «doble de bacon +2» | Se suma al precio de la línea |

Ambos se imprimen para cocina: una modificación que no llegue al cocinero es un
plato devuelto.

### General o específico

| Ámbito | Dónde se ofrece | Ejemplo típico |
|---|---|---|
| **General** | En cualquier producto | «para compartir», «para llevar» |
| **Específico** | Solo en los productos y/o categorías que elijas | «sin hielo» solo en bebidas, «punto de la carne» solo en carnes |

**Los específicos se heredan hacia abajo por el árbol de categorías.** Si cuelgas
«sin gluten» de la categoría *Comida*, lo heredan *Carnes*, *Pescados* y todo lo
que haya debajo, sin configurar producto por producto. Esto es lo que hace el
sistema usable con una carta de 200 platos.

Un extra específico sin ningún producto ni categoría asignada se rechaza con un
error explicando que, si vale para todo, debe marcarse como general.

## Cómo lo ve el camarero

Al tocar el **nombre** de un producto (en lugar del botón +) se abre el diálogo
de extras, con dos bloques separados: *Modificaciones (sin coste)* y *Extras con
coste*, estos últimos mostrando su precio. Debajo, un campo de comentario libre
para lo que no esté previsto, y el selector de cantidad.

Si hay extras con coste seleccionados, aparece el cálculo antes de confirmar:
`18,00 € + 1,50 € de extras × 2 = 39,00 €`.

## Cómo se guarda (y por qué así)

Cuando se envía la ronda, `lineas_comanda.precio_unitario` guarda **el precio del
producto más sus extras con coste**. El detalle de cada extra (nombre y precio
del momento) va aparte, en la tabla `linea_extras`.

Esta decisión es deliberada y tiene una consecuencia práctica muy grande: **todos
los cálculos de totales que ya existían siguen funcionando sin tocar una sola
consulta** — la cuenta, el resumen del turno, los informes de Excel, el desglose
de IVA y las facturas. Si en cambio los extras se guardaran solo aparte, habría
que sumarlos en cada una de esas consultas, y bastaría olvidarse de una para que
la caja no cuadrara.

Como con los productos, el nombre y el precio del extra se **congelan** en la
línea: si mañana subes el extra de queso a 2 €, los tickets de ayer siguen
mostrando lo que se cobró de verdad.

**IVA de los extras:** siguen el tipo del producto al que se aplican. Un extra de
queso sobre un plato al 10 % va al 10 %.

## Cómo sale impreso

**En cocina** — los extras en negrita bajo el producto, sin precios (al cocinero
el precio le da igual, necesita saber qué lleva y qué no):

```
2 x Entrecot
   >> Extra de queso
   >> Muy hecho
1 x Entrecot
```

**En el ticket de caja y en las facturas** — con distinción visual entre lo que
cuesta y lo que no:

```
2 x Entrecot               39.00
   + Extra de queso (1.50)
   · Muy hecho
1 x Entrecot               18.00
```

El `+` marca los extras con coste (ya incluidos en el importe de la línea) y el
`·` las modificaciones gratuitas.

## API

| Endpoint | Qué hace |
|---|---|
| `GET /extras` | Todos los extras con sus vínculos (para el panel) |
| `GET /extras/producto/:productoId` | Los aplicables a ese producto, ya resueltos con la herencia |
| `POST /extras` 🔒 | Crear |
| `PUT /extras/:id` 🔒 | Editar (reescribe los vínculos) |
| `DELETE /extras/:id` 🔒 | Baja lógica |

Al enviar una ronda, cada línea admite `extraIds: string[]`.

## Verificado en pruebas reales

- Herencia: «Sin gluten» colgado de *Comida* aparece en un Entrecot que está en
  *Carnes* (subcategoría). El Refresco, en *Bebidas*, no lo ve.
- Ámbito general: «Para compartir» aparece tanto en el Entrecot como en el Refresco.
- Vínculo a producto concreto: «Sin hielo» solo aparece en el Refresco.
- Validación: un extra específico sin asignar nada se rechaza.
- Precio: 2 Entrecots (18 €) con «Extra de queso» (+1,50) y «Muy hecho» (gratis)
  → línea a 19,50 € c/u = 39 €. Más un Entrecot sin extras = 18 €.
  **Total 57 €**, y la cuenta y el IVA cuadran con esa cifra.
- Impresión: comanda de cocina con los extras en negrita; ticket de caja con el
  `+ Extra de queso (1.50)` y el `· Muy hecho`.
