# Facturación a empresas y mover mesas

## Facturación a empresas (comidas de trabajo)

Un ticket normal es una **factura simplificada** (válida en hostelería hasta
3.000 € IVA incluido). Cuando el cliente paga con tarjeta de empresa y necesita
deducir el IVA, hace falta una **factura completa**. Según el RD 1619/2012 exige:
número correlativo por serie **sin saltos**, fecha, datos fiscales de emisor **y**
destinatario (razón social, NIF, domicilio), descripción, y **desglose por tipo de IVA**
(base y cuota separadas).

### Qué se ha añadido

- **Sección Empresas** en el panel admin: alta y edición con formulario fiscal
  (los campos obligatorios por ley van marcados con \*), búsqueda por nombre o NIF,
  e historial de facturas por empresa. Baja lógica, nunca borrado físico: las
  facturas emitidas deben conservarse un mínimo de 4 años.
- **Validación del dígito de control** de NIF / CIF / NIE. No es un capricho: con un
  NIF mal escrito el cliente no puede deducir el IVA y la factura le sirve de nada,
  así que es mejor detectarlo al dar de alta la empresa que cuando su contable la
  rechace a fin de mes.
- **`tipo_iva` por producto** (10 % comida y refrescos, 21 % bebidas alcohólicas),
  editable desde la carta. El desglose se calcula *hacia atrás* porque el precio de
  carta se muestra siempre con IVA incluido: `base = precio / (1 + tipo/100)`.
- **Datos fiscales del restaurante** (emisor) en Ajustes, con aviso visible si faltan.
  Sin ellos no se pueden emitir facturas; los tickets normales siguen funcionando.
- Al cobrar: botón «Necesita factura de empresa» → buscador de empresas → el ticket
  en pantalla avisa a nombre de quién se va a emitir.
- **Formato impreso** de factura para papel de 80 mm, con el desglose de IVA por tipos.
- Los datos de emisor y cliente se **congelan** en cada factura: si el restaurante
  cambia de dirección, las facturas antiguas siguen mostrando la de entonces, como
  corresponde a un documento fiscal inmutable.

### Verificado en pruebas reales

- 2 menús de 15,00 € al 10 % + 1 vino de 12,10 € al 21 % → base 27,27 + 2,73 y
  base 10,00 + 2,10 → **base total 37,27 + IVA 4,83 = 42,10 €**. Cuadra al céntimo.
- Numeración `FAC-2026/00001` … `FAC-2026/00004` correlativa y sin saltos.
- Factura impresa comprobada en la impresora simulada, con todos los datos legales.

## PENDIENTE IMPORTANTE: Verifactu

Verifactu es obligatorio desde el **1 de enero de 2027** para sociedades y el
**1 de julio de 2027** para el resto de empresas y autónomos. Exige hash encadenado
entre facturas, código QR, registro de eventos del sistema e inalterabilidad de los
registros. La sanción por usar software no conforme es de **50.000 € por ejercicio**.

Lo implementado cumple el reglamento de facturación vigente, pero **todavía no es un
sistema Verifactu**: falta el encadenado criptográfico, el QR y el registro de eventos.
Hay margen hasta 2027, pero conviene tenerlo en el plan — sobre todo si el objetivo es
vender esto a otros restaurantes.

*Nota: esto no es asesoramiento fiscal. Antes de emitir facturas reales conviene
confirmar con un gestor, especialmente los tipos de IVA aplicados a cada producto.*

## Mover / unir mesas

`POST /comandas/:id/mover` con dos comportamientos según el destino:

- **Mesa libre** → la comanda entera cambia de mesa y la de origen se libera.
- **Mesa ocupada** → se **unen** las dos cuentas: las líneas, rondas y pagos parciales
  de la de origen pasan a la de destino, la de origen se marca como cancelada y su
  mesa queda libre.

Los precios y la impresora resuelta **no** se recalculan al mover: son un snapshot
histórico de lo que ya se pidió y se imprimió.

En la app: botón de mover en la cabecera de la comanda → selección de zona → mesas en
**verde** (libres) o **rojo** (unirán cuentas) → confirmación explícita, con texto
distinto para mover o para unir, porque unir cuentas no se puede deshacer.

### Verificado en pruebas reales

- Mover a mesa libre: conserva las 2 líneas y los 42,10 €, mesa origen pasa a libre
  y la destino a ocupada.
- Unir: 24,20 € + 42,10 € → **66,30 € en 3 líneas** en la comanda de destino, la de
  origen queda cancelada y su mesa liberada.
