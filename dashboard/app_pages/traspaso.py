import streamlit as st

import comun
from sgbdd.config import nodo_de_almacen
from sgbdd.coordinador_2pc import ACREDITAR, DESCONTAR, TraspasoError, traspasar

st.caption("Mover mercadería entre almacenes de dos nodos es una transacción distribuida: o se confirma "
           "en ambos nodos o en ninguno. El coordinador aplica el compromiso en dos fases (2PC).")

alm = comun.almacenes()
with st.container(border=True):
    c1, c2, c3, c4 = st.columns(4)
    origen = c1.selectbox("Almacén de origen", alm, index=alm.index(201), format_func=comun.etiqueta_almacen)
    destino = c2.selectbox("Almacén de destino", alm, index=alm.index(601), format_func=comun.etiqueta_almacen)
    producto = c3.number_input("Producto (1 a 200)", 1, 200, 10)
    cantidad = c4.number_input("Cantidad", 1, 10_000, 50)
    pausa = st.slider("Pausa después de cada PREPARE (s)", 0, 30, 0,
                      help="Da tiempo para provocar una falla en «Simulación de fallas» o con "
                           "`python gestion.py aislar be` y ver cómo el traspaso se revierte.")

with st.expander("SQL que ejecuta cada participante", icon=":material/code:"):
    st.code(f"-- Fase 1 · origen (vota NO si no hay stock suficiente)\nBEGIN;{DESCONTAR};\n"
            "PREPARE TRANSACTION '<gid>-origen';\n\n"
            f"-- Fase 1 · destino\nBEGIN;{ACREDITAR};\nPREPARE TRANSACTION '<gid>-destino';\n\n"
            "-- Decisión registrada en traspasos_log (Nodo 3)\n\n"
            "-- Fase 2 · en ambos\nCOMMIT PREPARED '<gid>-…';   -- o ROLLBACK PREPARED", language="sql")


def stocks():
    sql = "SELECT stock_actual FROM inventario WHERE id_almacen = {} AND id_producto = {}"
    return (comun.leer(nodo_de_almacen(origen), sql.format(origen, producto)),
            comun.leer(nodo_de_almacen(destino), sql.format(destino, producto)))


if st.button("Ejecutar traspaso", type="primary", icon=":material/sync_alt:"):
    antes = stocks()
    with st.status("Compromiso en dos fases…", expanded=True) as caja:
        try:
            tid = traspasar(origen, destino, int(producto), int(cantidad), pausa, informar=caja.write)
            caja.update(label=f"Traspaso confirmado en ambos nodos · {tid}", state="complete")
        except (TraspasoError, ValueError) as e:
            caja.update(label=f"Traspaso abortado: {e}", state="error")
    despues = stocks()
    a, b = st.columns(2)
    for col, alm_id, x, y in ((a, origen, antes[0], despues[0]), (b, destino, antes[1], despues[1])):
        delta = None if None in (x, y) else int(y) - int(x)
        col.metric(f"Stock en {comun.etiqueta_almacen(alm_id)}", "sin conexión" if y is None else y,
                   delta, border=True)
    st.caption("Si el traspaso se abortó, ningún stock cambia: es la atomicidad del 2PC.")
    comun.refrescar()

with st.container(border=True):
    st.markdown("**Últimas decisiones del coordinador** · `traspasos_log` en el Nodo 3")
    try:
        log = comun.consulta(comun.NODOS["cb"], """SELECT gid, origen, destino, id_producto, cantidad, estado,
                                                          detalle, creado_en::timestamp(0) AS fecha
                                                   FROM traspasos_log ORDER BY creado_en DESC LIMIT 10""",
                             usuario="fdw_lector")
        st.dataframe(log, hide_index=True, alt="Registro de traspasos")
    except Exception as e:  # noqa: BLE001  (el Nodo 3 puede estar caído)
        st.caption(f"Nodo 3 sin conexión: {str(e).splitlines()[0]}")
