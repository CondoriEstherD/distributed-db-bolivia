-- =============================================================================
-- Nodos 2-6 · suscripción al catálogo maestro del Nodo 1 (idempotente).
-- copy_data = false: la copia inicial ya existe (03_catalogo_semilla.sql); desde
-- aquí solo se aplican los cambios publicados por La Paz.
-- Si La Paz cambia de dirección (lab → red) se actualiza la conexión existente.
-- Variables psql: :nodo_cod, :lp_host, :lp_port, :app_password
-- =============================================================================

SELECT format('host=%s port=%s dbname=bd_lp user=replicador password=%s connect_timeout=5',
              :'lp_host', :'lp_port', :'app_password') AS conninfo,
       'sub_catalogo_' || :'nodo_cod'                   AS subname \gset

SELECT CASE
         WHEN EXISTS (SELECT 1 FROM pg_subscription WHERE subname = :'subname')
         THEN format('ALTER SUBSCRIPTION %I CONNECTION %L', :'subname', :'conninfo')
         ELSE format('CREATE SUBSCRIPTION %I CONNECTION %L PUBLICATION pub_catalogo '
                     'WITH (copy_data = false)', :'subname', :'conninfo')
       END \gexec
