-- =============================================================================
-- 04 · Datos de prueba locales del nodo (reproducibles: semilla fija por nodo).
-- Total nacional de ventas = 12 500 + 15 000 + 10 000 + 5 000 + 5 000 + 2 500 = 50 000.
-- Variables psql: :nodo_num, :deptos, :ventas
-- =============================================================================

SELECT setseed(:nodo_num / 10.0);

-- Almacenes: dos por departamento. Ids 101, 102 (LP) · 401..404 (TJ, CH) ...
INSERT INTO almacenes (id_almacen, nombre_almacen, departamento_id, direccion)
SELECT :nodo_num * 100 + row_number() OVER (ORDER BY d, n),
       format('Almacén %s-%s', d, n),
       d,
       format('Parque industrial %s, galpón %s', d, n)
FROM unnest(ARRAY[:deptos]::char(2)[]) AS d
CROSS JOIN generate_series(1, 2) AS n;

-- Inventario: todo el catálogo en cada almacén local.
INSERT INTO inventario (id_almacen, id_producto, stock_actual, stock_minimo)
SELECT a.id_almacen, p.id_producto, 50 + floor(random() * 950)::int, 100
FROM almacenes a
CROSS JOIN productos_catalogo p;

-- Cliente genérico por departamento: facturas a «SIN NOMBRE», NIT 0.
INSERT INTO clientes_datos_generales (nit_ci, razon_social, departamento_id)
SELECT '0', 'SIN NOMBRE', d
FROM unnest(ARRAY[:deptos]::char(2)[]) AS d;

-- 400 clientes por departamento.
INSERT INTO clientes_datos_generales (nit_ci, razon_social, telefono, direccion, departamento_id)
SELECT (1000000 + floor(random() * 8999999))::bigint::text,
       (ARRAY['Juan','María','Carlos','Ana','Luis','Rosa','Jorge','Carmen','Pedro','Lucía',
              'Miguel','Elena','Roberto','Patricia','Fernando'])[1 + floor(random() * 15)::int]
         || ' ' ||
       (ARRAY['Mamani','Quispe','Condori','Choque','Flores','Vargas','Rojas','Gutiérrez',
              'Fernández','Copa','Huanca','Limachi','Torrez','Apaza','Cruz'])[1 + floor(random() * 15)::int],
       '7' || lpad(floor(random() * 9999999)::text, 7, '0'),
       format('Calle %s N.º %s',
              (ARRAY['Bolívar','Sucre','Ayacucho','Junín','Potosí','Colón','Murillo'])[1 + floor(random() * 7)::int],
              1 + floor(random() * 900)::int),
       d
FROM unnest(ARRAY[:deptos]::char(2)[]) AS d
CROSS JOIN generate_series(1, 400);

-- Ventas: cliente aleatorio del nodo; la venta toma el departamento del cliente.
WITH c AS (
    SELECT array_agg(id_cliente ORDER BY id_cliente)      AS ids,
           array_agg(departamento_id ORDER BY id_cliente) AS deps,
           count(*)::int                                   AS n
    FROM clientes_datos_generales
), s AS (
    SELECT c.ids, c.deps, (1 + floor(random() * c.n))::int AS k
    FROM generate_series(1, :ventas), c
)
INSERT INTO ventas (fecha_hora, departamento_id, id_cliente, id_empleado)
SELECT now() - random() * interval '365 days',
       deps[k],
       ids[k],
       :nodo_num * 100 + 1 + floor(random() * 20)::int
FROM s;

-- Detalle: entre 1 y 5 productos por venta (la subconsulta depende de la venta).
INSERT INTO detalle_venta (id_venta, id_producto, cantidad, precio_aplicado)
SELECT v.id_venta, p.id_producto, 1 + floor(random() * 10)::int, p.precio_unitario
FROM ventas v
CROSS JOIN LATERAL (
    SELECT id_producto, precio_unitario
    FROM productos_catalogo
    ORDER BY random()
    LIMIT 1 + v.id_venta % 5
) p;

UPDATE ventas v
SET total_bs = d.total
FROM (SELECT id_venta, sum(subtotal) AS total FROM detalle_venta GROUP BY id_venta) d
WHERE d.id_venta = v.id_venta;

ANALYZE;
