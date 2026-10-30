-- =============================================================================
-- 06 · Matriz CRUD aplicada con privilegios del gestor (no depende de la aplicación).
-- En los nodos 2-6 el catálogo es de SOLO LECTURA: lo escribe únicamente la
-- replicación (que se aplica como propietario de la suscripción).
-- =============================================================================

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;

-- Cajero: operación local de la sucursal.
GRANT SELECT                         ON productos_catalogo, almacenes     TO rol_cajero;
GRANT SELECT, INSERT, UPDATE, DELETE ON clientes_datos_generales,
                                        ventas, detalle_venta, inventario TO rol_cajero;

-- Lector remoto (usuario de las conexiones postgres_fdw desde La Paz): solo lectura.
GRANT SELECT ON ALL TABLES IN SCHEMA public TO fdw_lector;

-- Participante 2PC: únicamente puede mover stock.
GRANT SELECT                 ON almacenes, productos_catalogo TO coordinador_2pc;
GRANT SELECT, INSERT, UPDATE ON inventario                    TO coordinador_2pc;
