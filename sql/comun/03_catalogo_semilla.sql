-- =============================================================================
-- 03 · Semilla del catálogo (idéntica y determinista en los 6 nodos).
-- Es la sincronización inicial de la réplica: las suscripciones se crean con
-- copy_data = false y desde ahí solo viajan los CAMBIOS hechos en La Paz.
-- No usar random() aquí: todos los nodos deben generar exactamente lo mismo.
-- =============================================================================

INSERT INTO productos_catalogo (id_producto, codigo_barras, nombre, descripcion, precio_unitario, categoria)
SELECT (b.i - 1) * 8 + p.j                                       AS id_producto,
       '777' || lpad(((b.i - 1) * 8 + p.j)::text, 10, '0')      AS codigo_barras,  -- prefijo GS1 Bolivia
       b.nombre || ' ' || p.presentacion                         AS nombre,
       format('%s, presentación %s', b.nombre, lower(p.presentacion)),
       round((b.precio_base * p.factor)::numeric, 2)            AS precio_unitario,
       b.categoria
FROM (VALUES
        (1,  'Arroz',              'Abarrotes',        9.50),
        (2,  'Azúcar',             'Abarrotes',        7.80),
        (3,  'Fideo',              'Abarrotes',        6.20),
        (4,  'Aceite',             'Abarrotes',       16.00),
        (5,  'Harina',             'Abarrotes',        8.40),
        (6,  'Café',               'Abarrotes',       28.00),
        (7,  'Té',                 'Abarrotes',       11.00),
        (8,  'Quinua',             'Agroindustria',   18.50),
        (9,  'Soya',               'Agroindustria',   12.30),
        (10, 'Maíz',               'Agroindustria',    6.90),
        (11, 'Leche',              'Lácteos',          6.50),
        (12, 'Yogur',              'Lácteos',          9.00),
        (13, 'Queso',              'Lácteos',         32.00),
        (14, 'Mantequilla',        'Lácteos',         14.00),
        (15, 'Agua mineral',       'Bebidas',          5.00),
        (16, 'Gaseosa',            'Bebidas',         10.50),
        (17, 'Jugo',               'Bebidas',          8.00),
        (18, 'Cerveza',            'Bebidas',         12.00),
        (19, 'Detergente',         'Limpieza',        22.00),
        (20, 'Lavandina',          'Limpieza',         7.00),
        (21, 'Jabón',              'Cuidado personal', 4.50),
        (22, 'Champú',             'Cuidado personal',19.00),
        (23, 'Pasta dental',       'Cuidado personal',13.00),
        (24, 'Cemento',            'Ferretería',      58.00),
        (25, 'Casco de seguridad', 'Minería',         85.00)
     ) AS b(i, nombre, categoria, precio_base)
CROSS JOIN (VALUES
        (1, 'Unidad',        1.00),
        (2, 'Pack x3',       2.85),
        (3, 'Pack x6',       5.50),
        (4, 'Caja x12',     10.50),
        (5, 'Familiar',      1.80),
        (6, 'Económico',     0.85),
        (7, 'Premium',       1.40),
        (8, 'Mayorista x24',19.50)
     ) AS p(j, presentacion, factor);
