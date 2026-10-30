#!/bin/bash
# Se ejecuta UNA vez, cuando el volumen del nodo está vacío.
# Aplica los scripts comunes y luego los propios del nodo, parametrizados por las
# variables NODO_NUM, NODO_COD, DEPTOS y VENTAS definidas en docker-compose.yml.
set -e

ejecutar() {
  echo ">> [nodo${NODO_NUM}_${NODO_COD}] $1"
  psql -v ON_ERROR_STOP=1 -q -X \
    --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
    -v nodo_num="$NODO_NUM" -v nodo_cod="$NODO_COD" \
    -v deptos="$DEPTOS" -v ventas="$VENTAS" \
    -v app_password="$APP_PASSWORD" \
    -f "$1"
}

for archivo in /sql/comun/*.sql /sql/nodo"${NODO_NUM}"_"${NODO_COD}"/init/*.sql; do
  if [ -f "$archivo" ]; then ejecutar "$archivo"; fi
done
