import psycopg
import streamlit as st

import comun
from sgbdd import operacion as op
from sgbdd.config import NODOS

st.caption("Una venta es una transacción 100 % local: usa el catálogo replicado, el cliente (FC1) y el "
           "inventario del propio nodo. Por eso funciona aunque el nodo esté aislado de la red.")

estado = {f["cod"]: f["estado"] for f in comun.estado()}

c1, c2 = st.columns(2, vertical_alignment="bottom")
cod = c1.selectbox("Sucursal", list(NODOS), format_func=lambda c: str(NODOS[c]))
nodo = NODOS[cod]
dep = c2.segmented_control("Departamento", nodo.deptos, default=nodo.deptos[0], required=True)

with st.container(border=True):
    with st.container(horizontal=True, vertical_alignment="center"):
        st.markdown(f"**{nodo}** · contenedor `{nodo.contenedor}`")
        comun.distintivo(estado[cod])
    st.code(f"SELECT * FROM venta_demo('{dep}');   -- como rol_cajero, en la consola local del nodo",
            language="sql")
    st.caption("`venta_demo` elige un cliente y productos al azar y llama a `registrar_venta`, que bloquea el "
               "inventario (FOR UPDATE), descuenta el stock y rechaza la venta si no alcanza.")

if st.button("Registrar venta", type="primary", icon=":material/point_of_sale:"):
    try:
        if nodo.local:  # consola del servidor: no depende de la red
            v = op.vender_local(nodo, dep)
        else:
            v = comun.consulta(nodo, "SELECT * FROM venta_demo(%s)", (dep,), "rol_cajero").iloc[0].to_dict()
            v = {"id_venta": v["id_venta"], "departamento": v["departamento_id"],
                 "total_bs": float(v["total_bs"]), "productos": v["productos"]}
        a, b, c = st.columns(3)
        a.metric("Venta", f"#{v['id_venta']}", border=True)
        b.metric("Total", f"Bs {v['total_bs']:,.2f}", border=True)
        c.metric("Productos", v["productos"], border=True)
        st.success(f"Venta registrada en {nodo} (departamento {v['departamento']}). "
                   f"El id empieza con {nodo.num}: identifica al nodo que la creó.", icon=":material/check_circle:")
        comun.refrescar()
    except (RuntimeError, psycopg.Error) as e:
        st.error(str(e).splitlines()[0] if str(e) else "sin respuesta del nodo",
                 title="No se pudo registrar la venta", icon=":material/error:")
