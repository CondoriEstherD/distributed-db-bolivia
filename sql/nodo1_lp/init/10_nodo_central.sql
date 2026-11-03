-- =============================================================================
-- Nodo 1 (La Paz) · inicialización: fragmento vertical FC2, roles centrales y
-- publicación del catálogo maestro.
-- Variables psql: :pass_analista, :pass_auditor, :pass_admin_catalogo, :pass_replicador
-- =============================================================================

-- Fragmento FC2 = π id_cliente, limite_credito, saldo_pendiente, calificacion_riesgo,
-- estado_credito (CLIENTES). Exclusivo del Nodo 1 por auditoría y regulación crediticia.
-- Sin FOREIGN KEY: FC1 está distribuido en 6 nodos (se concilia con una consulta).
CREATE TABLE clientes_financiero (
    id_cliente          BIGINT        PRIMARY KEY,
    limite_credito      NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (limite_credito >= 0),
    saldo_pendiente     NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (saldo_pendiente >= 0),
    calificacion_riesgo CHAR(1)       NOT NULL CHECK (calificacion_riesgo IN ('A','B','C','D','E')),
    estado_credito      VARCHAR(12)   NOT NULL CHECK (estado_credito IN ('ACTIVO','SUSPENDIDO','MOROSO')),
    CONSTRAINT ck_saldo_dentro_del_limite CHECK (saldo_pendiente <= limite_credito)
);
COMMENT ON TABLE clientes_financiero IS
    'Fragmento vertical FC2 (datos financieros). Ubicación exclusiva: Nodo 1 (La Paz)';

CREATE ROLE rol_analista       LOGIN PASSWORD :'pass_analista';                -- consultas nacionales
CREATE ROLE rol_auditor        LOGIN PASSWORD :'pass_auditor';                 -- único con acceso a FC2
CREATE ROLE rol_admin_catalogo LOGIN PASSWORD :'pass_admin_catalogo';          -- mantiene el catálogo maestro
CREATE ROLE replicador         LOGIN REPLICATION PASSWORD :'pass_replicador';  -- suscripciones de los nodos 2-6

-- El catálogo solo se modifica aquí; los cajeros de La Paz también lo leen sin escribir.
GRANT SELECT, INSERT, UPDATE, DELETE ON productos_catalogo  TO rol_admin_catalogo;
GRANT SELECT                         ON productos_catalogo  TO replicador;
GRANT SELECT, INSERT, UPDATE, DELETE ON clientes_financiero TO rol_auditor;
GRANT SELECT ON productos_catalogo, almacenes, inventario,
                clientes_datos_generales, ventas, detalle_venta TO rol_analista, rol_auditor;

-- Publicación del catálogo: cada nodo 2-6 se suscribe (replicación lógica asíncrona).
CREATE PUBLICATION pub_catalogo FOR TABLE productos_catalogo;
