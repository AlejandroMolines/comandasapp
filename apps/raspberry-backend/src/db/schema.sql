-- Este Raspberry sirve a UN restaurante, pero guardamos restaurante_id
-- desde el día 1 para que el modelo sea idéntico al del Cloud (multi-tenant).

CREATE TABLE IF NOT EXISTS restaurantes (
  id TEXT PRIMARY KEY,
  nombre TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  creado_en TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS usuarios (
  id TEXT PRIMARY KEY,
  restaurante_id TEXT NOT NULL,
  nombre TEXT NOT NULL,
  rol TEXT NOT NULL CHECK (rol IN ('admin','camarero')),
  pin_hash TEXT NOT NULL,
  activo INTEGER NOT NULL DEFAULT 1,
  creado_en TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ajustes (
  restaurante_id TEXT NOT NULL,
  clave TEXT NOT NULL,
  valor TEXT NOT NULL,
  PRIMARY KEY (restaurante_id, clave)
);

-- ---------------------------------------------------------------------------
-- FACTURACIÓN A EMPRESAS
-- Un ticket normal es una "factura simplificada" (válida en hostelería hasta
-- 3.000 € IVA incluido). Cuando el cliente paga con tarjeta de empresa y
-- necesita deducir el IVA, hace falta una FACTURA COMPLETA, que según el
-- RD 1619/2012 exige: número correlativo dentro de una serie, fecha, datos
-- fiscales completos de emisor Y destinatario, base imponible, tipo y cuota
-- de IVA desglosados, y total.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS empresas (
  id TEXT PRIMARY KEY,
  restaurante_id TEXT NOT NULL REFERENCES restaurantes(id),
  razon_social TEXT NOT NULL,
  nif TEXT NOT NULL,
  direccion TEXT NOT NULL,
  codigo_postal TEXT,
  ciudad TEXT,
  provincia TEXT,
  pais TEXT NOT NULL DEFAULT 'España',
  email TEXT,
  telefono TEXT,
  persona_contacto TEXT,
  notas TEXT,
  activo INTEGER NOT NULL DEFAULT 1,
  creado_en TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_empresas_nif ON empresas(restaurante_id, nif);

CREATE TABLE IF NOT EXISTS facturas (
  id TEXT PRIMARY KEY,
  restaurante_id TEXT NOT NULL REFERENCES restaurantes(id),
  -- Numeración: serie + número correlativo SIN SALTOS por ejercicio.
  serie TEXT NOT NULL,
  numero INTEGER NOT NULL,
  ejercicio INTEGER NOT NULL,
  empresa_id TEXT NOT NULL REFERENCES empresas(id),
  comanda_id TEXT REFERENCES comandas(id),
  pago_id TEXT REFERENCES pagos(id),
  fecha_expedicion TEXT NOT NULL,
  -- Datos del EMISOR congelados en el momento de emitir: si el restaurante
  -- cambia de dirección, las facturas viejas deben seguir mostrando la de
  -- entonces (son documentos fiscales inmutables).
  emisor_razon_social TEXT NOT NULL,
  emisor_nif TEXT NOT NULL,
  emisor_direccion TEXT NOT NULL,
  -- Datos del DESTINATARIO igualmente congelados.
  cliente_razon_social TEXT NOT NULL,
  cliente_nif TEXT NOT NULL,
  cliente_direccion TEXT NOT NULL,
  base_imponible REAL NOT NULL,
  cuota_iva REAL NOT NULL,
  total REAL NOT NULL,
  -- Desglose por tipo de IVA en JSON: [{tipo:10, base:20.0, cuota:2.0}, ...]
  desglose_iva TEXT NOT NULL,
  metodo_pago TEXT,
  anulada INTEGER NOT NULL DEFAULT 0,
  creado_en TEXT NOT NULL,
  UNIQUE (restaurante_id, serie, ejercicio, numero)
);

CREATE INDEX IF NOT EXISTS idx_facturas_empresa ON facturas(empresa_id);

CREATE TABLE IF NOT EXISTS zonas (
  id TEXT PRIMARY KEY,
  restaurante_id TEXT NOT NULL,
  nombre TEXT NOT NULL,
  orden INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS mesas (
  id TEXT PRIMARY KEY,
  restaurante_id TEXT NOT NULL,
  zona_id TEXT NOT NULL REFERENCES zonas(id),
  nombre TEXT NOT NULL,
  capacidad INTEGER NOT NULL DEFAULT 4,
  estado TEXT NOT NULL DEFAULT 'libre' CHECK (estado IN ('libre','ocupada','reservada'))
);

CREATE TABLE IF NOT EXISTS menus (
  id TEXT PRIMARY KEY,
  restaurante_id TEXT NOT NULL,
  nombre TEXT NOT NULL,
  orden INTEGER NOT NULL DEFAULT 0,
  activo INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS categorias (
  id TEXT PRIMARY KEY,
  restaurante_id TEXT NOT NULL,
  menu_id TEXT NOT NULL REFERENCES menus(id),
  categoria_padre_id TEXT REFERENCES categorias(id),
  nombre TEXT NOT NULL,
  orden INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS productos (
  id TEXT PRIMARY KEY,
  restaurante_id TEXT NOT NULL,
  categoria_id TEXT NOT NULL REFERENCES categorias(id),
  nombre TEXT NOT NULL,
  precio REAL NOT NULL,
  descripcion TEXT,
  disponible INTEGER NOT NULL DEFAULT 1,
  orden INTEGER NOT NULL DEFAULT 0,
  -- IVA aplicable. En hostelería: 10% comida y bebida sin alcohol,
  -- 21% bebidas alcohólicas. El precio de carta SIEMPRE es con IVA
  -- incluido (obligatorio de cara al consumidor), así que la base se
  -- calcula hacia atrás: base = precio / (1 + tipo/100).
  tipo_iva REAL NOT NULL DEFAULT 10
);

-- ---------------------------------------------------------------------------
-- EXTRAS Y MODIFICACIONES
-- Dos casos distintos que conviven en la misma tabla:
--   · Modificación sin coste (precio = 0): "sin cebolla", "muy hecho".
--   · Extra con coste (precio > 0): "extra de queso +1,50".
-- Y dos ámbitos:
--   · general: aplicable a cualquier producto (p.ej. "para compartir").
--   · especifico: solo a los productos/categorías a los que se vincula
--     (p.ej. "sin hielo" solo en bebidas, "punto de la carne" solo en carnes).
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS extras (
  id TEXT PRIMARY KEY,
  restaurante_id TEXT NOT NULL REFERENCES restaurantes(id),
  nombre TEXT NOT NULL,
  -- 0 = modificación gratuita. > 0 = se suma al precio de la línea.
  precio REAL NOT NULL DEFAULT 0,
  ambito TEXT NOT NULL DEFAULT 'especifico' CHECK (ambito IN ('general','especifico')),
  -- Agrupador opcional para la interfaz ("Punto de la carne", "Salsas"...).
  grupo TEXT,
  activo INTEGER NOT NULL DEFAULT 1,
  orden INTEGER NOT NULL DEFAULT 0,
  creado_en TEXT NOT NULL
);

-- Vínculos del ámbito 'especifico'. Un extra puede colgar de productos
-- concretos y/o de categorías enteras (hereda a sus subcategorías).
CREATE TABLE IF NOT EXISTS extra_producto (
  extra_id TEXT NOT NULL REFERENCES extras(id) ON DELETE CASCADE,
  producto_id TEXT NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
  PRIMARY KEY (extra_id, producto_id)
);

CREATE TABLE IF NOT EXISTS extra_categoria (
  extra_id TEXT NOT NULL REFERENCES extras(id) ON DELETE CASCADE,
  categoria_id TEXT NOT NULL REFERENCES categorias(id) ON DELETE CASCADE,
  PRIMARY KEY (extra_id, categoria_id)
);

-- Extras aplicados a una línea concreta. Se guarda el NOMBRE y el PRECIO
-- del momento (snapshot), igual que con los productos: si mañana sube el
-- extra de queso, los tickets viejos siguen siendo fieles.
CREATE TABLE IF NOT EXISTS linea_extras (
  id TEXT PRIMARY KEY,
  linea_id TEXT NOT NULL REFERENCES lineas_comanda(id) ON DELETE CASCADE,
  extra_id TEXT REFERENCES extras(id),
  nombre TEXT NOT NULL,
  precio REAL NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_linea_extras ON linea_extras(linea_id);

CREATE TABLE IF NOT EXISTS puntos_destino (
  id TEXT PRIMARY KEY,
  restaurante_id TEXT NOT NULL,
  nombre TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('impresora_termica','pantalla_kds','impresora_ticket')),
  protocolo TEXT NOT NULL CHECK (protocolo IN ('escpos_red','escpos_usb','websocket_kds','api_generica')),
  config TEXT NOT NULL DEFAULT '{}', -- JSON
  estado_salud TEXT NOT NULL DEFAULT 'desconocido',
  ultimo_visto_en TEXT
);

CREATE TABLE IF NOT EXISTS producto_destino (
  producto_id TEXT NOT NULL REFERENCES productos(id),
  punto_destino_id TEXT NOT NULL REFERENCES puntos_destino(id),
  PRIMARY KEY (producto_id, punto_destino_id)
);

CREATE TABLE IF NOT EXISTS categoria_destino (
  categoria_id TEXT NOT NULL REFERENCES categorias(id),
  punto_destino_id TEXT NOT NULL REFERENCES puntos_destino(id),
  PRIMARY KEY (categoria_id, punto_destino_id)
);

CREATE TABLE IF NOT EXISTS turnos (
  id TEXT PRIMARY KEY,
  restaurante_id TEXT NOT NULL,
  usuario_apertura_id TEXT NOT NULL REFERENCES usuarios(id),
  abierto_en TEXT NOT NULL,
  cerrado_en TEXT,
  caja_inicial REAL NOT NULL DEFAULT 0,
  caja_final REAL
);

CREATE TABLE IF NOT EXISTS comandas (
  id TEXT PRIMARY KEY,
  restaurante_id TEXT NOT NULL,
  turno_id TEXT NOT NULL REFERENCES turnos(id),
  mesa_id TEXT REFERENCES mesas(id),
  tipo TEXT NOT NULL CHECK (tipo IN ('mesa','llevar','domicilio')),
  camarero_id TEXT NOT NULL REFERENCES usuarios(id),
  estado TEXT NOT NULL DEFAULT 'abierta' CHECK (estado IN ('abierta','en_cocina','servida','cerrada','cancelada')),
  creado_en TEXT NOT NULL,
  cerrado_en TEXT
);

CREATE TABLE IF NOT EXISTS rondas (
  id TEXT PRIMARY KEY,
  comanda_id TEXT NOT NULL REFERENCES comandas(id),
  camarero_id TEXT NOT NULL REFERENCES usuarios(id),
  estado TEXT NOT NULL DEFAULT 'pendiente_envio',
  creado_en TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS lineas_comanda (
  id TEXT PRIMARY KEY,
  comanda_id TEXT NOT NULL REFERENCES comandas(id),
  ronda_id TEXT NOT NULL REFERENCES rondas(id),
  producto_id TEXT NOT NULL REFERENCES productos(id),
  cantidad INTEGER NOT NULL DEFAULT 1,
  precio_unitario REAL NOT NULL,
  notas TEXT,
  estado TEXT NOT NULL DEFAULT 'pendiente',
  impresora_resuelta_id TEXT REFERENCES puntos_destino(id),
  enviado_en TEXT
);

CREATE TABLE IF NOT EXISTS pagos (
  id TEXT PRIMARY KEY,
  comanda_id TEXT NOT NULL REFERENCES comandas(id),
  metodo TEXT NOT NULL CHECK (metodo IN ('efectivo','tarjeta','otro')),
  importe REAL NOT NULL,
  propina REAL NOT NULL DEFAULT 0,
  impresora_ticket_id TEXT REFERENCES puntos_destino(id),
  creado_en TEXT NOT NULL,
  -- Numeración de FACTURA SIMPLIFICADA (lo que llamamos "ticket").
  -- Obligatoria por el RD 1619/2012: todo ticket entregado al cliente es
  -- legalmente una factura simplificada y necesita serie + número correlativo.
  serie_simpl TEXT,
  numero_simpl INTEGER,
  ejercicio_simpl INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pagos_simpl
  ON pagos(serie_simpl, ejercicio_simpl, numero_simpl)
  WHERE numero_simpl IS NOT NULL;

CREATE TABLE IF NOT EXISTS log_impresion (
  id TEXT PRIMARY KEY,
  ronda_id TEXT,
  pago_id TEXT,
  punto_destino_id TEXT NOT NULL REFERENCES puntos_destino(id),
  estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','ok','error_definitivo')),
  intentos INTEGER NOT NULL DEFAULT 0,
  ultimo_error TEXT,
  creado_en TEXT NOT NULL,
  ultimo_intento_en TEXT,
  -- Marca de reimpresión. Legalmente NO se puede emitir dos veces el mismo
  -- número de factura como original: la segunda copia debe salir identificada
  -- como COPIA / DUPLICADO.
  es_copia INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS eventos_sync (
  id TEXT PRIMARY KEY,
  restaurante_id TEXT NOT NULL,
  tipo TEXT NOT NULL,
  entidad_id TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  payload TEXT NOT NULL, -- JSON
  creado_en TEXT NOT NULL,
  origen_dispositivo_id TEXT,
  sincronizado INTEGER NOT NULL DEFAULT 0
);
