# Formato de los tickets

## Lo primero: un "ticket" es legalmente una factura simplificada

Desde el RD 1619/2012, en España **el ticket como tal ya no existe**: lo que se
entrega al cliente es una *factura simplificada*, y tiene requisitos legales
mínimos. En hostelería es válida hasta **3.000 € IVA incluido** (el límite
general son 400 €).

Esto significa que un papel que solo ponga «TOTAL: 37,50 €» **no cumple la ley**.
El ticket que tenía este proyecto antes de esta revisión no cumplía: le faltaban
el número correlativo, el NIF y el nombre del emisor.

### Datos obligatorios de una factura simplificada

| Dato | Dónde va en nuestro ticket |
|---|---|
| Nombre o razón social del emisor | Cabecera, en grande |
| NIF del emisor | Cabecera |
| Número y serie **correlativos** | Bajo «FACTURA SIMPLIFICADA» |
| Fecha de expedición | Línea de fecha y hora |
| Descripción de lo servido | Lista de productos |
| Tipo de IVA aplicado | Tabla de desglose |
| Importe total | TOTAL, en grande |

La dirección del emisor no es estrictamente obligatoria en la simplificada
(sí en la completa), pero se incluye porque es lo habitual y no cuesta nada.

## Cómo queda el ticket

```
      BAR LA ESQUINA S.L.
   Calle Mayor 1, 28001 Madrid
        NIF: B98765431
--------------------------------
FACTURA SIMPLIFICADA
SIM-2026/00001
Fecha: 06/08/2026   Hora: 21:34
Mesa 1 · Ana
--------------------------------
2 x Menu del dia           30.00
3 x Cerveza                 7.50
   muy fria
--------------------------------
IVA     BASE    CUOTA    TOTAL
10%     27.27    2.73    30.00
21%      6.20    1.30     7.50
--------------------------------
Base imponible             33.47
Total IVA                   4.03

      TOTAL: 37.50 EUR
(IVA incluido)
--------------------------------
Forma de pago: TARJETA
--------------------------------
     Gracias por su visita
      Conserve este ticket
```

Ancho fijo de **32 caracteres**, que es lo estándar en papel de 58 mm y también
cuadra en 80 mm.

## Las dos numeraciones

Hay **dos series independientes**, y es importante que lo sean: la ley exige que
cada serie sea correlativa y sin saltos por sí misma.

| Serie | Documento | Se genera |
|---|---|---|
| `SIM` (configurable) | Factura simplificada = ticket normal | Al liquidar la cuenta e imprimir el documento |
| `FAC` (configurable) | Factura completa a empresa | Solo si se elige empresa al cobrar |

Los pagos parciales no consumen número. El número se asigna al pago que liquida la cuenta y genera la factura simplificada, dentro de la transacción. Una factura completa a empresa usa su serie propia y no recibe además un número simplificado. El índice `UNIQUE` evita duplicados. Esto no implementa todavía la cadena de registros y el sistema de eventos del RD 1007/2023.

Se configuran en **Panel → Ajustes**: `fiscal_serie` (completas) y
`fiscal_serie_simplificada` (tickets).

## Factura completa a empresa

Cuando al cobrar se elige una empresa, el papel deja de ser un ticket y pasa a
ser una **factura completa**, que además de todo lo anterior lleva los datos
fiscales del destinatario (razón social, NIF y domicilio). Ver
[FACTURACION.md](../FACTURACION.md).

## Si faltan los datos fiscales

Si el admin todavía no ha rellenado razón social, NIF y dirección en Ajustes:

- La pantalla de cobro muestra el aviso «⚠ Faltan los datos fiscales».
- El ticket impreso sale en formato reducido (concepto y total), como
  salvaguarda para no dejar al cliente sin comprobante.
- Las facturas completas directamente no se pueden emitir.

## Veri*Factu y estado de conformidad

El reglamento exige registros, controles y datos en documentos. La implementación
de los requisitos de ComandasApp está pendiente:

- **Código QR obligatorio** en el ticket, legible y enlazando a la URL de
  verificación de la AEAT.
- **Mención «VERI\*FACTU»** en el documento cuando el sistema remite los
  registros a Hacienda.
- Por dentro: hash encadenado entre facturas, registro de eventos e
  inalterabilidad.

Fechas vigentes: **1 de enero de 2027** para contribuyentes del Impuesto sobre Sociedades y **1 de julio de 2027** para el resto de obligados. La modalidad Veri*Factu de envío a AEAT es una opción del sistema; la obligación aplicable y las sanciones dependen del caso y del papel del productor/usuario.

ComandasApp **no está certificada ni debe considerarse conforme al RD 1007/2023**. Faltan el hash encadenado y registro de eventos conforme a especificaciones AEAT, QR validado, declaración responsable del productor y gestión de rectificativas. La app impide imprimir una simplificada superior a 3.000 € IVA incluido.

*No es asesoramiento fiscal: confírmalo con tu gestor antes de usar esto en
producción, sobre todo los tipos de IVA de cada producto.*
