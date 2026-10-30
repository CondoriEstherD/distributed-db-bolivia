import subprocess
import sys

import pandas as pd
import psycopg
import streamlit as st

import comun
from sgbdd.config import NODOS, RAIZ, conectar
from sgbdd.recuperacion_2pc import recuperar

st.caption("Si el coordinador cae entre las dos fases, los participantes quedan con transacciones "
           "PREPARADAS que bloquean filas («en duda»). La recuperación consulta la decisión en "
           "`traspasos_log` (Nodo 3): si dice COMMIT confirma; si no, revierte (presunción de aborto).")


def en_duda():
    filas = []
    for n in NODOS.values():
        try:
            with conectar(n, "fdw_lector", autocommit=True) as c:
                for gid, prep in c.execute("""SELECT gid, prepared::timestamp(0) FROM pg_prepared_xacts
                                              WHERE database = current_database()""").fetchall():
                    filas.append({"Nodo": str(n), "gid": gid, "Preparada": prep})
        except psycopg.Error:
            filas.append({"Nodo": str(n), "gid": "— sin conexión —", "Preparada": None})
    return pd.DataFrame(filas, columns=["Nodo", "gid", "Preparada"])


izq, der = st.columns(2)
with izq.container(border=True):
    st.markdown("**1 · Simular la caída del coordinador**")
    st.caption("Lanza un traspaso de 7 unidades del producto 11 (almacén 201 Santa Cruz → 601 Beni) "
               "y detiene el coordinador a la mitad del protocolo.")
    momento = st.segmented_control(
        "Momento de la caída", ["preparado", "decision"], default="preparado", required=True,
        format_func={"preparado": "Tras PREPARE (sin decisión)", "decision": "Tras decidir COMMIT"}.get)
    if st.button("Lanzar traspaso y hacer caer el coordinador", type="primary", icon=":material/bolt:"):
        r = subprocess.run([sys.executable, "-m", "sgbdd.coordinador_2pc", "--origen", "201", "--destino", "601",
                            "--producto", "11", "--cantidad", "7", "--caer-en", momento],
                           cwd=RAIZ, capture_output=True, text=True, encoding="utf-8")
        st.code(r.stdout.strip() or r.stderr.strip(), language="text")
        if r.returncode in (3, 4):
            st.warning("El coordinador cayó: quedaron transacciones en duda en Santa Cruz y Beni.",
                       icon=":material/hourglass_top:")
        comun.refrescar()

with der.container(border=True):
    st.markdown("**2 · Resolver las transacciones en duda**")
    edad = st.slider("Resolver solo las preparadas hace más de (s)", 0, 120, 0,
                     help="En producción se espera un margen para no interferir con traspasos en curso.")
    if st.button("Ejecutar recuperación", icon=":material/healing:"):
        mensajes = []
        try:
            recuperar(edad, informar=mensajes.append)
            st.success(f"{len(mensajes)} acciones de recuperación", icon=":material/check_circle:")
        except psycopg.Error as e:
            st.error(f"Nodo 3 sin conexión: no se puede leer la decisión ({str(e).splitlines()[0]})")
        if mensajes:
            st.code("\n".join(mensajes), language="text")
        comun.refrescar()

with st.container(border=True):
    st.markdown("**Transacciones preparadas en cada nodo** · `pg_prepared_xacts`")
    df = en_duda()
    if df.empty:
        st.caption(":material/check_circle: No hay transacciones en duda en ningún nodo.")
    else:
        st.dataframe(df, hide_index=True, alt="Transacciones preparadas")
