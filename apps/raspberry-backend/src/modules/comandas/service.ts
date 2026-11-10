import { v4 as uuid } from "uuid";
import { db } from "../../db/connection.js";
import { importeDescuento, r2, resumenCuenta } from "../../lib/cuenta.js";
import { getAjuste } from "../ajustes/routes.js";

/** Error de negocio con el HTTP que debe devolver la ruta. */
export class ErrorComanda extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

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
  imprimirRonda = true,
  /** UUID del cliente. Si ya existe, no se duplica la ronda (reintento offline). */
  rondaIdCliente?: string
) {
  if (rondaIdCliente) {
    const ya = db
      .prepare(`SELECT comanda_id FROM rondas WHERE id = ?`)
      .get(rondaIdCliente) as { comanda_id: string } | undefined;
    if (ya) {
      if (ya.comanda_id !== comandaId) {
        throw new ErrorComanda("Ese identificador de ronda pertenece a otra comanda", 409);
      }
      return {
        rondaId: rondaIdCliente,
        avisosSinDestino: [] as string[],
        destinos: [] as string[],
        impreso: false,
        duplicada: true,
      };
    }
  }

  const rondaId = rondaIdCliente ?? uuid();
  const ahora = new Date().toISOString();
  const avisosSinDestino: string[] = [];

  // ¿Hay que imprimir esta comanda? Los pedidos para llevar se pueden
  // configurar para NO imprimirse (se registran solo para caja y conteo).
  const comanda = db
    .prepare(`SELECT tipo, mesa_id, estado, restaurante_id FROM comandas WHERE id = ?`)
    .get(comandaId) as
    | { tipo: string; mesa_id: string | null; estado: string; restaurante_id: string }
    | undefined;
  if (!comanda || comanda.restaurante_id !== RESTAURANTE_ID) {
    throw new ErrorComanda("Comanda no encontrada", 404);
  }
  if (comanda.estado === "cerrada" || comanda.estado === "cancelada") {
    throw new ErrorComanda(`La comanda ya está ${comanda.estado}`, 409);
  }
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
  const getPrecio = db.prepare(
    `SELECT nombre, precio, disponible FROM productos WHERE id = ? AND restaurante_id = ?`
  );
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
      const producto = getPrecio.get(linea.productoId, RESTAURANTE_ID) as
        | { nombre: string; precio: number; disponible: number }
        | undefined;
      if (!producto) throw new ErrorComanda(`Producto ${linea.productoId} no existe`);
      if (!producto.disponible) throw new ErrorComanda(`${producto.nombre} está agotado`);

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

  return { rondaId, avisosSinDestino, destinos: [...lineasPorDestino.keys()], impreso: imprimir, duplicada: false };
}

/**
 * Anula una línea ya enviada (entera o en parte). La fila no se borra:
 * cocina ya pudo verla, y el histórico de ventas tiene que poder explicar
 * por qué no se cobró. Si el plato se había imprimido, se encola un aviso
 * de anulación al mismo destino.
 */
export function anularLinea(opts: {
  comandaId: string;
  lineaId: string;
  camareroId: string;
  motivo: string;
  cantidad?: number;
}) {
  const comanda = db
    .prepare(`SELECT id, estado, mesa_id, restaurante_id FROM comandas WHERE id = ?`)
    .get(opts.comandaId) as
    | { id: string; estado: string; mesa_id: string | null; restaurante_id: string }
    | undefined;
  if (!comanda || comanda.restaurante_id !== RESTAURANTE_ID) {
    throw new ErrorComanda("Comanda no encontrada", 404);
  }
  if (comanda.estado === "cerrada" || comanda.estado === "cancelada") {
    throw new ErrorComanda(`La comanda ya está ${comanda.estado}`, 409);
  }

  const linea = db
    .prepare(`SELECT * FROM lineas_comanda WHERE id = ? AND comanda_id = ?`)
    .get(opts.lineaId, opts.comandaId) as
    | {
        id: string;
        comanda_id: string;
        ronda_id: string;
        producto_id: string;
        cantidad: number;
        precio_unitario: number;
        notas: string | null;
        impresora_resuelta_id: string | null;
        enviado_en: string | null;
        anulada: number;
      }
    | undefined;
  if (!linea) throw new ErrorComanda("Línea no encontrada", 404);
  if (linea.anulada) throw new ErrorComanda("Esa línea ya está anulada", 409);

  const cantidad = opts.cantidad ?? linea.cantidad;
  if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > linea.cantidad) {
    throw new ErrorComanda("Cantidad a anular no válida");
  }

  const cuenta = resumenCuenta(opts.comandaId);
  const nuevoBruto = r2(cuenta.bruto - cantidad * linea.precio_unitario);
  const nuevoTotal = r2(Math.max(0, nuevoBruto - importeDescuento(nuevoBruto, cuenta.descuentoTipo, cuenta.descuentoValor)));
  if (nuevoTotal + 0.01 < cuenta.pagado) {
    throw new ErrorComanda("No se puede anular: ya se ha cobrado más de lo que quedaría en la cuenta");
  }

  const ahora = new Date().toISOString();
  let lineaAnuladaId = linea.id;

  const tx = db.transaction(() => {
    if (cantidad === linea.cantidad) {
      db.prepare(
        `UPDATE lineas_comanda
            SET anulada = 1, motivo_anulacion = ?, anulada_en = ?, anulada_por = ?, estado = 'anulada'
          WHERE id = ?`
      ).run(opts.motivo, ahora, opts.camareroId, linea.id);
    } else {
      db.prepare(`UPDATE lineas_comanda SET cantidad = ? WHERE id = ?`).run(linea.cantidad - cantidad, linea.id);
      lineaAnuladaId = uuid();
      db.prepare(
        `INSERT INTO lineas_comanda
           (id, comanda_id, ronda_id, producto_id, cantidad, precio_unitario, notas, estado,
            impresora_resuelta_id, enviado_en, anulada, motivo_anulacion, anulada_en, anulada_por)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'anulada', ?, ?, 1, ?, ?, ?)`
      ).run(
        lineaAnuladaId,
        linea.comanda_id,
        linea.ronda_id,
        linea.producto_id,
        cantidad,
        linea.precio_unitario,
        linea.notas,
        linea.impresora_resuelta_id,
        linea.enviado_en,
        opts.motivo,
        ahora,
        opts.camareroId
      );
      const extras = db
        .prepare(`SELECT extra_id, nombre, precio FROM linea_extras WHERE linea_id = ?`)
        .all(linea.id) as { extra_id: string | null; nombre: string; precio: number }[];
      const ins = db.prepare(
        `INSERT INTO linea_extras (id, linea_id, extra_id, nombre, precio) VALUES (?, ?, ?, ?, ?)`
      );
      for (const ex of extras) ins.run(uuid(), lineaAnuladaId, ex.extra_id, ex.nombre, ex.precio);
    }

    // Solo se avisa a cocina si el papel de esa ronda llegó a salir (o a encolarse).
    if (linea.impresora_resuelta_id) {
      const seImprimio = db
        .prepare(
          `SELECT 1 FROM log_impresion
            WHERE ronda_id = ? AND punto_destino_id = ? AND COALESCE(es_anulacion, 0) = 0
            LIMIT 1`
        )
        .get(linea.ronda_id, linea.impresora_resuelta_id);
      if (seImprimio) {
        db.prepare(
          `INSERT INTO log_impresion
             (id, ronda_id, punto_destino_id, estado, intentos, creado_en, es_anulacion, linea_anulada_id)
           VALUES (?, ?, ?, 'pendiente', 0, ?, 1, ?)`
        ).run(uuid(), linea.ronda_id, linea.impresora_resuelta_id, ahora, lineaAnuladaId);
      }
    }

    const quedan = db
      .prepare(
        `SELECT 1 FROM lineas_comanda WHERE comanda_id = ? AND COALESCE(anulada, 0) = 0 LIMIT 1`
      )
      .get(opts.comandaId);
    if (!quedan && comanda.mesa_id) {
      db.prepare(`UPDATE mesas SET estado = 'libre' WHERE id = ?`).run(comanda.mesa_id);
    }
  });
  tx();

  return { lineaId: lineaAnuladaId, ...resumenCuenta(opts.comandaId) };
}

export function aplicarDescuento(
  comandaId: string,
  tipo: "porcentaje" | "importe" | "ninguno",
  valor: number,
  motivo: string | null
) {
  const comanda = db
    .prepare(`SELECT estado, restaurante_id FROM comandas WHERE id = ?`)
    .get(comandaId) as { estado: string; restaurante_id: string } | undefined;
  if (!comanda || comanda.restaurante_id !== RESTAURANTE_ID) {
    throw new ErrorComanda("Comanda no encontrada", 404);
  }
  if (comanda.estado === "cerrada" || comanda.estado === "cancelada") {
    throw new ErrorComanda(`La comanda ya está ${comanda.estado}`, 409);
  }
  if (tipo === "porcentaje" && (valor <= 0 || valor > 100)) {
    throw new ErrorComanda("El porcentaje tiene que estar entre 0 y 100");
  }
  if (tipo === "importe" && valor <= 0) {
    throw new ErrorComanda("El importe del descuento no es válido");
  }

  if (tipo === "ninguno") {
    db.prepare(
      `UPDATE comandas SET descuento_tipo = NULL, descuento_valor = 0, descuento_motivo = NULL WHERE id = ?`
    ).run(comandaId);
    return resumenCuenta(comandaId);
  }

  const cuenta = resumenCuenta(comandaId);
  const descuento = importeDescuento(cuenta.bruto, tipo, valor);
  if (r2(cuenta.bruto - descuento) + 0.01 < cuenta.pagado) {
    throw new ErrorComanda("El descuento dejaría la cuenta por debajo de lo ya cobrado");
  }
  db.prepare(
    `UPDATE comandas SET descuento_tipo = ?, descuento_valor = ?, descuento_motivo = ? WHERE id = ?`
  ).run(tipo, valor, motivo, comandaId);
  return resumenCuenta(comandaId);
}

/** Cierra una comanda ya saldada (también la de importe 0, tras anularlo todo). */
export function cerrarSiSaldada(comandaId: string) {
  const comanda = db
    .prepare(`SELECT estado, mesa_id, restaurante_id FROM comandas WHERE id = ?`)
    .get(comandaId) as
    | { estado: string; mesa_id: string | null; restaurante_id: string }
    | undefined;
  if (!comanda || comanda.restaurante_id !== RESTAURANTE_ID) {
    throw new ErrorComanda("Comanda no encontrada", 404);
  }
  if (comanda.estado === "cerrada" || comanda.estado === "cancelada") {
    throw new ErrorComanda(`La comanda ya está ${comanda.estado}`, 409);
  }
  const cuenta = resumenCuenta(comandaId);
  if (cuenta.pendiente > 0.01) {
    throw new ErrorComanda(`Quedan ${cuenta.pendiente.toFixed(2)} € por cobrar`);
  }
  const ahora = new Date().toISOString();
  db.prepare(`UPDATE comandas SET estado = 'cerrada', cerrado_en = ? WHERE id = ?`).run(ahora, comandaId);
  if (comanda.mesa_id) {
    db.prepare(`UPDATE mesas SET estado = 'libre' WHERE id = ?`).run(comanda.mesa_id);
  }
  return { cerrada: true, mesaId: comanda.mesa_id };
}
