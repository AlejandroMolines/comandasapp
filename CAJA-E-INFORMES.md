# Caja inicial fija e informes en Excel

## La caja inicial ya NO se arrastra

Antes, al cerrar un turno, el efectivo contado pasaba a ser la caja inicial del
siguiente. Eso era incorrecto: **el fondo de caja es un valor fijo** que decide el
admin, no algo que cambie según lo que hubiera en el cajón esa noche.

Ahora se guarda como ajuste (`caja_inicial_fija`) y todos los turnos nacen con ese
valor. Si pones 100 €, todos los turnos empiezan con 100 € por más turnos que pasen,
hasta que lo cambies a mano en **Turnos → Fondo de caja fijo**.

**Verificado**: fondo puesto a 100 €, se venden 50 € en efectivo y se cierra contando
250 € (descuadre +100). El turno siguiente nace con **100 €**, no con 250. Segundo
cierre contando 999 € → el turno siguiente sigue naciendo con **100 €**.

## Cerrar turno desde el Resumen

Ahora se puede cerrar el turno desde la propia pantalla de Resumen (además de desde
Turnos). El diálogo recuerda la caja inicial del turno, pide el efectivo contado y
muestra el ticket de cierre con el descuadre.

También se ha añadido **Caja inicial** como primera estadística del resumen.

## Descarga de informes en Excel

Botones en Resumen → *Descargar informe en Excel*, con las tres granularidades:

- **Diario**: hoy, ayer
- **Semanal**: esta semana día a día (semana de lunes a domingo, como se cuenta en España)
- **Mensual**: este mes día a día, mes pasado, o este mes agrupado por semanas

El `.xlsx` se genera en el navegador con SheetJS, no en el Raspberry: así la Pi no gasta
recursos y funciona igual sin internet. Contiene cinco hojas:

1. **Ingresos** — por periodo, desglosado en efectivo / tarjeta / otros, con comandas,
   mesas, pedidos para llevar, propinas y ticket medio, más fila de totales.
2. **Cierres de caja** — fecha, hora de apertura y cierre, **caja inicial**, efectivo
   cobrado, efectivo esperado, caja contada y descuadre.
3. **IVA** — base y cuota por cada tipo (10 % / 21 %), lo que hace falta para el trimestre.
4. **Productos** — unidades e importe por producto, con su tipo de IVA.
5. **Facturas** — las emitidas a empresas en el periodo (solo aparece si hay alguna).

Endpoint que lo alimenta:
`GET /turnos/informe?desde=&hasta=&agrupacion=dia|semana|mes`

Se agrupa por la fecha del **pago**, no del turno, porque es lo que cuadra con la
contabilidad: lo que entró en caja ese día.

### Verificado en pruebas reales

- Informe de un día con 50 € en efectivo + 10 € en tarjeta = 60 €, 2 comandas,
  ticket medio 30 €.
- Los dos cierres de caja del día aparecen con su caja inicial (100 € cada uno),
  efectivo cobrado, esperado, contado y descuadre.
- Desglose de IVA: 10 refrescos de 1 € al 10 % → base 9,09 + cuota 0,91.
  25 cervezas de 2 € al 21 % → base 41,32 + cuota 8,68.
