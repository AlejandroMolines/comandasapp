import { v4 as uuid } from "uuid";
import { db } from "../../db/connection.js";
import { getAjuste } from "../ajustes/routes.js";

const RESTAURANTE_ID = process.env.RESTAURANTE_ID ?? "restaurante-demo";

/**
 * Resuelve a qué PuntoDestino va un producto, en cascada:
 * 1. Destino específico del producto
 * 2. Destino de su categoría
 * 3. Destino de la categoría padre (subiendo hasta la raíz)
 * 4. null si no se encuentra nada -> el llamador debe avisar al admin
 */
export function resolverDestinoProducto(productoId: string): string | null {
  // Red de seguridad: aunque el endpoint de asignación ya rechaza las
  // impresoras de caja, aquí se vuelve a excluir. Si quedara una asignación
  // antigua en la base de datos (de antes de esa validación, o metida a mano),
  // NO queremos que un producto acabe imprimiéndose en la caja: es mejor que
  // salte el aviso de "producto sin destino" y el admin lo vea, que mandar la
  // comanda a un sitio donde nadie la va a leer.
  const destinoProducto = db
    .prepare(
      `SELECT pd.punto_destino_id FROM producto_destino pd
         JOIN puntos_destino d ON d.id = pd.punto_destino_id
        WHERE pd.producto_id = ? AND d.tipo != 'impresora_ticket'
        LIMIT 1`
    )
    .get(productoId) as { punto_destino_id: string } | undefined;
  if (destinoProducto) return destinoProducto.punto_destino_id;

  const producto = db
    .prepare(`SELECT categoria_id FROM productos WHERE id = ?`)
    .get(productoId) as { categoria_id: string } | undefined;
  if (!producto) return null;

  let categoriaId: string | null = producto.categoria_id;

  // Herencia por el árbol: si la categoría no tiene destino, se pregunta a su
  // padre, y así hasta la raíz. Así basta con configurar "Bebidas -> Barra"
  // para que lo hereden Refrescos, Cervezas, Vinos y todo lo que cuelgue.
  // Tope de 20 niveles por si alguien creara un ciclo de categorías.
  for (let nivel = 0; nivel < 20 && categoriaId; nivel++) {
    const destinoCategoria = db
      .prepare(
        `SELECT cd.punto_destino_id FROM categoria_destino cd
           JOIN puntos_destino d ON d.id = cd.punto_destino_id
          WHERE cd.categoria_id = ? AND d.tipo != 'impresora_ticket'
          LIMIT 1`
      )
      .get(categoriaId) as { punto_destino_id: string } | undefined;
    if (destinoCategoria) return destinoCategoria.punto_destino_id;

    const categoria = db
      .prepare(`SELECT categoria_padre_id FROM categorias WHERE id = ?`)
      .get(categoriaId) as { categoria_padre_id: string | null } | undefined;
    categoriaId = categoria?.categoria_padre_id ?? null;
  }

  return null;
}

export interface LineaEntrada {
  productoId: string;
  cantidad: number;
  notas?: string;
  /** ids de extras aplicados a esta línea (modificaciones y/o con coste) */
  extraIds?: string[];
}

/**
 * Crea una Ronda con sus líneas, resuelve el destino de cada línea,
 * y encola un ticket por cada punto de destino agrupando sus líneas.
 * Devuelve la ronda creada + avisos de productos sin destino configurado.
 */
export function crearRonda(
  comandaId: string,
  camareroId: string,
  lineas: LineaEntrada[],
  /**
   * false = SOLO GUARDAR: la ronda entra en la cuenta pero no sale papel.
   * Sirve para lo que el camarero sirve él mismo (una caña de la barra) o
   * para apuntar algo sin molestar a cocina. Guardar es siempre seguro;
   * imprimir implica guardar, nunca al revés.
   */
  imprimirRonda = true
) {
  const rondaId = uuid();
  const ahora = new Date().toISOString();
  const avisosSinDestino: string[] = [];

  // ¿Hay que imprimir esta comanda? Los pedidos para llevar se pueden
  // configurar para NO imprimirse (se registran solo para caja y conteo).
  const comanda = db
    .prepare(`SELECT tipo, mesa_id FROM comandas WHERE id = ?`)
    .get(comandaId) as { tipo: string; mesa_id: string | null } | undefined;
  // Se imprime solo si el camarero lo ha pedido Y el ajuste lo permite
  // (los pedidos para llevar pueden estar configurados para no imprimirse).
  const imprimir =
    imprimirRonda && (comanda?.tipo !== "llevar" || getAjuste("imprimir_llevar") !== "false");

  const insertRonda = db.prepare(
    `INSERT INTO rondas (id, comanda_id, camarero_id, estado, creado_en) VALUES (?, ?, ?, 'enviada', ?)`
  );
  const insertLinea = db.prepare(
    `INSERT INTO lineas_comanda
       (id, comanda_id, ronda_id, producto_id, cantidad, precio_unitario, notas, estado, impresora_resuelta_id, enviado_en)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'enviada', ?, ?)`
  );
  const getPrecio = db.prepare(`SELECT precio FROM productos WHERE id = ?`);
  const getExtra = db.prepare(`SELECT id, nombre, precio FROM extras WHERE id = ? AND restaurante_id = ?`);
  const insertLineaExtra = db.prepare(
    `INSERT INTO linea_extras (id, linea_id, extra_id, nombre, precio) VALUES (?, ?, ?, ?, ?)`
  );

  const lineasPorDestino = new Map<string, { lineaId: string; productoId: string; cantidad: number; notas?: string }[]>();

  const tx = db.transaction(() => {
    insertRonda.run(rondaId, comandaId, camareroId, ahora);

    // La mesa pasa a ocupada al enviarse la PRIMERA ronda, no al abrirla.
    if (comanda?.mesa_id) {
      db.prepare(`UPDATE mesas SET estado = 'ocupada' WHERE id = ?`).run(comanda.mesa_id);
    }

    for (const linea of lineas) {
      const producto = getPrecio.get(linea.productoId) as { precio: number } | undefined;
      if (!producto) throw new Error(`Producto ${linea.productoId} no existe`);

      const destinoId = resolverDestinoProducto(linea.productoId);
      const lineaId = uuid();

      // Extras: se leen aquí para sumar los que tengan coste. Los de precio 0
      // son modificaciones ("sin cebolla") y solo viajan al ticket.
      const extrasAplicados: { id: string; nombre: string; precio: number }[] = [];
      for (const extraId of linea.extraIds ?? []) {
        const ex = getExtra.get(extraId, RESTAURANTE_ID) as
          | { id: string; nombre: string; precio: number } | undefined;
        if (!ex) throw new Error(`El extra ${extraId} no existe`);
        extrasAplicados.push(ex);
      }
      const sumaExtras = extrasAplicados.reduce((a, e) => a + e.precio, 0);

      // DECISIÓN IMPORTANTE: precio_unitario guarda el precio del producto
      // MÁS sus extras. Así todos los cálculos de totales que ya existían
      // (cuenta, resumen, informes, facturas, IVA) siguen funcionando sin
      // tocar una sola consulta. El detalle de cada extra queda en
      // linea_extras para poder imprimirlo y auditarlo.
      const precioUnitario = Number((producto.precio + sumaExtras).toFixed(2));

      insertLinea.run(
        lineaId,
        comandaId,
        rondaId,
        linea.productoId,
        linea.cantidad,
        precioUnitario,
        linea.notas ?? null,
        destinoId,
        ahora
      );

      for (const ex of extrasAplicados) {
        insertLineaExtra.run(uuid(), lineaId, ex.id, ex.nombre, ex.precio);
      }

      if (!destinoId) {
        avisosSinDestino.push(linea.productoId);
        continue; // sin destino configurado: no se encola ticket, pero queda registrada
      }

      if (!lineasPorDestino.has(destinoId)) lineasPorDestino.set(destinoId, []);
      lineasPorDestino.get(destinoId)!.push({ lineaId, productoId: linea.productoId, cantidad: linea.cantidad, notas: linea.notas });
    }

    // Un ticket (una entrada en log_impresion) por destino, agrupando sus líneas.
    const insertLog = db.prepare(
      `INSERT INTO log_impresion (id, ronda_id, punto_destino_id, estado, intentos, creado_en)
       VALUES (?, ?, ?, 'pendiente', 0, ?)`
    );
    if (imprimir) {
      for (const destinoId of lineasPorDestino.keys()) {
        insertLog.run(uuid(), rondaId, destinoId, ahora);
      }
    }
  });

  tx();

  return { rondaId, avisosSinDestino, destinos: [...lineasPorDestino.keys()], impreso: imprimir };
}
