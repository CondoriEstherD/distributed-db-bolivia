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
       format('%s, presentación %s', b.nombre, lower(p.presentacion)) AS descripcion,
       round((b.precio_base * p.factor)::numeric, 2)            AS precio_unitario,
       b.categoria
FROM (VALUES   -- Rubro único: cosméticos y cuidado personal
        (1,  'Champú Head & Shoulders',         'Cuidado del cabello',  32.00),
        (2,  'Champú Sedal',                    'Cuidado del cabello',  24.00),
        (3,  'Champú Pantene Pro-V',            'Cuidado del cabello',  38.00),
        (4,  'Acondicionador Pantene',          'Cuidado del cabello',  34.00),
        (5,  'Tinte Koleston Perfect',          'Cuidado del cabello',  48.00),
        (6,  'Gel fijador',                     'Cuidado del cabello',  18.00),
        (7,  'Cera modeladora Mitch',           'Cuidado del cabello',  95.00),
        (8,  'Crema Nivea Creme',               'Cuidado de la piel',   26.00),
        (9,  'Vaselina pura',                   'Cuidado de la piel',   15.00),
        (10, 'Protector solar La Roche-Posay',  'Cuidado de la piel',  160.00),
        (11, 'Loción Bath & Body Works',        'Cuidado de la piel',  110.00),
        (12, 'Jabón Dove',                      'Higiene personal',      9.00),
        (13, 'Gel de ducha Care',               'Higiene personal',     28.00),
        (14, 'Talco Johnson''s Baby',           'Higiene personal',     20.00),
        (15, 'Toallitas húmedas',               'Higiene personal',     18.00),
        (16, 'Pasta dental Colgate',            'Cuidado bucal',        13.00),
        (17, 'Cepillo eléctrico Oral-B',        'Cuidado bucal',       280.00),
        (18, 'Enjuague bucal Listerine',        'Cuidado bucal',        38.00),
        (19, 'Enjuague bucal Colgate',          'Cuidado bucal',        30.00),
        (20, 'Labial Dior Rouge',               'Maquillaje',          320.00),
        (21, 'Máscara de pestañas Avon',        'Maquillaje',           65.00),
        (22, 'Esmalte Revlon',                  'Maquillaje',           35.00),
        (23, 'Perfume Coty L''Aimant',          'Fragancias',          210.00),
        (24, 'Máquina Gillette Mach3',          'Afeitado',             48.00),
        (25, 'Espuma de afeitar Gillette Foamy','Afeitado',             36.00)
     ) AS b(i, nombre, categoria, precio_base)
CROSS JOIN (VALUES
        (1, 'Unidad',           1.00),
        (2, 'Pack x3',          2.85),
        (3, 'Pack x6',          5.50),
        (4, 'Caja x12',        10.50),
        (5, 'Tamaño familiar',  1.80),
        (6, 'Tamaño viaje',     0.60),
        (7, 'Edición premium',  1.40),
        (8, 'Mayorista x24',   19.50)
     ) AS p(j, presentacion, factor);