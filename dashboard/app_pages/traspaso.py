import pandas as pd
import psycopg
import streamlit as st

import comun
from sgbdd.config import nodo_de_almacen
from sgbdd.coordinador_2pc import ACREDITAR, DESCONTAR, TraspasoError, traspasar

st.caption("Mover mercadería entre almacenes de dos sucursales es una transacción distribuida: todos los "
           "productos se confirman en ambos nodos, o no se mueve ninguno. El coordinador aplica el compromiso "
           "en dos fases (2PC). Cada sucursal tiene su propio stock; el TOTAL NACIONAL de cada producto no "
           "cambia: el traspaso solo lo mueve de lugar.")

SQL_STOCK = "SELECT id_producto, stock_actual FROM inventario WHERE id_almacen = %s AND id_producto = ANY(%s)"
SQL_NACIONAL = """SELECT id_producto, sum(stock_actual)::int FROM inventario_nacional
WHERE id_producto = ANY(%s) GROUP BY 1"""

alm = comun.almacenes()
c1, c2 = st.columns(2)
origen = c1.selectbox("Almacén de origen", alm, index=alm.index(201), format_func=comun.etiqueta_almacen)
destino = c2.selectbox("Almacén de destino", alm, index=alm.index(601), format_func=comun.etiqueta_almacen)
n_origen, n_destino = nodo_de_almacen(origen), nodo_de_almacen(destino)

# Un traspaso necesita a las DOS sucursales (fase 1 en ambas). Si una está fuera de línea no se
# intenta: sus ventas locales siguen permitidas, pero el traspaso que la involucra no.
bloqueo = None
if n_origen == n_destino:
    bloqueo = "El origen y el destino son de la misma sucursal: un traspaso es entre sucursales distintas."
else:
    caidos = [n for n in (n_origen, n_destino) if not comun.en_linea(n.cod)]
    if caidos:
        bloqueo = (f"{' y '.join(str(n) for n in caidos)} sin conexión. El 2PC necesita el voto de ambas "
                   "sucursales, así que el traspaso no se permite. Las ventas locales de esa sucursal siguen "
                   "permitidas (autonomía local).")
if bloqueo:
    st.error(bloqueo, title="Traspaso no permitido", icon=":material/block:")

catalogo = comun.productos()
elegidos = st.multiselect("Productos a traspasar", list(catalogo), default=[10] if 10 in catalogo else None,
                          format_func=comun.etiqueta_producto, placeholder="Elija uno o más productos",
                          disabled=bool(bloqueo))


def leer_stock(almacen, prods):
    try:
        df = comun.consulta(nodo_de_almacen(almacen), SQL_STOCK, (almacen, prods), "fdw_lector")
        return dict(df.itertuples(index=False))
    except psycopg.Error:
        return None


def leer_nacional(prods):
    """Suma de los 6 fragmentos de inventario: requiere todos los nodos en línea."""
    if not all(f["en_linea"] for f in comun.estado()):  # evita esperar el tiempo límite de la red
        return None
    try:
        return dict(comun.consulta(comun.LP, SQL_NACIONAL, (prods,)).itertuples(index=False))
    except psycopg.Error:
        return None


def foto(prods):
    return leer_stock(origen, prods), leer_stock(destino, prods), leer_nacional(prods)


if elegidos and not bloqueo:
    st_o, st_d, nac = foto(elegidos)
    tabla = pd.DataFrame({"id": elegidos, "producto": [catalogo[p][0] for p in elegidos],
                          "stock_origen": [(st_o or {}).get(p) for p in elegidos],
                          "stock_destino": [(st_d or {}).get(p) for p in elegidos],
                          "stock_nacional": [(nac or {}).get(p) for p in elegidos],
                          "cantidad": [min(10, (st_o or {}).get(p) or 10) for p in elegidos]})
    st.markdown(f"**Cantidades a mover** · {comun.etiqueta_almacen(origen)} → {comun.etiqueta_almacen(destino)}")
    editada = st.data_editor(
        tabla, hide_index=True, key=f"traspaso_{origen}_{destino}_{'-'.join(map(str, elegidos))}",
        disabled=["id", "producto", "stock_origen", "stock_destino", "stock_nacional"],
        column_config={"cantidad": st.column_config.NumberColumn("Cantidad", min_value=1, step=1, required=True),
                       "stock_nacional": st.column_config.NumberColumn(
                           "Stock nacional", help="Suma de los almacenes de las 6 sucursales (inventario_nacional)")})
    if nac is None:
        st.caption(":material/info: Stock nacional no disponible: requiere los 6 nodos en línea.")
    items = {int(r.id): int(r.cantidad) for r in editada.itertuples()}
    excede = [catalogo[p][0] for p, q in items.items() if st_o and q > (st_o.get(p) or 0)]
    if excede:
        st.warning(f"Supera el stock de origen: {', '.join(excede)}. El origen votará NO y el traspaso completo "
                   "se abortará (puede probarlo).", icon=":material/warning:")

    pausa = st.slider("Pausa después de cada PREPARE (s)", 0, 30, 0,
                      help="Da tiempo para cortar el enlace de una sucursal durante el traspaso (portal de Azure → "
                           "vm-xx → Ejecutar comando → tailscale down) y ver cómo se revierte en ambas.")

    with st.expander("SQL que ejecuta cada participante", icon=":material/code:"):
        st.code(f"-- Fase 1 · origen, una sentencia por producto (vota NO si alguno no alcanza)\nBEGIN;{DESCONTAR};"
                f"  -- × {len(items)}\nPREPARE TRANSACTION '<gid>-{n_origen.cod}';\n\n"
                f"-- Fase 1 · destino\nBEGIN;{ACREDITAR};  -- × {len(items)}\n"
                f"PREPARE TRANSACTION '<gid>-{n_destino.cod}';\n\n"
                "-- Decisión registrada en traspasos_log (Nodo 3, Cochabamba)\n\n"
                "-- Fase 2 · en ambos\nCOMMIT PREPARED '<gid>-…';   -- o ROLLBACK PREPARED", language="sql")

    if st.button("Ejecutar traspaso", type="primary", icon=":material/sync_alt:"):
        with st.status("Compromiso en dos fases…", expanded=True) as caja:
            try:
                tid = traspasar(origen, destino, items, pausa, informar=caja.write)
                caja.update(label=f"Traspaso confirmado en ambas sucursales · {tid}", state="complete")
            except (TraspasoError, ValueError) as e:
                caja.update(label=f"Traspaso abortado: {e}", state="error")
        d_o, d_d, d_nac = foto(elegidos)
        resultado = pd.DataFrame({
            "producto": [catalogo[p][0] for p in elegidos],
            "origen antes → después": [f"{(st_o or {}).get(p)} → {(d_o or {}).get(p)}" for p in elegidos],
            "destino antes → después": [f"{(st_d or {}).get(p)} → {(d_d or {}).get(p)}" for p in elegidos],
            "nacional antes → después": [f"{(nac or {}).get(p)} → {(d_nac or {}).get(p)}" for p in elegidos]})
        st.dataframe(resultado, hide_index=True, alt="Stock antes y después del traspaso")
        if nac and d_nac:
            if nac == d_nac:
                st.success("Stock nacional conservado en todos los productos: la mercadería se movió, no se creó "
                           "ni se perdió.", icon=":material/balance:")
            else:
                st.error("El stock nacional cambió: hay ventas o traspasos concurrentes en curso.",
                         icon=":material/error:")
        st.caption("Si el traspaso se abortó, ningún stock cambia en ninguna de las dos sucursales: es la "
                   "atomicidad del 2PC.")
        comun.refrescar()

with st.container(border=True):
    st.markdown("**Últimas decisiones del coordinador** · `traspasos_log` en el Nodo 3 (Cochabamba)")
    try:
        log = comun.consulta(comun.NODOS["cb"], """SELECT gid, origen, destino, id_almacen_origen AS alm_origen,
                                                          id_almacen_destino AS alm_destino,
                                                          COALESCE(items::text, id_producto || ': ' || cantidad)
                                                              AS productos,
                                                          estado, detalle, creado_en::timestamp(0) AS fecha
                                                   FROM traspasos_log ORDER BY creado_en DESC LIMIT 10""",
                             usuario="fdw_lector")
        st.dataframe(log, hide_index=True, alt="Registro de traspasos")
        st.caption("productos = {id_producto: cantidad}")
    except psycopg.Error as e:
        st.caption(f"Nodo 3 sin conexión: {str(e).splitlines()[0]}")
