import time

import psycopg
import streamlit as st

import comun
from sgbdd import operacion as op
from sgbdd.config import MODO, NODOS

CORTAR, APAGAR = "Cortar el enlace de red", "Apagar el servidor"

st.caption("Provoque la caída de un nodo y verifique, con consultas reales, qué sigue funcionando: "
           "autonomía local, transparencia y tolerancia a fallos.")

with st.expander("Guion sugerido para la defensa", icon=":material/checklist:"):
    st.markdown("""
1. Elegir **Nodo 6 · Beni** y la falla **Cortar el enlace de red**; pulsar **Provocar falla**.
2. **Consulta nacional completa** → falla de forma controlada en pocos segundos (no se bloquea).
3. **Consulta de otro departamento** → funciona: el optimizador no necesita el fragmento caído.
4. **Consulta tolerante** → informa qué fragmento está fuera de línea y entrega el resto.
5. **Venta en el nodo afectado** → con el enlace cortado, Beni sigue vendiendo (autonomía local).
6. Repetir con **Apagar el servidor**: ahora Beni no vende, pero los demás nodos sí.
7. **Restaurar el nodo** y comprobar en «Replicación del catálogo» que se pone al día solo.
""")

estado = {f["cod"]: f["estado"] for f in comun.estado()}
cods = list(NODOS)
c1, c2 = st.columns([1, 2], vertical_alignment="bottom")
cod = c1.selectbox("Nodo", cods, index=cods.index("be"), format_func=lambda c: str(NODOS[c]))
tipo = c2.segmented_control("Tipo de falla", [CORTAR, APAGAR], default=CORTAR, required=True)
nodo = NODOS[cod]
otro = NODOS["sc"] if cod != "sc" else NODOS["cb"]

with st.container(border=True):
    with st.container(horizontal=True, vertical_alignment="center"):
        st.markdown(f"**{nodo}** · `{nodo.contenedor}` · estado actual:")
        comun.distintivo(estado[cod])
    if tipo == CORTAR:
        st.caption("Simula la caída del enlace WAN del departamento (`docker network disconnect`). "
                   "El servidor sigue encendido y atiende a su sucursal. En la red de 7 equipos: "
                   "`tailscale down` en el equipo del nodo.")
    else:
        st.caption("Simula la caída total del servidor (`docker stop`). El nodo deja de atender incluso "
                   "localmente; al encenderlo, PostgreSQL se recupera y la réplica se sincroniza sola.")

    posible = nodo.local and (tipo == APAGAR or MODO == "lab")
    with st.container(horizontal=True):
        provocar = st.button("Provocar falla", type="primary", icon=":material/bolt:",
                             disabled=not posible or estado[cod] != "EN LÍNEA")
        restaurar = st.button("Restaurar nodo", icon=":material/restart_alt:",
                              disabled=not nodo.local or estado[cod] == "EN LÍNEA")
    if not posible:
        st.caption(":material/info: Este nodo no está en este equipo: provoque la falla en su equipo.")

if provocar:
    with st.spinner("Provocando la falla…"):
        if tipo == CORTAR:
            op.aislar(nodo)
        else:
            op.apagar(nodo)
    st.session_state.pop("fallas_res", None)
    comun.refrescar()
    st.rerun()
if restaurar:
    with st.spinner("Restaurando el nodo (encender puede tardar unos segundos)…"):
        if op.apagado(nodo):
            op.encender(nodo, informar=lambda *_: None)
        if MODO == "lab":
            op.reconectar(nodo)
    st.session_state.pop("fallas_res", None)
    comun.refrescar()
    st.rerun()

st.subheader("Verificar el comportamiento", icon=":material/fact_check:")
resultados = st.session_state.setdefault("fallas_res", {})


def probar(clave, funcion):
    inicio = time.perf_counter()
    try:
        texto, tabla = funcion()
        resultados[clave] = (True, texto, tabla, time.perf_counter() - inicio)
    except (psycopg.Error, RuntimeError) as e:
        resultados[clave] = (False, str(e).splitlines()[0] if str(e) else "sin respuesta",
                             None, time.perf_counter() - inicio)


def mostrar(clave):
    if clave not in resultados:
        return
    ok, texto, tabla, seg = resultados[clave]
    if ok:
        st.success(texto, icon=":material/check_circle:")
    else:
        st.error(texto, icon=":material/cancel:")
    st.caption(f"Tiempo de respuesta: {seg:.1f} s")
    if tabla is not None:
        st.dataframe(tabla, hide_index=True, alt="Resultado")


def consulta_nacional():
    df = comun.consulta(comun.LP, "SELECT count(*) AS ventas FROM ventas_nacionales")
    return f"{comun.miles(df.ventas[0])} ventas en todo el país", None


def consulta_otro():
    dep = otro.deptos[0]
    df = comun.consulta(comun.LP, "SELECT count(*) AS ventas FROM ventas_nacionales WHERE departamento_id = %s",
                        (dep,))
    return f"{comun.miles(df.ventas[0])} ventas de {dep}: solo se consultó el fragmento de {otro.nombre}", None


def consulta_tolerante():
    df = comun.consulta(comun.LP, """SELECT fragmento, departamento_id, ventas, estado
                                     FROM resumen_nacional_disponible() ORDER BY fragmento, departamento_id""")
    caidos = df[df.estado.str.startswith("FUERA")].fragmento.tolist()
    return (f"Fragmentos fuera de línea: {', '.join(caidos)}" if caidos else "Los 6 fragmentos responden"), df


def venta(n):
    def _():
        v = op.vender_local(n) if n.local else comun.consulta(
            n, "SELECT * FROM venta_demo(%s)", (n.deptos[0],), "rol_cajero").iloc[0]
        return f"{n.nombre} registró la venta #{v['id_venta']} (Bs {float(v['total_bs']):,.2f})", None
    return _


casos = [
    ("nacional", "Consulta nacional completa", ":material/public:",
     "Necesita los 6 fragmentos: con un nodo caído debe fallar rápido y de forma controlada.", consulta_nacional),
    ("otro", f"Consulta solo de {otro.deptos[0]}", ":material/filter_alt:",
     "Eliminación de fragmentos: no toca el nodo caído.", consulta_otro),
    ("tolerante", "Consulta tolerante a fallos", ":material/shield:",
     "`resumen_nacional_disponible()` consulta fragmento por fragmento.", consulta_tolerante),
    ("venta_afectado", f"Venta en {nodo.nombre}", ":material/point_of_sale:",
     "Enlace cortado: vende (autonomía). Servidor apagado: no vende.", venta(nodo)),
    ("venta_otro", f"Venta en {otro.nombre}", ":material/storefront:",
     "Los demás nodos siguen operando con normalidad.", venta(otro)),
]
for fila in (casos[:3], casos[3:]):
    for col, (clave, titulo, icono, ayuda, funcion) in zip(st.columns(3), fila):
        with col.container(border=True):
            st.markdown(f"{icono} **{titulo}**")
            st.caption(ayuda)
            if st.button("Probar", key=f"probar_{clave}", icon=":material/play_arrow:"):
                with st.spinner("Ejecutando…"):
                    probar(clave, funcion)
            mostrar(clave)
