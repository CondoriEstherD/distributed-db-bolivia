"""Panel de demostración del SGBDD BoliviaDistribución. Ejecutar desde la raíz del proyecto:

    streamlit run dashboard/app.py

Regla del panel: cada acción muestra el SQL que ejecuta. Lo evaluado es la base de datos.
"""
import hmac
import sys
from pathlib import Path

import streamlit as st

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))  # paquete sgbdd

import comun  # noqa: E402
from sgbdd.config import ENV, MODO  # noqa: E402

st.set_page_config(page_title="SGBDD BoliviaDistribución", page_icon=":material/hub:", layout="wide")

# Panel publicado en internet (VPS): con PANEL_CLAVE en .env, pide la contraseña antes de mostrar
# cualquier página. Es una clave compartida del grupo; si se necesita identidad por persona,
# reemplazar por st.login con un proveedor OIDC.
CLAVE = ENV.get("PANEL_CLAVE", "")
if CLAVE and not st.session_state.get("autorizado"):
    with st.form("acceso", width=420):
        st.subheader("SGBDD BoliviaDistribución", icon=":material/lock:")
        clave = st.text_input("Contraseña del panel", type="password")
        if st.form_submit_button("Entrar", type="primary", icon=":material/login:"):
            if hmac.compare_digest(clave.encode(), CLAVE.encode()):
                st.session_state.autorizado = True
                st.rerun()
            st.error("Contraseña incorrecta", icon=":material/error:")
    st.stop()

pagina = st.navigation({
    "Monitoreo": [
        st.Page("app_pages/panorama.py", title="Panorama nacional", icon=":material/dashboard:", default=True),
    ],
    "Operaciones distribuidas": [
        st.Page("app_pages/consultas.py", title="Consultas distribuidas", icon=":material/travel_explore:"),
        st.Page("app_pages/venta.py", title="Venta local", icon=":material/point_of_sale:"),
        st.Page("app_pages/traspaso.py", title="Traspaso 2PC", icon=":material/sync_alt:"),
        st.Page("app_pages/catalogo.py", title="Replicación del catálogo", icon=":material/inventory_2:"),
    ],
    "Tolerancia a fallos": [
        st.Page("app_pages/fallas.py", title="Simulación de fallas", icon=":material/report:"),
        st.Page("app_pages/recuperacion.py", title="Recuperación 2PC", icon=":material/healing:"),
    ],
})

with st.sidebar:
    st.subheader("Estado de los nodos", icon=":material/lan:")
    for f in comun.estado():
        with st.container(horizontal=True, vertical_alignment="center"):
            st.markdown(f["nodo"].replace("Nodo ", "N"))
            comun.distintivo(f["estado"])
    if st.button("Actualizar", icon=":material/refresh:", width="stretch"):
        comun.refrescar()
        st.rerun()
    st.caption(f"Modo **{MODO}** · PostgreSQL 16 · 6 nodos")

st.title(pagina.title, icon=pagina.icon)
pagina.run()
