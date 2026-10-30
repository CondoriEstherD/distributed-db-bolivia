import pandas as pd
import streamlit as st

import comun
from sgbdd.config import NODOS, conectar

st.caption("El catálogo se modifica solo en La Paz (publicación `pub_catalogo`) y se replica de forma "
           "asíncrona a los nodos 2 a 6 (consistencia eventual). En las réplicas la escritura está revocada.")

prod = st.number_input("Producto (1 a 200)", 1, 200, 1)
sql_precio = f"SELECT precio_unitario FROM productos_catalogo WHERE id_producto = {int(prod)}"
actual = comun.leer(comun.LP, sql_precio)

izq, der = st.columns([2, 3])
with izq.container(border=True):
    st.markdown("**Cambiar el precio en el maestro (Nodo 1)**")
    nuevo = st.number_input("Nuevo precio (Bs)", 0.5, 100_000.0, float(actual or 1), step=0.5)
    st.code(f"UPDATE productos_catalogo SET precio_unitario = {nuevo:.2f}\nWHERE id_producto = {int(prod)};"
            "  -- como rol_admin_catalogo", language="sql")
    if st.button("Publicar cambio", type="primary", icon=":material/publish:"):
        with conectar(comun.LP, "rol_admin_catalogo", autocommit=True) as c:
            c.execute("UPDATE productos_catalogo SET precio_unitario = %s WHERE id_producto = %s", (nuevo, prod))
        st.toast("Cambio publicado en La Paz", icon=":material/check_circle:")


@st.fragment(run_every="3s")
def propagacion():
    estado = {f["cod"]: f["estado"] for f in comun.estado()}
    maestro = comun.leer(comun.LP, sql_precio)
    filas = []
    for n in NODOS.values():
        precio = comun.leer(n, sql_precio)
        sincronizado = precio is not None and maestro is not None and float(precio) == float(maestro)
        filas.append({"Nodo": str(n), "Estado": estado[n.cod].capitalize(),
                      "Precio (Bs)": None if precio is None else float(precio),
                      "Réplica": "maestro" if n is comun.LP else
                                 ("sin conexión" if precio is None else
                                  "sincronizada" if sincronizado else "pendiente")})
    st.dataframe(pd.DataFrame(filas), hide_index=True, alt="Precio del producto en cada nodo",
                 column_config={"Precio (Bs)": st.column_config.NumberColumn(format="%.2f")})
    st.caption("Se actualiza cada 3 s. Un nodo aislado queda «pendiente» y se pone al día solo al reconectarse.")


with der.container(border=True):
    st.markdown("**Precio en cada nodo (en vivo)**")
    propagacion()
