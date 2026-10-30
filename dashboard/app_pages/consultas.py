import re
import time

import psycopg
import streamlit as st

import comun

st.caption("El analista consulta el esquema `nacional` del Nodo 1 sin indicar nodos: "
           "las particiones remotas (postgres_fdw) ocultan dónde está cada fragmento.")

# Tablas locales de La Paz y particiones/tablas remotas (fvN_xx, fc1_xx, fdvN_xx, faN_xx, fiN_xx).
FRAGMENTO = (r"\b(?:nacional|public)\.(f[a-z]+\d?_[a-z]{2}|ventas|detalle_venta|inventario|almacenes|"
             r"clientes_datos_generales|clientes_financiero|productos_catalogo|traspasos_log)\b")

consultas = comun.consultas_predefinidas()
elegida = st.selectbox("Consulta", list(consultas))
sql, rol = consultas[elegida]

with st.container(border=True):
    with st.container(horizontal=True, vertical_alignment="center"):
        st.markdown("**SQL enviado al Nodo 1**")
        st.badge(f"rol {rol}", icon=":material/badge:", color="blue")
    st.code(sql, language="sql")

with st.container(horizontal=True, vertical_alignment="center"):
    ejecutar = st.button("Ejecutar consulta", type="primary", icon=":material/play_arrow:")
    plan = st.toggle("Mostrar plan de ejecución (fragmentos consultados y SQL remoto)")

if ejecutar:
    try:
        inicio = time.perf_counter()
        df = comun.consulta(comun.LP, sql, usuario=rol)
        ms = (time.perf_counter() - inicio) * 1000
        st.success(f"{len(df)} filas en {ms:.0f} ms", icon=":material/check_circle:")
        if elegida.startswith("C1"):
            st.bar_chart(df.assign(total_bs=df.total_bs.astype(float)), x="departamento_id", y="total_bs",
                         y_label="Total (Bs)", alt="Ventas por departamento")
        st.dataframe(df, hide_index=True, alt="Resultado de la consulta")
        if plan:
            texto = "\n".join(comun.consulta(comun.LP, "EXPLAIN (VERBOSE, COSTS OFF) " + sql.rstrip(";"),
                                             usuario=rol).iloc[:, 0])
            sin_sql_remoto = "\n".join(l for l in texto.splitlines() if "Remote SQL" not in l)
            fragmentos = sorted(set(re.findall(FRAGMENTO, sin_sql_remoto)))
            with st.container(border=True):
                st.markdown("**Fragmentos que consultó el optimizador**")
                st.markdown(" ".join(f":blue-badge[{f}]" for f in fragmentos) or "—")
                st.caption("Prefijo `f…N_xx` = fragmento remoto del nodo N (vía postgres_fdw) · "
                           "sin prefijo = tabla local de La Paz")
                st.code(texto, language="text")
    except psycopg.Error as e:
        st.error(str(e).splitlines()[0], title="La consulta falló", icon=":material/error:")
        st.caption("Si un nodo está caído, pruebe C6 (solo Santa Cruz) o C7 (resumen tolerante a fallos).")
