-- =============================================================================
-- Consultas distribuidas de referencia (sección 9.3). Se ejecutan en el Nodo 1.
-- Formato de cabecera (lo lee el panel):  -- [ID] Título | rol
-- El analista NO indica nodos: el esquema «nacional» oculta la distribución.
-- =============================================================================

-- [C1] Ventas totales por departamento (agregación calculada en cada nodo) | rol_analista
SELECT departamento_id, count(*) AS ventas, sum(total_bs) AS total_bs
FROM ventas_nacionales
GROUP BY departamento_id
ORDER BY total_bs DESC;

-- [C2] Clientes con crédito (FC2, La Paz) y sus compras en Tarija y Chuquisaca (Nodo 4) | rol_auditor
SELECT c.razon_social, c.nit_ci, f.limite_credito, f.saldo_pendiente, f.estado_credito,
       count(*) AS compras, sum(v.total_bs) AS total_bs
FROM ventas_nacionales v
JOIN clientes_nacionales c USING (id_cliente)
JOIN clientes_financiero f USING (id_cliente)
WHERE v.departamento_id IN ('TJ', 'CH')
GROUP BY 1, 2, 3, 4, 5
ORDER BY total_bs DESC
LIMIT 15;

-- [C3] Reconstrucción de CLIENTES = FC1 ⋈ FC2 | rol_auditor
SELECT id_cliente, razon_social, departamento_id, limite_credito, saldo_pendiente,
       calificacion_riesgo, estado_credito
FROM clientes_completo
WHERE estado_credito <> 'SOLO CONTADO'
ORDER BY limite_credito DESC
LIMIT 15;

-- [C4] Diez productos más vendidos del país (detalle distribuido ⋈ catálogo replicado) | rol_analista
SELECT p.nombre, p.categoria, sum(d.cantidad) AS unidades, sum(d.subtotal) AS total_bs
FROM detalle_nacional d
JOIN productos_catalogo p USING (id_producto)
GROUP BY p.nombre, p.categoria
ORDER BY unidades DESC
LIMIT 10;

-- [C5] Inventario bajo el stock mínimo en todo el país | rol_analista
SELECT nodo, departamento_id, id_almacen, id_producto, stock_actual, stock_minimo
FROM inventario_nacional
WHERE stock_actual < stock_minimo
ORDER BY stock_actual, nodo
LIMIT 25;

-- [C6] Un solo departamento: el planificador consulta un único fragmento | rol_analista
SELECT departamento_id, count(*) AS ventas, sum(total_bs) AS total_bs
FROM ventas_nacionales
WHERE departamento_id = 'SC'
GROUP BY departamento_id;

-- [C7] Resumen tolerante a fallos (informa los nodos caídos en vez de abortar) | rol_analista
SELECT * FROM resumen_nacional_disponible();

-- [C8] Auditoría de traspasos 2PC (registro del Nodo 3) | rol_analista
SELECT gid, origen, destino, id_producto, cantidad, estado, detalle, actualizado_en
FROM traspasos_log
ORDER BY creado_en DESC
LIMIT 20;
