"""Vista de UNA sucursal: lo que guarda su propio servidor (fragmentos locales y réplica del catálogo).

Todo se lee directamente de la base del nodo (bd_xx), no de La Paz: así se ve que cada sucursal
tiene solo sus ventas y su stock, y que el catálogo (productos y precios) es el mismo en todas.
"""
import json

import pandas as pd
import psycopg
import streamlit as st

import comun
from sgbdd import operacion as op
from sgbdd.config import MODO, NODOS

SQL_RESUMEN = """SELECT departamento_id AS departamento, count(*) AS ventas, sum(total_bs)::float AS total_bs
FROM ventas GROUP BY 1 ORDER BY 1"""
SQL_ULTIMAS = """SELECT v.id_venta, v.fecha_hora::timestamp(0) AS fecha, v.departamento_id AS depto,
       c.razon_social AS cliente, v.total_bs::float AS total_bs
FROM ventas v JOIN clientes_datos_generales c USING (id_cliente)
ORDER BY v.id_venta DESC LIMIT 25"""
SQL_DETALLE = """SELECT d.id_producto, p.nombre, d.cantidad, d.precio_aplicado::float AS precio,
       d.subtotal::float AS subtotal
FROM detalle_venta d JOIN productos_catalogo p USING (id_producto)
WHERE d.id_venta = %s ORDER BY d.id_detalle"""
SQL_INVENTARIO = """SELECT a.id_almacen, a.nombre_almacen AS almacen, i.id_producto, p.nombre AS producto,
       i.stock_actual, i.stock_minimo
FROM inventario i
JOIN almacenes a USING (id_almacen)
JOIN productos_catalogo p USING (id_producto)
ORDER BY a.id_almacen, i.id_producto"""
SQL_CATALOGO = """SELECT id_producto, codigo_barras, nombre, categoria, precio_unitario::float AS precio_bs
FROM productos_catalogo ORDER BY id_producto"""
SQL_CLIENTES = """SELECT id_cliente, razon_social, nit_ci FROM clientes_datos_generales
WHERE departamento_id = %s ORDER BY id_cliente"""
SQL_STOCK_DEPTO = """SELECT i.id_producto, sum(i.stock_actual)::int AS stock
FROM inventario i JOIN almacenes a USING (id_almacen)
WHERE a.departamento_id = %s AND i.id_producto = ANY(%s) GROUP BY 1"""


@st.cache_data(ttl=10, show_spinner=False)
def leer(cod, sql, params=None):
    """Lectura en la base de la sucursal con el rol de solo lectura."""
    return comun.consulta(NODOS[cod], sql, params, "fdw_lector")


def registrar_venta(nodo, dep, cliente, items):
    """Transacción 100 % local en la sucursal: registrar_venta() valida catálogo, cliente y stock."""
    empleado = nodo.num * 100 + 1
    try:
        fila = comun.consulta(nodo, "SELECT registrar_venta(%s, %s, %s, %s::jsonb) AS id_venta",
                              (dep, cliente, empleado, json.dumps(items)), "rol_cajero")
        return int(fila.id_venta[0])
    except psycopg.OperationalError:
        if not nodo.local:
            raise
        # Modo lab con el nodo aislado: la consola local del servidor no usa la red.
        filas = op.consola(nodo, f"SELECT registrar_venta('{dep}', {int(cliente)}, {empleado}, "
                                 f"'{json.dumps(items)}'::jsonb)", usuario="rol_cajero")
        return int(filas[0][0])


def sin_conexion(nodo):
    st.warning(f"La consola no alcanza el servidor de {nodo.nombre}. Desde aquí no se pueden ver sus datos "
               "ni hacer traspasos con esta sucursal.", title="Sucursal sin conexión", icon=":material/wifi_off:")
    st.markdown(f"""**La sucursal sigue operando por su cuenta** (autonomía local): sus ventas se registran
en su propio servidor. Para demostrarlo, ejecute en el servidor de la sucursal
{"(portal de Azure → **vm-" + nodo.cod + "** → **Ejecutar comando** → RunShellScript):" if MODO == "red" else ":"}""")
    st.code(f"docker exec {nodo.contenedor} psql -U rol_cajero -d {nodo.bd} "
            f"-c \"SELECT * FROM venta_demo('{nodo.deptos[0]}')\"", language="bash")
    if MODO == "red":
        st.caption("Restablecer el enlace: `tailscale up` (caída de red) o `docker start "
                   f"{nodo.contenedor}` (servidor apagado) en la misma pantalla del portal.")


def mostrar(cod):
    nodo = NODOS[cod]
    fila = next(f for f in comun.estado() if f["cod"] == cod)

    with st.container(horizontal=True, vertical_alignment="center"):
        st.markdown(f"Departamentos **{', '.join(nodo.deptos)}** · servidor "
                    f"{'`vm-' + cod + '` · ' if MODO == 'red' else ''}`{fila['direccion']}` · "
                    f"contenedor `{nodo.contenedor}` · base `{nodo.bd}`")
        comun.distintivo(fila["estado"])
    st.caption("Todo lo de esta página se lee de la base de ESTA sucursal: sus ventas (fragmento horizontal), "
               "su inventario (fragmento derivado) y su copia del catálogo (réplica de La Paz).")

    if not fila["en_linea"]:
        sin_conexion(nodo)
        return

    try:
        resumen, inventario = leer(cod, SQL_RESUMEN), leer(cod, SQL_INVENTARIO)
    except psycopg.Error as e:
        st.error(str(e).splitlines()[0], title="No se pudo leer la sucursal", icon=":material/error:")
        return

    a, b, c, d = st.columns(4)
    a.metric("Ventas de la sucursal", comun.miles(resumen.ventas.sum()), border=True)
    b.metric("Total vendido", f"Bs {resumen.total_bs.sum():,.0f}", border=True)
    c.metric("Unidades en sus almacenes", comun.miles(inventario.stock_actual.sum()), border=True)
    d.metric("Productos bajo el mínimo", int((inventario.stock_actual < inventario.stock_minimo).sum()),
             border=True, help="Filas de inventario con stock_actual < stock_minimo.")

    t_ventas, t_inv, t_cat, t_vender = st.tabs(["Ventas", "Inventario", "Catálogo y precios", "Registrar venta"])

    with t_ventas:
        st.caption(f"Fragmento **FV{nodo.num}** = σ departamento ∈ {{{', '.join(nodo.deptos)}}} (VENTAS). "
                   "Ninguna venta de otro departamento puede guardarse aquí (restricción CHECK).")
        st.dataframe(resumen, hide_index=True, alt="Ventas por departamento",
                     column_config={"total_bs": st.column_config.NumberColumn("Total (Bs)", format="%.2f")})
        ultimas = leer(cod, SQL_ULTIMAS)
        st.markdown("**Últimas ventas** · elija una para ver su detalle")
        sel = st.dataframe(ultimas, hide_index=True, on_select="rerun", selection_mode="single-row",
                           key=f"ventas_{cod}", alt="Últimas ventas",
                           column_config={"total_bs": st.column_config.NumberColumn("Total (Bs)", format="%.2f")})
        if sel.selection.rows:
            venta = int(ultimas.id_venta[sel.selection.rows[0]])
            st.markdown(f"**Detalle de la venta #{venta}** (fragmento derivado FDV{nodo.num})")
            st.dataframe(leer(cod, SQL_DETALLE, (venta,)), hide_index=True, alt="Detalle de la venta")
        with st.expander("SQL ejecutado en " + nodo.bd, icon=":material/code:"):
            st.code(f"{SQL_RESUMEN};\n\n{SQL_ULTIMAS};", language="sql")

    with t_inv:
        st.caption(f"Fragmento **FI{nodo.num}** = INVENTARIO ⋉ almacenes de la sucursal. El stock es propio de "
                   "cada sucursal: los mismos productos, con cantidades distintas en cada nodo.")
        filtro = st.text_input("Buscar producto", key=f"buscar_inv_{cod}", placeholder="nombre o id")
        vista = inventario
        if filtro:
            vista = vista[vista.producto.str.contains(filtro, case=False) |
                          (vista.id_producto.astype(str) == filtro.strip())]
        st.dataframe(vista, hide_index=True, alt="Inventario de la sucursal",
                     column_config={"stock_actual": st.column_config.ProgressColumn(
                         "Stock actual", format="%d", min_value=0, max_value=int(inventario.stock_actual.max()))})
        with st.expander("SQL ejecutado en " + nodo.bd, icon=":material/code:"):
            st.code(SQL_INVENTARIO + ";", language="sql")

    with t_cat:
        st.caption("Réplica total del catálogo (maestro en La Paz, replicación lógica). Los productos y los "
                   "precios son los mismos en los 6 nodos; en las réplicas la escritura está revocada.")
        st.dataframe(leer(cod, SQL_CATALOGO), hide_index=True, alt="Catálogo de productos",
                     column_config={"precio_bs": st.column_config.NumberColumn("Precio (Bs)", format="%.2f")})

    with t_vender:
        formulario_venta(nodo)


def formulario_venta(nodo):
    cod = nodo.cod
    st.caption("Transacción 100 % local: usa el catálogo replicado, el cliente (FC1) y el inventario de esta "
               "sucursal. No necesita a ningún otro nodo.")
    dep = (st.segmented_control("Departamento", nodo.deptos, default=nodo.deptos[0], required=True,
                                key=f"dep_{cod}") if len(nodo.deptos) > 1 else nodo.deptos[0])
    clientes = leer(cod, SQL_CLIENTES, (dep,))
    nombres = dict(zip(clientes.id_cliente, clientes.razon_social + " · NIT " + clientes.nit_ci))
    cliente = st.selectbox("Cliente", list(nombres), format_func=nombres.get, key=f"cliente_{cod}_{dep}")
    catalogo = comun.productos()
    elegidos = st.multiselect("Productos", list(catalogo), format_func=comun.etiqueta_producto,
                              key=f"prod_venta_{cod}", placeholder="Elija uno o más productos")
    if not elegidos:
        return
    stock = dict(leer(cod, SQL_STOCK_DEPTO, (dep, elegidos)).itertuples(index=False))
    tabla = pd.DataFrame({"id": elegidos,
                          "producto": [catalogo[p][0] for p in elegidos],
                          "precio_bs": [catalogo[p][1] for p in elegidos],
                          f"stock_en_{dep}": [stock.get(p, 0) for p in elegidos],
                          "cantidad": [1] * len(elegidos)})
    editada = st.data_editor(tabla, hide_index=True, key=f"items_{cod}_{dep}_{'-'.join(map(str, elegidos))}",
                             disabled=["id", "producto", "precio_bs", f"stock_en_{dep}"],
                             column_config={"cantidad": st.column_config.NumberColumn("Cantidad", min_value=1,
                                                                                      step=1, required=True),
                                            "precio_bs": st.column_config.NumberColumn("Precio (Bs)",
                                                                                       format="%.2f")})
    items = [{"id_producto": int(r.id), "cantidad": int(r.cantidad)} for r in editada.itertuples()]
    st.markdown(f"**Total: Bs {sum(r.precio_bs * r.cantidad for r in editada.itertuples()):,.2f}**")
    st.code(f"SELECT registrar_venta('{dep}', {cliente}, {nodo.num * 100 + 1},\n"
            f"       '{json.dumps(items)}'::jsonb);   -- como rol_cajero, en {nodo.bd}", language="sql")
    if st.button("Registrar venta", type="primary", icon=":material/point_of_sale:", key=f"vender_{cod}"):
        try:
            venta = registrar_venta(nodo, dep, cliente, items)
            st.success(f"Venta #{venta} registrada en {nodo}. El id empieza con {nodo.num}: lo asignó esta "
                       "sucursal sin consultar a ninguna otra.", icon=":material/check_circle:")
            leer.clear()
            comun.refrescar()
        except (psycopg.Error, RuntimeError) as e:
            st.error(str(e).splitlines()[0] if str(e) else "sin respuesta del nodo",
                     title="Venta rechazada", icon=":material/error:")
