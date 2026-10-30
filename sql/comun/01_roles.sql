-- =============================================================================
-- 01 · Roles presentes en TODOS los nodos (principio de mínimo privilegio).
-- Los privilegios se otorgan en 06_permisos.sql, una vez creadas las tablas.
-- Variables psql: :app_password
-- =============================================================================

CREATE ROLE rol_cajero      LOGIN PASSWORD :'app_password';  -- operación local de la sucursal
CREATE ROLE fdw_lector      LOGIN PASSWORD :'app_password';  -- lectura remota desde el Nodo 1 y monitoreo
CREATE ROLE coordinador_2pc LOGIN PASSWORD :'app_password';  -- participante de traspasos 2PC

GRANT pg_monitor TO fdw_lector;
