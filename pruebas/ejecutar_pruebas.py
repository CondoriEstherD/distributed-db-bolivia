"""Casos de prueba del plan de pruebas (sección 15 de la especificación).

Requiere MODO=lab con los 6 nodos locales levantados y configurados.
Uso:  python -m pruebas.ejecutar_pruebas            (todos)
      python -m pruebas.ejecutar_pruebas P7 P8      (algunos)
Cada prueba deja los nodos reconectados al terminar, pase o falle.
"""
import subprocess
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor

import psycopg

from sgbdd import operacion as op
from sgbdd.config import NODOS, RAIZ, conectar, nodo_de_almacen
from sgbdd.coordinador_2pc import TraspasoError, traspasar
from sgbdd.recuperacion_2pc import recuperar

LP, SC, CB, BE = NODOS["lp"], NODOS["sc"], NODOS["cb"], NODOS["be"]
ALM_SC, ALM_BE = 201, 601
silencio = lambda *_: None  # noqa: E731


# ------------------------------------------------------------------ utilidades
def consultar(nodo, sql, params=None, usuario="rol_analista"):
    with conectar(nodo, usuario, autocommit=True) as c:
        return c.execute(sql, params).fetchall()


def valor(nodo, sql):
    """Lectura por la consola local: funciona aunque el nodo esté aislado."""
    return op.consola(nodo, sql)[0][0]


def stock(almacen, producto):
    return int(valor(nodo_de_almacen(almacen),
                     f"SELECT stock_actual FROM inventario WHERE id_almacen={almacen} AND id_producto={producto}"))


def stock_nacional(producto):
    return sum(int(valor(n, f"SELECT coalesce(sum(stock_actual),0) FROM inventario WHERE id_producto={producto}"))
               for n in NODOS.values())


def preparadas(nodo):
    return int(valor(nodo, "SELECT count(*) FROM pg_prepared_xacts"))


def estado_log(tid):
    return valor(CB, f"SELECT estado FROM traspasos_log WHERE gid='{tid}'")


def ultimo_tid():
    return valor(CB, "SELECT gid FROM traspasos_log ORDER BY creado_en DESC LIMIT 1")


def precio(nodo, producto):
    return valor(nodo, f"SELECT precio_unitario FROM productos_catalogo WHERE id_producto={producto}")


def esperar(condicion, limite):
    inicio = time.time()
    while time.time() - inicio < limite:
        if condicion():
            return time.time() - inicio
        time.sleep(0.5)
    raise AssertionError(f"la condición no se cumplió en {limite} s")


def cambiar_precio(producto):
    viejo = precio(LP, producto)
    nuevo = f"{float(viejo) + 1:.2f}"
    with conectar(LP, "rol_admin_catalogo", autocommit=True) as c:
        c.execute("UPDATE productos_catalogo SET precio_unitario = %s WHERE id_producto = %s", (nuevo, producto))
    return viejo, nuevo


# ------------------------------------------------------------------ casos
def p0():
    """Reglas de corrección de la fragmentación"""
    total = int(valor(LP, "SELECT count(*) FROM nacional.ventas_nacionales"))
    deptos = int(valor(LP, "SELECT count(DISTINCT departamento_id) FROM nacional.ventas_nacionales"))
    duplicados = int(valor(LP, "SELECT count(*) FROM (SELECT id_venta FROM nacional.ventas_nacionales "
                               "GROUP BY id_venta HAVING count(*) > 1) d"))
    fc1 = int(valor(LP, "SELECT count(*) FROM nacional.clientes_nacionales"))
    reconstruidos = int(valor(LP, "SELECT count(*) FROM nacional.clientes_completo"))
    huerfanos = int(valor(LP, "SELECT count(*) FROM clientes_financiero f LEFT JOIN nacional.clientes_nacionales c "
                              "USING (id_cliente) WHERE c.id_cliente IS NULL"))
    assert total >= 50_000, f"solo {total} ventas"
    assert deptos == 9, f"{deptos} departamentos con ventas"
    assert duplicados == 0, f"{duplicados} ids en dos fragmentos"
    assert reconstruidos == fc1 and huerfanos == 0
    miles = lambda n: f"{n:,}".replace(",", ".")  # noqa: E731
    return (f"completitud: {miles(total)} ventas en 9 departamentos · disyunción: 0 duplicados · "
            f"reconstrucción: FC1⋈FC2 = {miles(reconstruidos)} clientes, 0 huérfanos")


def p1():
    """Autonomía local (Beni aislado)"""
    op.aislar(BE)
    v_be = op.vender_local(BE)
    v_sc = op.vender_local(SC)
    return f"Beni aislado vendió #{v_be['id_venta']} (Bs {v_be['total_bs']}); Santa Cruz vendió #{v_sc['id_venta']}"


def p2():
    """Consulta global con un nodo caído"""
    op.aislar(BE)
    inicio = time.time()
    try:
        consultar(LP, "SELECT count(*) FROM ventas_nacionales")
    except psycopg.Error as e:
        segundos = time.time() - inicio
        assert segundos <= 6, f"tardó {segundos:.1f} s"
        return f"error controlado en {segundos:.1f} s: {str(e).splitlines()[0]}"
    raise AssertionError("la consulta global no detectó el nodo caído")


def p3():
    """Eliminación de fragmentos con un nodo caído"""
    op.aislar(BE)
    n = consultar(LP, "SELECT count(*) FROM ventas_nacionales WHERE departamento_id = 'SC'")[0][0]
    assert n > 0
    return f"{n:,} ventas de SC consultadas sin tocar el fragmento de Beni".replace(",", ".")


def p4():
    """Consulta tolerante a fallos"""
    op.aislar(BE)
    filas = consultar(LP, "SELECT fragmento, estado FROM resumen_nacional_disponible()")
    caidos = {f for f, e in filas if e.startswith("FUERA")}
    en_linea = {f for f, e in filas if e == "EN LÍNEA"}
    assert len(caidos) == 1 and caidos.pop().endswith("fv6_be"), caidos
    assert len(en_linea) == 5, en_linea
    return "5 fragmentos EN LÍNEA; fv6_be (Beni) FUERA DE LÍNEA"


def p5():
    """Consistencia eventual del catálogo"""
    op.aislar(BE)
    viejo, nuevo = cambiar_precio(1)
    t = esperar(lambda: precio(SC, 1) == nuevo, 15)
    assert precio(BE, 1) == viejo, "Beni aislado no debería tener el precio nuevo"
    return f"precio {viejo} → {nuevo}: Santa Cruz actualizado en {t:.1f} s; Beni conserva {viejo}"


def p6():
    """Sincronización diferida al reconectar"""
    op.aislar(BE)
    _, nuevo = cambiar_precio(1)
    time.sleep(1)
    op.reconectar(BE)
    t = esperar(lambda: precio(BE, 1) == nuevo, 90)
    return f"Beni recibió el precio {nuevo} {t:.1f} s después de reconectarse"


def p7():
    """Traspaso 2PC exitoso SC → BE"""
    o, d, total = stock(ALM_SC, 10), stock(ALM_BE, 10), stock_nacional(10)
    tid = traspasar(ALM_SC, ALM_BE, 10, 5, informar=silencio)
    assert stock(ALM_SC, 10) == o - 5 and stock(ALM_BE, 10) == d + 5
    assert stock_nacional(10) == total and estado_log(tid) == "COMMIT"
    return f"SC {o}→{o - 5}, BE {d}→{d + 5}; stock nacional {total} sin cambio; log COMMIT"


def p8():
    """Caída del destino durante el 2PC → rollback en origen"""
    o, d = stock(ALM_SC, 10), stock(ALM_BE, 10)
    threading.Timer(1.5, op.aislar, (BE,)).start()  # corta Beni durante la pausa tras el PREPARE de SC
    try:
        traspasar(ALM_SC, ALM_BE, 10, 5, pausa=4, informar=silencio)
    except TraspasoError as e:
        motivo = str(e)
    else:
        raise AssertionError("el traspaso no debió confirmarse")
    op.reconectar(BE)
    tid = ultimo_tid()
    assert stock(ALM_SC, 10) == o and stock(ALM_BE, 10) == d, "stock alterado"
    assert preparadas(SC) == 0 and estado_log(tid) == "ABORTADO"
    return f"abortado ({motivo[:60]}…); SC intacto en {o}; 0 transacciones preparadas; log ABORTADO"


def p9():
    """Transacciones en duda y recuperación"""
    resultado = []
    for caida, codigo, esperado in (("preparado", 3, "ROLLBACK"), ("decision", 4, "COMMIT")):
        o, d = stock(ALM_SC, 11), stock(ALM_BE, 11)
        r = subprocess.run([sys.executable, "-m", "sgbdd.coordinador_2pc", "--origen", str(ALM_SC),
                            "--destino", str(ALM_BE), "--producto", "11", "--cantidad", "7",
                            "--caer-en", caida], cwd=RAIZ, capture_output=True)
        assert r.returncode == codigo, r.stderr.decode(errors="replace")
        assert preparadas(SC) == 1 and preparadas(BE) == 1, "deberían quedar 2 transacciones en duda"
        acciones = recuperar(edad_minima=0, informar=silencio)
        assert len(acciones) == 2 and all(a.startswith(esperado) for _, _, a in acciones), acciones
        assert preparadas(SC) == 0 and preparadas(BE) == 0
        delta = 7 if esperado == "COMMIT" else 0
        assert stock(ALM_SC, 11) == o - delta and stock(ALM_BE, 11) == d + delta
        resultado.append(f"caída en «{caida}» → {esperado} PREPARED en ambos")
    return "; ".join(resultado)


def p10():
    """Concurrencia: 20 traspasos simultáneos sobre 100 unidades"""
    op.consola(SC, f"UPDATE inventario SET stock_actual = 100 WHERE id_almacen={ALM_SC} AND id_producto=2")
    total = stock_nacional(2)

    def uno(_):
        try:
            traspasar(ALM_SC, ALM_BE, 2, 10, informar=silencio)
            return True
        except TraspasoError:
            return False

    with ThreadPoolExecutor(max_workers=20) as ex:
        confirmados = sum(ex.map(uno, range(20)))
    final = stock(ALM_SC, 2)
    assert final >= 0 and final == 100 - 10 * confirmados, f"stock final {final}"
    assert stock_nacional(2) == total, "se creó o perdió mercancía"
    assert preparadas(SC) == 0 and preparadas(BE) == 0
    return (f"{confirmados} confirmados, {20 - confirmados} rechazados; stock SC final {final} (≥ 0); "
            f"stock nacional {total} conservado")


def p11():
    """Seguridad: matriz CRUD aplicada por el gestor"""
    casos = [(SC, "rol_cajero", "UPDATE productos_catalogo SET precio_unitario = 1 WHERE id_producto = 1"),
             (SC, "rol_cajero", "SELECT * FROM clientes_financiero"),
             (LP, "rol_analista", "SELECT * FROM clientes_financiero"),
             (SC, "fdw_lector", "DELETE FROM ventas WHERE false")]
    for nodo, usuario, sql in casos:
        try:
            consultar(nodo, sql, usuario=usuario)
        except psycopg.Error:
            continue
        raise AssertionError(f"{usuario}@{nodo.cod} pudo ejecutar: {sql}")
    return "4/4 operaciones prohibidas fueron denegadas (catálogo en réplica, FC2, escritura remota)"


def p12():
    """Caída del nodo central (La Paz)"""
    op.aislar(LP)
    ventas = [op.vender_local(n)["id_venta"] for n in (SC, CB, BE)]
    return f"La Paz aislada; SC, CB y BE siguieron vendiendo: {ventas}"


PRUEBAS = {f.__name__.upper(): f for f in (p0, p1, p2, p3, p4, p5, p6, p7, p8, p9, p10, p11, p12)}


def main():
    elegidas = [a.upper() for a in sys.argv[1:]] or list(PRUEBAS)
    resultados = []
    for clave in elegidas:
        prueba = PRUEBAS[clave]
        print(f"▶ {clave} {prueba.__doc__}…", flush=True)
        inicio = time.time()
        try:
            detalle, ok = prueba(), True
        except Exception as e:  # una prueba fallida no detiene las demás
            detalle, ok = f"{e.__class__.__name__}: {e}", False
        finally:
            for nodo in NODOS.values():
                op.reconectar(nodo)
        resultados.append((clave, ok))
        print(f"  {'✔ PASA' if ok else '✖ FALLA'} ({time.time() - inicio:.1f} s) — {detalle}", flush=True)
    fallas = [c for c, ok in resultados if not ok]
    print(f"\nResultado: {len(resultados) - len(fallas)}/{len(resultados)} pruebas pasan"
          + (f" · fallan: {', '.join(fallas)}" if fallas else ""))
    sys.exit(1 if fallas else 0)


if __name__ == "__main__":
    main()
