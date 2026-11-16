-- =============================================================================
-- Nodo 3 · un traspaso puede mover VARIOS productos en una sola transacción 2PC.
-- items = {"id_producto": cantidad, ...}. id_producto y cantidad quedan para los
-- traspasos de un solo producto (compatibilidad). Idempotente: lo aplica `configurar`.
-- =============================================================================
ALTER TABLE traspasos_log ADD COLUMN IF NOT EXISTS items JSONB;
ALTER TABLE traspasos_log ALTER COLUMN id_producto DROP NOT NULL;
ALTER TABLE traspasos_log ALTER COLUMN cantidad    DROP NOT NULL;
