-- =============================================================================
-- 02 · Esquema local del nodo (fragmentos horizontales + réplica del catálogo).
-- Cada predicado de fragmentación se materializa como restricción CHECK:
-- el propio gestor impide guardar una fila que pertenece a otro fragmento.
-- Variables psql: :nodo_num, :nodo_cod, :deptos  (ej. deptos = 'TJ','CH')
-- =============================================================================

-- Rango exclusivo de identificadores por nodo: unicidad global sin coordinación.
-- Nodo 4 → 4 000 000 001, 4 000 000 002, ...
SELECT :nodo_num::bigint * 1000000000 + 1 AS id_base \gset

-- Réplica total (maestro en el Nodo 1). Sin identidad: el id lo asigna La Paz.
CREATE TABLE productos_catalogo (
    id_producto     INT           PRIMARY KEY,
    codigo_barras   VARCHAR(13)   NOT NULL UNIQUE,
    nombre          VARCHAR(120)  NOT NULL,
    descripcion     TEXT,
    precio_unitario NUMERIC(10,2) NOT NULL CHECK (precio_unitario > 0),
    categoria       VARCHAR(40)   NOT NULL
);

-- Fragmento FC1 (vertical: datos públicos) + horizontal por departamento.
CREATE TABLE clientes_datos_generales (
    id_cliente      BIGINT GENERATED ALWAYS AS IDENTITY (START WITH :id_base) PRIMARY KEY,
    nit_ci          VARCHAR(20)  NOT NULL,
    razon_social    VARCHAR(150) NOT NULL,
    telefono        VARCHAR(20),
    direccion       VARCHAR(200),
    departamento_id CHAR(2)      NOT NULL
        CONSTRAINT ck_clientes_fragmento CHECK (departamento_id IN (:deptos))
);

-- Fragmento FA (horizontal primario). El id del almacén codifica su nodo: 4xx → Nodo 4.
CREATE TABLE almacenes (
    id_almacen      INT          PRIMARY KEY
        CONSTRAINT ck_almacenes_nodo CHECK (id_almacen / 100 = :nodo_num),
    nombre_almacen  VARCHAR(80)  NOT NULL,
    departamento_id CHAR(2)      NOT NULL
        CONSTRAINT ck_almacenes_fragmento CHECK (departamento_id IN (:deptos)),
    direccion       VARCHAR(200)
);

-- Fragmento FI (horizontal derivado: INVENTARIO ⋉ ALMACENES).
CREATE TABLE inventario (
    id_almacen   INT NOT NULL REFERENCES almacenes,
    id_producto  INT NOT NULL REFERENCES productos_catalogo,
    stock_actual INT NOT NULL CHECK (stock_actual >= 0),  -- última defensa contra stock negativo
    stock_minimo INT NOT NULL DEFAULT 0 CHECK (stock_minimo >= 0),
    PRIMARY KEY (id_almacen, id_producto)
);

-- Fragmento FV (horizontal primario por departamento_id).
CREATE TABLE ventas (
    id_venta        BIGINT GENERATED ALWAYS AS IDENTITY (START WITH :id_base) PRIMARY KEY,
    fecha_hora      TIMESTAMPTZ   NOT NULL DEFAULT now(),
    departamento_id CHAR(2)       NOT NULL
        CONSTRAINT ck_ventas_fragmento CHECK (departamento_id IN (:deptos)),
    id_cliente      BIGINT        NOT NULL REFERENCES clientes_datos_generales,
    id_empleado     INT           NOT NULL,
    total_bs        NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (total_bs >= 0)
);

-- Fragmento FDV (horizontal derivado: DETALLE_VENTA ⋉ VENTAS).
CREATE TABLE detalle_venta (
    id_detalle      BIGINT GENERATED ALWAYS AS IDENTITY (START WITH :id_base) PRIMARY KEY,
    id_venta        BIGINT        NOT NULL REFERENCES ventas ON DELETE CASCADE,
    id_producto     INT           NOT NULL REFERENCES productos_catalogo,
    cantidad        INT           NOT NULL CHECK (cantidad > 0),
    precio_aplicado NUMERIC(10,2) NOT NULL CHECK (precio_aplicado > 0),
    subtotal        NUMERIC(12,2) GENERATED ALWAYS AS (cantidad * precio_aplicado) STORED
);

CREATE INDEX ix_ventas_fecha       ON ventas (fecha_hora);
CREATE INDEX ix_ventas_cliente     ON ventas (id_cliente);
CREATE INDEX ix_detalle_venta      ON detalle_venta (id_venta);
CREATE INDEX ix_detalle_producto   ON detalle_venta (id_producto);
CREATE INDEX ix_inventario_prod    ON inventario (id_producto);
CREATE INDEX ix_clientes_nit       ON clientes_datos_generales (nit_ci);

-- Documentación del fragmento dentro del propio catálogo del gestor.
SELECT format('COMMENT ON TABLE ventas IS %L',
              format('Fragmento FV%s = σ departamento_id ∈ {%s} (VENTAS) — Nodo %s',
                     :nodo_num, :'deptos', :nodo_num)) \gexec
SELECT format('COMMENT ON TABLE clientes_datos_generales IS %L',
              format('Fragmento FC1 (π datos públicos) ∩ σ departamento_id ∈ {%s} — Nodo %s',
                     :'deptos', :nodo_num)) \gexec
COMMENT ON TABLE productos_catalogo IS 'Réplica total; maestro en el Nodo 1 (La Paz), replicación lógica asíncrona';
COMMENT ON TABLE inventario IS 'Fragmento derivado FI = INVENTARIO ⋉ id_almacen FA';
COMMENT ON TABLE detalle_venta IS 'Fragmento derivado FDV = DETALLE_VENTA ⋉ id_venta FV';
