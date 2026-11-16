"""Utilidades compartidas por las páginas del panel."""
import re

import pandas as pd
import psycopg
import streamlit as st

from sgbdd import operacion as op
from sgbdd.config import NODOS, RAIZ, conectar, nodo_de_almacen

LP = NODOS["lp"]

ESTILO_ESTADO = {  # estado → (color del distintivo, icono)
    "EN LÍNEA": ("green", ":material/check_circle:"),
    "AISLADO": ("orange", ":material/wifi_off:"),
    "APAGADO": ("red", ":material/power_settings_new:"),
    "SIN CONEXIÓN": ("red", ":material/error:"),
}


def consulta(nodo, sql, params=None, usuario="rol_analista", statement_timeout_ms=8000):
    with conectar(nodo, usuario, autocommit=True, statement_timeout_ms=statement_timeout_ms) as c:
        cur = c.execute(sql, params)
        return pd.DataFrame(cur.fetchall(), columns=[d.name for d in cur.description])


def leer(nodo, sql):
    """Lee un valor por red; si el nodo está aislado y es local, por su consola. None si no responde."""
    estado_nodo = next(f["estado"] for f in estado() if f["cod"] == nodo.cod)
    if estado_nodo == "APAGADO":
        return None
    if estado_nodo == "AISLADO" and nodo.local:  # evita esperar el tiempo límite de la red
        filas = op.consola(nodo, sql)
        return filas[0][0] if filas else None
    try:
        with conectar(nodo, "fdw_lector", autocommit=True) as c:
            fila = c.execute(sql).fetchone()
            return None if fila is None else fila[0]
    except psycopg.OperationalError:
        if nodo.local:
            try:
                filas = op.consola(nodo, sql)
                return filas[0][0] if filas else None
            except RuntimeError:  # servidor apagado
                return None
        return None


@st.cache_data(ttl=5, show_spinner=False)
def estado():
    return op.estado_nodos()


def refrescar():
    estado.clear()


def distintivo(estado_nodo):
    color, icono = ESTILO_ESTADO[estado_nodo]
    st.badge(estado_nodo.capitalize(), icon=icono, color=color)


@st.cache_data
def consultas_predefinidas():
    texto = (RAIZ / "sql/consultas/consultas_distribuidas.sql").read_text(encoding="utf-8")
    bloques = re.split(r"^-- \[(C\d+)\] (.+?) \| (\w+)\s*$", texto, flags=re.M)
    return {f"{bloques[i]} · {bloques[i + 1]}": (bloques[i + 3].strip(), bloques[i + 2])
            for i in range(1, len(bloques), 4)}


def almacenes():
    return [n.num * 100 + k for n in NODOS.values() for k in range(1, 2 * len(n.deptos) + 1)]


def depto_de_almacen(a):
    """Dos almacenes por departamento, numerados en orden alfabético (04_datos_prueba.sql:
    ORDER BY d, n): 401, 402 → CH · 403, 404 → TJ."""
    return sorted(nodo_de_almacen(a).deptos)[(a % 100 - 1) // 2]


def etiqueta_almacen(a):
    n = nodo_de_almacen(a)
    return f"{a} · Almacén {depto_de_almacen(a)}-{(a % 100 - 1) % 2 + 1} · {n.nombre} (Nodo {n.num})"


def en_linea(cod):
    return next(f["estado"] for f in estado() if f["cod"] == cod) == "EN LÍNEA"


@st.cache_data(ttl=60, show_spinner=False)
def productos():
    """Catálogo {id: (nombre, precio)}. Es una réplica total: se lee del primer nodo que responda."""
    for nodo in NODOS.values():
        try:
            with conectar(nodo, "fdw_lector", autocommit=True) as c:
                filas = c.execute("SELECT id_producto, nombre, precio_unitario FROM productos_catalogo "
                                  "ORDER BY id_producto").fetchall()
            return {i: (nombre, float(precio)) for i, nombre, precio in filas}
        except psycopg.OperationalError:
            continue
    return {}


def etiqueta_producto(p):
    nombre, precio = productos().get(p, ("?", 0))
    return f"{p} · {nombre} (Bs {precio:,.2f})"


def miles(n):
    return f"{int(n):,}".replace(",", ".")
