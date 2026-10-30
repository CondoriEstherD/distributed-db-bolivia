-- =============================================================================
-- Nodo 3 (Cochabamba, hub de traspasos) · registro de decisiones del coordinador 2PC.
-- El estado COMMIT escrito aquí es el punto de decisión irrevocable del protocolo;
-- la recuperación de transacciones en duda se basa exclusivamente en esta tabla.
-- =============================================================================

CREATE TABLE traspasos_log (
    gid                 VARCHAR(64) PRIMARY KEY,
    origen              CHAR(2)     NOT NULL,
    destino             CHAR(2)     NOT NULL,
    id_almacen_origen   INT         NOT NULL,
    id_almacen_destino  INT         NOT NULL,
    id_producto         INT         NOT NULL,
    cantidad            INT         NOT NULL CHECK (cantidad > 0),
    estado              VARCHAR(12) NOT NULL
        CHECK (estado IN ('INICIADO','PREPARADO','COMMIT','ABORTADO')),
    detalle             TEXT,
    creado_en           TIMESTAMPTZ NOT NULL DEFAULT now(),
    actualizado_en      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (origen <> destino)
);
CREATE INDEX ix_traspasos_pendientes ON traspasos_log (estado) WHERE estado <> 'ABORTADO';

GRANT SELECT, INSERT, UPDATE ON traspasos_log TO coordinador_2pc;
GRANT SELECT                 ON traspasos_log TO fdw_lector;
