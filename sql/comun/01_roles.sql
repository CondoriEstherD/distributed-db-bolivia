-- =============================================================================
-- 01 · Roles presentes en TODOS los nodos (principio de mínimo privilegio).
-- Los privilegios se otorgan en 06_permisos.sql, una vez creadas las tablas.
-- Variables psql: :pass_cajero, :pass_fdw_lector, :pass_coordinador
-- =============================================================================

CREATE ROLE rol_cajero      LOGIN PASSWORD :'pass_cajero';  -- operación local de la sucursal
CREATE ROLE fdw_lector      LOGIN PASSWORD :'pass_fdw_lector';  -- lectura remota desde el Nodo 1 y monitoreo
CREATE ROLE coordinador_2pc LOGIN PASSWORD :'pass_coordinador';  -- participante de traspasos 2PC

GRANT pg_monitor TO fdw_lector;
