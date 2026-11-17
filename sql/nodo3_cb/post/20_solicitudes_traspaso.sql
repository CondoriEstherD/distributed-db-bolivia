-- =============================================================================
-- Nodo 3 (Cochabamba, hub de traspasos) · solicitudes de traspaso entre sucursales.
-- Un traspaso necesita el «sí» de las PERSONAS y luego el de las BASES DE DATOS:
--   1. El encargado de la sucursal de origen lo solicita        → PENDIENTE
--   2. El encargado de la sucursal de destino lo acepta o no    → ACEPTADA / RECHAZADA
--   3. Al aceptar se ejecuta el 2PC (votos de las dos bases)    → COMPLETADA / FALLIDA
-- El origen puede cancelarla mientras esté PENDIENTE. Idempotente: lo aplica `configurar`.
-- =============================================================================
CREATE TABLE IF NOT EXISTS solicitudes_traspaso (
    id                  SERIAL      PRIMARY KEY,
    origen              CHAR(2)     NOT NULL,
    destino             CHAR(2)     NOT NULL CHECK (destino <> origen),
    id_almacen_origen   INT         NOT NULL,
    id_almacen_destino  INT         NOT NULL,
    items               JSONB       NOT NULL,       -- {"id_producto": cantidad, ...}
    nota                TEXT,
    estado              VARCHAR(12) NOT NULL DEFAULT 'PENDIENTE'
        CHECK (estado IN ('PENDIENTE','ACEPTADA','RECHAZADA','CANCELADA','COMPLETADA','FALLIDA')),
    motivo              TEXT,                       -- motivo del rechazo o de la falla del 2PC
    gid                 VARCHAR(64),                -- transacción 2PC que la ejecutó (traspasos_log)
    creado_en           TIMESTAMPTZ NOT NULL DEFAULT now(),
    respondido_en       TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS ix_solicitudes_destino ON solicitudes_traspaso (destino, estado);
CREATE INDEX IF NOT EXISTS ix_solicitudes_origen  ON solicitudes_traspaso (origen, estado);

GRANT SELECT, INSERT, UPDATE ON solicitudes_traspaso TO coordinador_2pc;
GRANT USAGE ON SEQUENCE solicitudes_traspaso_id_seq   TO coordinador_2pc;
GRANT SELECT                 ON solicitudes_traspaso TO fdw_lector;
