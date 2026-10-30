-- =============================================================================
-- Nodo 1 (La Paz) · vistas y funciones globales (se recrean junto con el esquema).
-- =============================================================================

-- Reconstrucción de la fragmentación vertical: CLIENTES = FC1 ⋈ id_cliente FC2.
-- LEFT JOIN: un cliente sin fila financiera opera solo al contado.
-- Contiene datos crediticios → solo para el auditor.
CREATE VIEW nacional.clientes_completo AS
SELECT c.id_cliente, c.nit_ci, c.razon_social, c.telefono, c.direccion, c.departamento_id,
       f.limite_credito, f.saldo_pendiente, f.calificacion_riesgo,
       COALESCE(f.estado_credito, 'SOLO CONTADO') AS estado_credito
FROM nacional.clientes_nacionales c
LEFT JOIN public.clientes_financiero f USING (id_cliente);
GRANT SELECT ON nacional.clientes_completo TO rol_auditor;

-- Consulta nacional TOLERANTE A FALLOS: consulta cada fragmento por separado y,
-- si un nodo no responde, lo informa en lugar de abortar toda la consulta.
CREATE FUNCTION nacional.resumen_nacional_disponible()
RETURNS TABLE (fragmento TEXT, departamento_id CHAR(2), ventas BIGINT, total_bs NUMERIC, estado TEXT)
LANGUAGE plpgsql AS $$
DECLARE
    p REGCLASS;
BEGIN
    FOR p IN
        SELECT i.inhrelid::regclass
        FROM pg_inherits i
        WHERE i.inhparent = 'nacional.ventas_nacionales'::regclass
        ORDER BY i.inhrelid::regclass::text
    LOOP
        BEGIN
            RETURN QUERY EXECUTE format(
                'SELECT %L::text, v.departamento_id, count(*), sum(v.total_bs), %L::text
                 FROM %s v GROUP BY v.departamento_id', p::text, 'EN LÍNEA', p);
        EXCEPTION WHEN OTHERS THEN
            RETURN QUERY SELECT p::text, NULL::CHAR(2), NULL::BIGINT, NULL::NUMERIC,
                                'FUERA DE LÍNEA: ' || split_part(SQLERRM, E'\n', 1);
        END;
    END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION nacional.resumen_nacional_disponible() TO rol_analista, rol_auditor;

-- Agregaciones y reuniones por partición: cada nodo calcula su parte (pushdown)
-- y por la red viaja el resultado parcial, no las filas.
ALTER DATABASE bd_lp SET enable_partitionwise_aggregate = on;
ALTER DATABASE bd_lp SET enable_partitionwise_join = on;
