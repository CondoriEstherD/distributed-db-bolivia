"""Panel de demostración del SGBDD (Streamlit). Ejecutar desde la raíz del proyecto:

    streamlit run dashboard/app.py

Regla del panel: cada acción muestra el SQL que ejecuta. Lo evaluado es la base de datos.
"""
import re
import sys
from pathlib import Path

import pandas as pd
import psycopg
import streamlit as st

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from sgbdd import operacion as op  # noqa: E402
from sgbdd.config import MODO, NODOS, RAIZ, conectar, nodo_de_almacen  # noqa: E402
from sgbdd.coordinador_2pc import ACREDITAR, DESCONTAR, TraspasoError, traspasar  # noqa: E402
from sgbdd.recuperacion_2pc import recuperar  # noqa: E402

LP = NODOS["lp"]
st.set_page_config(page_title="SGBDD BoliviaDistribución", page_icon="🗄️", layout="wide")


# ------------------------------------------------------------------ utilidades
def consulta(nodo, sql, params=None, usuario="rol_analista"):
    with conectar(nodo, usuario, autocommit=True) as c:
        cur = c.execute(sql, params)
        return pd.DataFrame(cur.fetchall(), columns=[d.name for d in cur.description])


def leer(nodo, sql):
    """Lee por red; si el nodo está aislado y es local, por su consola."""
    try:
        with conectar(nodo, "fdw_lector", autocommit=True) as c:
            fila = c.execute(sql).fetchone()
            return None if fila is None else fila[0]
    except psycopg.OperationalError:
        if nodo.local:
            filas = op.consola(nodo, sql)
            return filas[0][0] if filas else None
        return None


@st.cache_data
def consultas_predefinidas():
    texto = (RAIZ / "sql/consultas/consultas_distribuidas.sql").read_text(encoding="utf-8")
    bloques = re.split(r"^-- \[(C\d+)\] (.+?) \| (\w+)\s*$", texto, flags=re.M)
    return {f"{bloques[i]} · {bloques[i + 1]}": (bloques[i + 3].strip(), bloques[i + 2])
            for i in range(1, len(bloques), 4)}


def almacenes():
    return [n.num * 100 + k for n in NODOS.values() for k in range(1, 2 * len(n.deptos) + 1)]


def etiqueta_almacen(a):
    return f"{a} · {nodo_de_almacen(a).nombre}"


# ------------------------------------------------------------------ encabezado
st.title("BoliviaDistribución S.A. — Sistema de Base de Datos Distribuida")
st.caption(f"Modo **{MODO}** · 6 nodos PostgreSQL 16 · fragmentación horizontal y vertical, "
           "replicación lógica, postgres_fdw y 2PC")

t_nodos, t_cons, t_venta, t_2pc, t_cat, t_fallas = st.tabs(
    ["🖥️ Nodos", "🌐 Consultas nacionales", "🧾 Venta local", "🔁 Traspaso 2PC", "📦 Catálogo", "⚡ Fallas"])

# ------------------------------------------------------------------ nodos
with t_nodos:
    estado = pd.DataFrame(op.estado_nodos())
    c1, c2, c3 = st.columns(3)
    c1.metric("Nodos en línea", f"{int(estado.en_linea.sum())} / 6")
    c2.metric("Ventas visibles", f"{int(estado.ventas.fillna(0).sum()):,}".replace(",", "."))
    c3.metric("Transacciones 2PC en duda", int(estado["2pc_pendientes"].fillna(0).sum()))
    st.dataframe(estado.assign(en_linea=estado.en_linea.map({True: "🟢 sí", False: "🔴 NO"})),
                 hide_index=True, width="stretch")
    st.button("Actualizar", key="refrescar_nodos")

# ------------------------------------------------------------------ consultas
with t_cons:
    consultas = consultas_predefinidas()
    elegida = st.selectbox("Consulta distribuida (se ejecuta en el Nodo 1 · La Paz)", list(consultas))
    sql, rol = consultas[elegida]
    st.code(sql, language="sql")
    plan = st.checkbox("Mostrar plan de ejecución (EXPLAIN VERBOSE): fragmentos consultados y SQL remoto")
    if st.button("Ejecutar", type="primary"):
        try:
            df = consulta(LP, sql, usuario=rol)
            st.success(f"{len(df)} filas · ejecutado como `{rol}`")
            st.dataframe(df, hide_index=True, width="stretch")
            if elegida.startswith("C1"):
                st.bar_chart(df.set_index("departamento_id")["total_bs"].astype(float))
            if plan:
                texto = consulta(LP, "EXPLAIN (VERBOSE, COSTS OFF) " + sql.rstrip(";"), usuario=rol)
                st.code("\n".join(texto.iloc[:, 0]), language="text")
        except psycopg.Error as e:
            st.error(f"La consulta falló: {str(e).splitlines()[0]}")
            st.info("Si un nodo está aislado, pruebe C6 (solo SC) o C7 (resumen tolerante a fallos).")

# ------------------------------------------------------------------ venta local
with t_venta:
    st.write("Una venta es una transacción **100 % local**: catálogo (réplica), cliente (FC1) e "
             "inventario del propio nodo. Funciona aunque el nodo esté aislado de la WAN.")
    nodo = NODOS[st.selectbox("Sucursal", list(NODOS), format_func=lambda c: str(NODOS[c]))]
    dep = st.selectbox("Departamento", nodo.deptos)
    st.code(f"SELECT * FROM venta_demo('{dep}');  -- en {nodo.contenedor}, como rol_cajero", language="sql")
    if st.button("Registrar venta", type="primary"):
        try:
            if nodo.local:
                st.success(op.vender_local(nodo, dep))
            else:
                st.dataframe(consulta(nodo, "SELECT * FROM venta_demo(%s)", (dep,), "rol_cajero"))
        except (RuntimeError, psycopg.Error) as e:
            st.error(str(e).splitlines()[0])

# ------------------------------------------------------------------ traspaso 2PC
with t_2pc:
    c1, c2, c3, c4 = st.columns(4)
    origen = c1.selectbox("Almacén origen", almacenes(), index=almacenes().index(201), format_func=etiqueta_almacen)
    destino = c2.selectbox("Almacén destino", almacenes(), index=almacenes().index(601), format_func=etiqueta_almacen)
    producto = c3.number_input("Producto", 1, 200, 10)
    cantidad = c4.number_input("Cantidad", 1, 10_000, 50)
    pausa = st.slider("Pausa tras cada PREPARE (s) — tiempo para aislar un nodo desde la pestaña ⚡ Fallas "
                      "o con `python gestion.py aislar be`", 0, 30, 0)
    with st.expander("SQL que ejecuta cada participante"):
        st.code(f"-- Origen (vota NO si no hay stock)\nBEGIN;{DESCONTAR};\nPREPARE TRANSACTION '<gid>-origen';\n\n"
                f"-- Destino\nBEGIN;{ACREDITAR};\nPREPARE TRANSACTION '<gid>-destino';\n\n"
                "-- Fase 2\nCOMMIT PREPARED '<gid>-…';   -- o ROLLBACK PREPARED", language="sql")

    def stocks():
        sql = "SELECT stock_actual FROM inventario WHERE id_almacen = {} AND id_producto = {}"
        return (leer(nodo_de_almacen(origen), sql.format(origen, producto)),
                leer(nodo_de_almacen(destino), sql.format(destino, producto)))

    if st.button("Ejecutar traspaso", type="primary"):
        antes = stocks()
        with st.status("Protocolo de compromiso en dos fases…", expanded=True) as caja:
            try:
                traspasar(origen, destino, int(producto), int(cantidad), pausa, informar=caja.write)
                caja.update(label="Traspaso CONFIRMADO en ambos nodos", state="complete")
            except (TraspasoError, ValueError) as e:
                caja.update(label=f"Traspaso ABORTADO: {e}", state="error")
        despues = stocks()
        st.table(pd.DataFrame({"almacén": [etiqueta_almacen(origen), etiqueta_almacen(destino)],
                               "stock antes": antes, "stock después": despues}))

# ------------------------------------------------------------------ catálogo
with t_cat:
    st.write("El catálogo se modifica **solo en La Paz** y se replica de forma asíncrona "
             "(consistencia eventual). En los nodos 2-6 la escritura está revocada.")
    c1, c2 = st.columns(2)
    prod = c1.number_input("Producto", 1, 200, 1, key="cat_prod")
    actual = leer(LP, f"SELECT precio_unitario FROM productos_catalogo WHERE id_producto = {int(prod)}")
    nuevo = c2.number_input("Nuevo precio (Bs)", 0.5, 100_000.0, float(actual or 1), step=0.5)
    st.code(f"UPDATE productos_catalogo SET precio_unitario = {nuevo:.2f} WHERE id_producto = {int(prod)};"
            "  -- Nodo 1, como rol_admin_catalogo", language="sql")
    if st.button("Actualizar precio en La Paz", type="primary"):
        with conectar(LP, "rol_admin_catalogo", autocommit=True) as c:
            c.execute("UPDATE productos_catalogo SET precio_unitario = %s WHERE id_producto = %s", (nuevo, prod))
        st.success("Publicado. Pulse «Ver precio en cada nodo» para observar la propagación.")
    if st.button("Ver precio en cada nodo"):
        sql = f"SELECT precio_unitario FROM productos_catalogo WHERE id_producto = {int(prod)}"
        st.table(pd.DataFrame({"nodo": [str(n) for n in NODOS.values()],
                               "precio": [leer(n, sql) or "sin conexión" for n in NODOS.values()]}))

# ------------------------------------------------------------------ fallas
with t_fallas:
    if MODO == "lab":
        st.write("Aislar un nodo lo desconecta de la WAN (`docker network disconnect`) **sin apagarlo**.")
        for n in NODOS.values():
            c1, c2, c3 = st.columns([3, 1, 1])
            c1.write(f"{'🔴 aislado' if op.aislado(n) else '🟢 conectado'} — {n}")
            if c2.button("Aislar", key=f"a_{n.cod}"):
                op.aislar(n); st.rerun()
            if c3.button("Reconectar", key=f"r_{n.cod}"):
                op.reconectar(n); st.rerun()
    else:
        st.info("Modo red: corte el enlace en el equipo del nodo con `tailscale down` (y `tailscale up`).")

    st.subheader("Transacciones 2PC en duda")
    edad = st.slider("Resolver solo las preparadas hace más de (s)", 0, 120, 30)
    if st.button("Ejecutar recuperación (presunción de aborto)"):
        mensajes = []
        recuperar(edad, informar=mensajes.append)
        st.write("\n\n".join(mensajes))
