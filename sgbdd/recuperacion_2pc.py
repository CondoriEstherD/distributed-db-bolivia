"""Recuperación de transacciones 2PC en duda (el coordinador cayó tras PREPARE).

Regla (presunción de aborto): si traspasos_log registra COMMIT → COMMIT PREPARED;
en cualquier otro caso → ROLLBACK PREPARED. Sin acceso al log no se decide nada.

Uso: python -m sgbdd.recuperacion_2pc [--edad-minima 30]
"""
import argparse

import psycopg
from psycopg import sql

from .config import NODOS, conectar
from .coordinador_2pc import NODO_LOG, USUARIO


def recuperar(edad_minima=30, informar=print):
    """Resuelve las transacciones preparadas con más de `edad_minima` segundos.

    La edad mínima evita interferir con un traspaso que se está ejecutando ahora.
    Devuelve una lista de (nodo, gid, acción).
    """
    with conectar(NODO_LOG, USUARIO, autocommit=True) as c:
        estados = dict(c.execute("SELECT gid, estado FROM traspasos_log WHERE estado <> 'ABORTADO'").fetchall())

    resueltas = []
    for nodo in NODOS.values():
        try:
            conn = conectar(nodo, USUARIO, autocommit=True)
        except psycopg.OperationalError:
            informar(f"{nodo}: sin conexión, se reintentará en la próxima recuperación")
            continue
        with conn:
            pendientes = conn.execute(
                """SELECT gid FROM pg_prepared_xacts
                   WHERE gid LIKE 'trp-%%' AND database = current_database()
                     AND prepared < now() - make_interval(secs => %s)""", (edad_minima,)).fetchall()
            for (gid,) in pendientes:
                tid = gid.rsplit("-", 1)[0]
                commit = estados.get(tid) == "COMMIT"
                orden = "COMMIT PREPARED" if commit else "ROLLBACK PREPARED"
                conn.execute(sql.SQL(orden + " {}").format(sql.Literal(gid)))
                resueltas.append((nodo, gid, orden))
                informar(f"{nodo}: {orden} '{gid}' (estado en log: {estados.get(tid, 'sin registro')})")

    abortados = {gid.rsplit("-", 1)[0] for _, gid, orden in resueltas if orden.startswith("ROLLBACK")}
    if abortados:
        with conectar(NODO_LOG, USUARIO, autocommit=True) as c:
            c.execute("""UPDATE traspasos_log SET estado = 'ABORTADO', actualizado_en = now(),
                             detalle = 'Resuelto por recuperación (presunción de aborto)'
                         WHERE gid = ANY(%s) AND estado IN ('INICIADO', 'PREPARADO')""", (list(abortados),))
    if not resueltas:
        informar("No hay transacciones en duda")
    return resueltas


def main():
    p = argparse.ArgumentParser(description="Recupera transacciones 2PC en duda")
    p.add_argument("--edad-minima", type=float, default=30, help="segundos (0 = todas)")
    recuperar(p.parse_args().edad_minima)


if __name__ == "__main__":
    main()
