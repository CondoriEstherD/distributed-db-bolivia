import pandas as pd
import psycopg
import streamlit as st

import comun
from sgbdd.config import NODOS

st.caption("Sistema de Gestión Logística Nacional · 6 nodos PostgreSQL 16, un contenedor por nodo. "
           "Fragmentación horizontal y vertical, replicación lógica, postgres_fdw y 2PC.")

estado = comun.estado()
en_linea = sum(f["en_linea"] for f in estado)
ventas = sum(f["ventas"] or 0 for f in estado)
pendientes = sum(f["2pc_pendientes"] or 0 for f in estado)
suscritas = sum(f["replicacion"] == "suscripción activa" for f in estado)

c1, c2, c3, c4 = st.columns(4)
c1.metric("Nodos en línea", f"{en_linea} / 6", border=True)
c2.metric("Ventas registradas", comun.miles(ventas), border=True,
          help="Suma de las ventas de los nodos que responden.")
c3.metric("Réplicas del catálogo activas", f"{suscritas} / 5", border=True)
c4.metric("Transacciones 2PC en duda", pendientes, border=True,
          help="Transacciones preparadas sin resolver (pg_prepared_xacts).")

st.subheader("Nodos", icon=":material/dns:")
for fila in (estado[:3], estado[3:]):
    for col, f in zip(st.columns(3), fila):
        nodo = NODOS[f["cod"]]
        with col.container(border=True):
            with st.container(horizontal=True, vertical_alignment="center"):
                st.markdown(f"**{f['nodo']}**")
                comun.distintivo(f["estado"])
            st.caption(f"Departamentos: {', '.join(nodo.deptos)} · `{f['contenedor']}` · {f['direccion']}")
            a, b = st.columns(2)
            a.metric("Ventas", "—" if f["ventas"] is None else comun.miles(f["ventas"]))
            b.metric("2PC en duda", "—" if f["2pc_pendientes"] is None else f["2pc_pendientes"])
            st.caption(f":material/sync: {f['replicacion']}")

izq, der = st.columns([3, 2])
with izq.container(border=True):
    st.markdown("**Ventas por departamento** · consulta global desde el Nodo 1")
    try:
        df = comun.consulta(comun.LP, """SELECT departamento_id AS departamento, count(*) AS ventas,
                                                sum(total_bs)::float AS total_bs
                                         FROM ventas_nacionales GROUP BY 1 ORDER BY 3 DESC""")
        st.bar_chart(df, x="departamento", y="total_bs", y_label="Total (Bs)", height=300,
                     alt="Total vendido por departamento")
    except psycopg.Error as e:
        st.warning(f"No disponible: {str(e).splitlines()[0]}", title="Consulta nacional interrumpida",
                   icon=":material/cloud_off:")
        st.caption("Es el comportamiento esperado si un nodo está caído. "
                   "La página «Simulación de fallas» muestra la consulta tolerante.")

with der.container(border=True):
    st.markdown("**Diseño de distribución**")
    st.dataframe(pd.DataFrame([
        ("ventas, almacenes", "Horizontal primaria", "Nodo del departamento"),
        ("detalle_venta, inventario", "Horizontal derivada", "Junto a su venta / almacén"),
        ("clientes (FC1)", "Vertical: datos generales", "Nodos 1 a 6"),
        ("clientes (FC2)", "Vertical: datos financieros", "Solo Nodo 1"),
        ("productos_catalogo", "Replicación total", "Maestro en Nodo 1"),
        ("traspasos_log", "Registro del 2PC", "Nodo 3"),
    ], columns=["Relación", "Técnica", "Ubicación"]), hide_index=True, alt="Diseño de distribución")
