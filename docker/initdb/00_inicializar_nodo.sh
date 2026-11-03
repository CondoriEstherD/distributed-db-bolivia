#!/bin/bash
# Se ejecuta UNA vez, cuando el volumen del nodo está vacío.
# Aplica los scripts comunes y luego los propios del nodo, parametrizados por las
# variables NODO_NUM, NODO_COD, DEPTOS y VENTAS definidas en docker-compose.yml y
# por las contraseñas PASS_* de cada rol (llegan desde .env por env_file).
set -e

ejecutar() {
  echo ">> [nodo${NODO_NUM}_${NODO_COD}] $1"
  psql -v ON_ERROR_STOP=1 -q -X \
    --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
    -v nodo_num="$NODO_NUM" -v nodo_cod="$NODO_COD" \
    -v deptos="$DEPTOS" -v ventas="$VENTAS" \
    -v pass_cajero="$PASS_CAJERO" -v pass_fdw_lector="$PASS_FDW_LECTOR"     -v pass_coordinador="$PASS_COORDINADOR" -v pass_analista="$PASS_ANALISTA"     -v pass_auditor="$PASS_AUDITOR" -v pass_admin_catalogo="$PASS_ADMIN_CATALOGO"     -v pass_replicador="$PASS_REPLICADOR" \
    -f "$1"
}

for archivo in /sql/comun/*.sql /sql/nodo"${NODO_NUM}"_"${NODO_COD}"/init/*.sql; do
  if [ -f "$archivo" ]; then ejecutar "$archivo"; fi
done
