-- =============================================================================
-- Nodo 1 (La Paz) · datos de prueba de FC2 para ~30 % de los clientes del país.
-- Lee FC1 de los 6 nodos a través de la tabla global (requiere todos en línea).
-- Idempotente: los clientes que ya tienen ficha financiera no se modifican.
-- =============================================================================

SELECT setseed(0.42);

INSERT INTO clientes_financiero (id_cliente, limite_credito, saldo_pendiente,
                                 calificacion_riesgo, estado_credito)
SELECT id_cliente,
       limite,
       round((random() * limite)::numeric, 2),
       (ARRAY['A','A','B','B','B','C','C','D','E'])[1 + floor(random() * 9)::int],
       (ARRAY['ACTIVO','ACTIVO','ACTIVO','ACTIVO','SUSPENDIDO','MOROSO'])[1 + floor(random() * 6)::int]
FROM (
    SELECT id_cliente, (5000 + floor(random() * 95) * 1000)::numeric AS limite
    FROM nacional.clientes_nacionales
    WHERE nit_ci <> '0' AND random() < 0.30
) c
ON CONFLICT (id_cliente) DO NOTHING;

ANALYZE clientes_financiero;
