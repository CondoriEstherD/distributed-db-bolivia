-- =============================================================================
-- Nodo 1 (La Paz) · transparencia de localización y fragmentación (idempotente).
--
-- VENTAS y CLIENTES (FC1) se reconstruyen como tablas PARTICIONADAS por LIST
-- (departamento_id): la partición de La Paz es la tabla local y las demás son
-- tablas foráneas (postgres_fdw) que apuntan al fragmento de cada nodo.
-- Es la definición formal  VENTAS = FV1 ∪ FV2 ∪ ... ∪ FV6  hecha objeto del gestor,
-- y permite al planificador descartar fragmentos (partition pruning).
--
-- Variables psql: :h_sc :p_sc :h_cb :p_cb :h_tj :p_tj :h_or :p_or :h_be :p_be :app_password
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS postgres_fdw;

-- Re-ejecución segura: separar los fragmentos LOCALES antes de borrar el esquema
-- global (borrar una tabla particionada borra también sus particiones).
DO $$
BEGIN
    IF to_regclass('nacional.ventas_nacionales') IS NOT NULL THEN
        ALTER TABLE nacional.ventas_nacionales DETACH PARTITION public.ventas;
    END IF;
    IF to_regclass('nacional.clientes_nacionales') IS NOT NULL THEN
        ALTER TABLE nacional.clientes_nacionales DETACH PARTITION public.clientes_datos_generales;
    END IF;
END $$;
DROP SCHEMA IF EXISTS nacional CASCADE;
DROP SERVER IF EXISTS srv_sc, srv_cb, srv_tj, srv_or, srv_be CASCADE;

-- ---------------------------------------------------------------- servidores
-- connect_timeout / tcp_user_timeout: un nodo caído se detecta en segundos.
-- async_capable: los fragmentos remotos se consultan EN PARALELO.
CREATE SERVER srv_sc FOREIGN DATA WRAPPER postgres_fdw OPTIONS (host :'h_sc', port :'p_sc', dbname 'bd_sc',
    connect_timeout '3', tcp_user_timeout '5000', async_capable 'true', fetch_size '5000');
CREATE SERVER srv_cb FOREIGN DATA WRAPPER postgres_fdw OPTIONS (host :'h_cb', port :'p_cb', dbname 'bd_cb',
    connect_timeout '3', tcp_user_timeout '5000', async_capable 'true', fetch_size '5000');
CREATE SERVER srv_tj FOREIGN DATA WRAPPER postgres_fdw OPTIONS (host :'h_tj', port :'p_tj', dbname 'bd_tj',
    connect_timeout '3', tcp_user_timeout '5000', async_capable 'true', fetch_size '5000');
CREATE SERVER srv_or FOREIGN DATA WRAPPER postgres_fdw OPTIONS (host :'h_or', port :'p_or', dbname 'bd_or',
    connect_timeout '3', tcp_user_timeout '5000', async_capable 'true', fetch_size '5000');
CREATE SERVER srv_be FOREIGN DATA WRAPPER postgres_fdw OPTIONS (host :'h_be', port :'p_be', dbname 'bd_be',
    connect_timeout '3', tcp_user_timeout '5000', async_capable 'true', fetch_size '5000');

-- Todas las lecturas remotas usan el rol de solo lectura fdw_lector.
CREATE USER MAPPING FOR PUBLIC SERVER srv_sc OPTIONS (user 'fdw_lector', password :'app_password');
CREATE USER MAPPING FOR PUBLIC SERVER srv_cb OPTIONS (user 'fdw_lector', password :'app_password');
CREATE USER MAPPING FOR PUBLIC SERVER srv_tj OPTIONS (user 'fdw_lector', password :'app_password');
CREATE USER MAPPING FOR PUBLIC SERVER srv_or OPTIONS (user 'fdw_lector', password :'app_password');
CREATE USER MAPPING FOR PUBLIC SERVER srv_be OPTIONS (user 'fdw_lector', password :'app_password');

-- ---------------------------------------------------------------- esquema global
CREATE SCHEMA nacional;
COMMENT ON SCHEMA nacional IS
    'Esquema global: relaciones reconstruidas a partir de los fragmentos de los 6 nodos';

CREATE TABLE nacional.ventas_nacionales (
    id_venta        BIGINT        NOT NULL,
    fecha_hora      TIMESTAMPTZ   NOT NULL,
    departamento_id CHAR(2)       NOT NULL,
    id_cliente      BIGINT        NOT NULL,
    id_empleado     INT           NOT NULL,
    total_bs        NUMERIC(12,2) NOT NULL
) PARTITION BY LIST (departamento_id);

CREATE TABLE nacional.clientes_nacionales (
    id_cliente      BIGINT       NOT NULL,
    nit_ci          VARCHAR(20)  NOT NULL,
    razon_social    VARCHAR(150) NOT NULL,
    telefono        VARCHAR(20),
    direccion       VARCHAR(200),
    departamento_id CHAR(2)      NOT NULL
) PARTITION BY LIST (departamento_id);

-- Fragmentos locales de La Paz (FV1 y FC1·LP).
ALTER TABLE nacional.ventas_nacionales   ATTACH PARTITION public.ventas                   FOR VALUES IN ('LP');
ALTER TABLE nacional.clientes_nacionales ATTACH PARTITION public.clientes_datos_generales FOR VALUES IN ('LP');

-- Fragmentos remotos: FV2..FV6, FC1 de cada nodo, y las tablas de fragmentación
-- derivada (detalle, almacenes, inventario), que se unen en vistas UNION ALL.
DO $$
DECLARE
    r          RECORD;
    detalle    TEXT := 'SELECT ''lp''::text AS nodo, d.* FROM public.detalle_venta d';
    inventario TEXT := 'SELECT ''lp''::text AS nodo, a.departamento_id, i.* '
                       'FROM public.inventario i JOIN public.almacenes a USING (id_almacen)';
BEGIN
    FOR r IN
        SELECT * FROM (VALUES (2, 'sc', $v$'SC'$v$),
                              (3, 'cb', $v$'CB'$v$),
                              (4, 'tj', $v$'TJ','CH'$v$),
                              (5, 'or', $v$'OR','PO'$v$),
                              (6, 'be', $v$'BE','PA'$v$)) AS v(num, cod, deptos)
    LOOP
        EXECUTE format('CREATE FOREIGN TABLE nacional.fv%s_%s PARTITION OF nacional.ventas_nacionales '
                       'FOR VALUES IN (%s) SERVER srv_%s OPTIONS (schema_name ''public'', table_name %L)',
                       r.num, r.cod, r.deptos, r.cod, 'ventas');
        EXECUTE format('CREATE FOREIGN TABLE nacional.fc1_%s PARTITION OF nacional.clientes_nacionales '
                       'FOR VALUES IN (%s) SERVER srv_%s OPTIONS (schema_name ''public'', table_name %L)',
                       r.cod, r.deptos, r.cod, 'clientes_datos_generales');
        EXECUTE format('CREATE FOREIGN TABLE nacional.fdv%s_%s (id_detalle BIGINT, id_venta BIGINT, '
                       'id_producto INT, cantidad INT, precio_aplicado NUMERIC(10,2), subtotal NUMERIC(12,2)) '
                       'SERVER srv_%s OPTIONS (schema_name ''public'', table_name %L)', r.num, r.cod, r.cod, 'detalle_venta');
        EXECUTE format('CREATE FOREIGN TABLE nacional.fa%s_%s (id_almacen INT, nombre_almacen VARCHAR(80), '
                       'departamento_id CHAR(2), direccion VARCHAR(200)) '
                       'SERVER srv_%s OPTIONS (schema_name ''public'', table_name %L)', r.num, r.cod, r.cod, 'almacenes');
        EXECUTE format('CREATE FOREIGN TABLE nacional.fi%s_%s (id_almacen INT, id_producto INT, '
                       'stock_actual INT, stock_minimo INT) '
                       'SERVER srv_%s OPTIONS (schema_name ''public'', table_name %L)', r.num, r.cod, r.cod, 'inventario');

        detalle := detalle || format(' UNION ALL SELECT %L, d.* FROM nacional.fdv%s_%s d',
                                     r.cod, r.num, r.cod);
        inventario := inventario || format(' UNION ALL SELECT %L, a.departamento_id, i.* '
                                           'FROM nacional.fi%s_%s i JOIN nacional.fa%s_%s a USING (id_almacen)',
                                           r.cod, r.num, r.cod, r.num, r.cod);
    END LOOP;

    EXECUTE 'CREATE VIEW nacional.detalle_nacional AS ' || detalle;
    EXECUTE 'CREATE VIEW nacional.inventario_nacional AS ' || inventario;
END $$;

-- Registro del coordinador 2PC (Nodo 3), solo lectura para auditoría.
CREATE FOREIGN TABLE nacional.traspasos_log (
    gid VARCHAR(64), origen CHAR(2), destino CHAR(2), id_almacen_origen INT, id_almacen_destino INT,
    id_producto INT, cantidad INT, estado VARCHAR(12), detalle TEXT,
    creado_en TIMESTAMPTZ, actualizado_en TIMESTAMPTZ
) SERVER srv_cb OPTIONS (schema_name 'public', table_name 'traspasos_log');

GRANT USAGE  ON SCHEMA nacional                TO rol_analista, rol_auditor;
GRANT SELECT ON ALL TABLES IN SCHEMA nacional  TO rol_analista, rol_auditor;
ALTER ROLE rol_analista SET search_path = nacional, public;
ALTER ROLE rol_auditor  SET search_path = nacional, public;
