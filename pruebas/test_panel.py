"""Pruebas del panel Streamlit sin navegador (streamlit.testing.v1.AppTest).

Modo lab, con los 6 nodos levantados y configurados. Pulsa los botones del panel como lo
haría el expositor y comprueba lo que muestra.
Uso:  python -m pruebas.test_panel
"""
import logging
import sys
import time

from streamlit.testing.v1 import AppTest

from sgbdd import operacion as op
from sgbdd.config import NODOS, RAIZ
from pruebas.ejecutar_pruebas import preparadas

sys.path.insert(0, str(RAIZ / "dashboard"))  # `import comun` de las páginas (streamlit run lo hace solo)
# Aviso inofensivo de AppTest al usar la caché fuera de `streamlit run`.
logging.getLogger("streamlit.runtime.scriptrunner_utils.script_run_context").disabled = True

PAGINAS = ("panorama", "consultas", "venta", "traspaso", "catalogo", "fallas", "recuperacion")
VERIFICACIONES = ("nacional", "otro", "tolerante", "venta_afectado", "venta_otro")


# ------------------------------------------------------------------ utilidades
def abrir(pagina):
    at = AppTest.from_file(str(RAIZ / "dashboard/app.py"), default_timeout=120)
    at.run()
    at.switch_page(f"app_pages/{pagina}.py").run()
    sin_error(at)
    return at


def sin_error(at):
    assert not at.exception, at.exception[0].message


def pulsar(at, etiqueta=None, key=None):
    boton = at.button(key=key) if key else next(b for b in at.button if b.label == etiqueta)
    boton.click().run()
    sin_error(at)


# ------------------------------------------------------------------ casos
def carga():
    """Las 7 páginas abren sin errores"""
    for pagina in PAGINAS:
        abrir(pagina)
    return f"{len(PAGINAS)} páginas cargadas"


def consultas():
    """Las 8 consultas distribuidas se ejecutan"""
    at = abrir("consultas")
    opciones = at.selectbox[0].options
    for opcion in opciones:
        at.selectbox[0].set_value(opcion).run()
        pulsar(at, "Ejecutar consulta")
        assert at.success, f"{opcion}: sin st.success ({[e.value for e in at.error]})"
    return f"{len(opciones)} consultas con resultado"


def fallas(tipo, deben_fallar):
    at = abrir("fallas")
    at.segmented_control[0].set_value(tipo).run()
    pulsar(at, "Provocar falla")
    for clave in VERIFICACIONES:
        pulsar(at, key=f"probar_{clave}")
    resultados = at.session_state["fallas_res"]
    obtenido = {c for c in VERIFICACIONES if not resultados[c][0]}
    assert obtenido == deben_fallar, f"fallaron {sorted(obtenido)}, se esperaba {sorted(deben_fallar)}"
    pulsar(at, "Restaurar nodo")
    return f"fallan {sorted(obtenido)}; las otras {len(VERIFICACIONES) - len(obtenido)} funcionan; nodo restaurado"


def fallas_cortar():
    """Simulación de fallas: cortar el enlace de Beni"""
    return fallas("Cortar el enlace de red", {"nacional"})


def fallas_apagar():
    """Simulación de fallas: apagar el servidor de Beni"""
    return fallas("Apagar el servidor", {"nacional", "venta_afectado"})


def recuperacion():
    """Recuperación 2PC tras las dos caídas del coordinador"""
    at = abrir("recuperacion")
    # Una caída a la vez: la transacción en duda bloquea las filas que usaría el siguiente traspaso.
    for momento in ("preparado", "decision"):
        at.segmented_control[0].set_value(momento).run()
        pulsar(at, "Lanzar traspaso y hacer caer el coordinador")
        assert at.warning, f"caída en «{momento}»: el coordinador no cayó ({at.code[-1].value})"
        pulsar(at, "Ejecutar recuperación")
        en_duda = sum(preparadas(n) for n in NODOS.values())
        assert en_duda == 0, f"caída en «{momento}»: quedan {en_duda} transacciones en duda"
    return "2 caídas del coordinador resueltas; 0 transacciones en duda"


PRUEBAS = (carga, consultas, fallas_cortar, fallas_apagar, recuperacion)


def main():
    resultados = []
    for prueba in PRUEBAS:
        print(f"▶ {prueba.__doc__}…", flush=True)
        inicio = time.time()
        try:
            detalle, ok = prueba(), True
        except Exception as e:  # una prueba fallida no detiene las demás
            detalle, ok = f"{e.__class__.__name__}: {e}", False
        finally:
            for nodo in NODOS.values():
                if op.apagado(nodo):
                    op.encender(nodo, informar=lambda *_: None)
                op.reconectar(nodo)
        resultados.append((prueba.__name__, ok))
        print(f"  {'✔ PASA' if ok else '✖ FALLA'} ({time.time() - inicio:.1f} s) — {detalle}", flush=True)
    fallas_ = [n for n, ok in resultados if not ok]
    print(f"\nResultado: {len(resultados) - len(fallas_)}/{len(resultados)} pruebas del panel pasan"
          + (f" · fallan: {', '.join(fallas_)}" if fallas_ else ""))
    sys.exit(1 if fallas_ else 0)


if __name__ == "__main__":
    main()
