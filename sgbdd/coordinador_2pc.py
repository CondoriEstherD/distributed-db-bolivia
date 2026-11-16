"""Coordinador del protocolo de compromiso en dos fases (2PC) para traspasos de inventario.

Fase 1 (votación): cada participante ejecuta su parte y PREPARE TRANSACTION.
Punto de decisión: el estado COMMIT queda escrito en traspasos_log (Nodo 3).
Fase 2: COMMIT PREPARED en todos, o ROLLBACK PREPARED en los que votaron SÍ.

postgres_fdw no permite PREPARE TRANSACTION sobre tablas foráneas, por eso el
coordinador se conecta directamente a cada nodo.

Uso: python -m sgbdd.coordinador_2pc --origen 201 --destino 601 --producto 15 --cantidad 50
"""
import argparse
import os
import time
import uuid
from datetime import datetime

import psycopg
from psycopg import sql
from psycopg.types.json import Jsonb

from .config import NODOS, conectar, nodo_de_almacen

USUARIO = "coordinador_2pc"
NODO_LOG = NODOS["cb"]

DESCONTAR = """
    UPDATE inventario SET stock_actual = stock_actual - %(cantidad)s
    WHERE id_almacen = %(almacen)s AND id_producto = %(producto)s
      AND stock_actual >= %(cantidad)s"""
ACREDITAR = """
    INSERT INTO inventario (id_almacen, id_producto, stock_actual)
    VALUES (%(almacen)s, %(producto)s, %(cantidad)s)
    ON CONFLICT (id_almacen, id_producto)
    DO UPDATE SET stock_actual = inventario.stock_actual + EXCLUDED.stock_actual"""


class TraspasoError(Exception):
    """El traspaso fue abortado; ningún participante quedó modificado."""


def _registrar(tid, estado, detalle=None, **datos):
    with conectar(NODO_LOG, USUARIO, autocommit=True) as c:
        if estado == "INICIADO":
            items = datos.pop("items")
            uno = len(items) == 1
            c.execute("""INSERT INTO traspasos_log (gid, origen, destino, id_almacen_origen,
                             id_almacen_destino, id_producto, cantidad, items, estado)
                         VALUES (%(gid)s, %(origen)s, %(destino)s, %(alm_o)s, %(alm_d)s,
                                 %(producto)s, %(cantidad)s, %(items)s, 'INICIADO')""",
                      {"gid": tid, **datos, "items": Jsonb({str(p): q for p, q in items.items()}),
                       "producto": next(iter(items)) if uno else None,
                       "cantidad": sum(items.values())})
        else:
            c.execute("""UPDATE traspasos_log SET estado = %s, detalle = %s, actualizado_en = now()
                         WHERE gid = %s""", (estado, detalle, tid))


def _resolver(nodo, gid, conn, commit, informar):
    """Fase 2 en un participante; si su conexión murió, reintenta con una nueva."""
    orden = "COMMIT PREPARED" if commit else "ROLLBACK PREPARED"
    try:
        conn.tpc_commit() if commit else conn.tpc_rollback()
    except psycopg.Error:
        try:
            with conectar(nodo, USUARIO, autocommit=True) as c:
                c.execute(sql.SQL(orden + " {}").format(sql.Literal(gid)))
        except psycopg.Error as e:
            informar(f"  ⚠ {nodo}: {orden} pendiente ({e.__class__.__name__}); "
                     "lo resolverá la recuperación")
            return
    finally:
        conn.close()
    informar(f"FASE 2 · {nodo}: {orden} '{gid}'")


def traspasar(alm_origen, alm_destino, items, pausa=0.0, informar=print, caer_en=None):
    """Traspasa varios productos entre almacenes de nodos distintos en UNA transacción 2PC:
    o se mueven todos los productos, o ninguno.

    items: {id_producto: cantidad, ...}
    pausa: segundos de espera tras cada PREPARE (para cortar un enlace en la demostración).
    caer_en: 'preparado' | 'decision' simula la caída del coordinador (prueba de recuperación).
    Devuelve el identificador del traspaso o lanza TraspasoError.
    """
    origen, destino = nodo_de_almacen(alm_origen), nodo_de_almacen(alm_destino)
    if origen == destino:
        raise ValueError("El traspaso debe ser entre almacenes de nodos distintos")
    # Orden fijo también dentro de cada nodo (id de producto): evita interbloqueos entre
    # traspasos concurrentes que comparten productos.
    items = {int(p): int(q) for p, q in sorted(items.items())}
    if not items:
        raise ValueError("Elija al menos un producto")
    if any(q <= 0 for q in items.values()):
        raise ValueError("Las cantidades deben ser positivas")

    tid = f"trp-{datetime.now():%Y%m%d%H%M%S}-{uuid.uuid4().hex[:6]}"
    try:
        _registrar(tid, "INICIADO", origen=origen.cod, destino=destino.cod, alm_o=alm_origen,
                   alm_d=alm_destino, items=items)
    except psycopg.Error as e:
        raise TraspasoError(f"registro de traspasos ({NODO_LOG}) no disponible: {e.__class__.__name__}") from e
    lista = ", ".join(f"{q} u. del producto {p}" for p, q in items.items())
    informar(f"Traspaso {tid}: {lista} · almacén {alm_origen} ({origen.nombre}) → "
             f"{alm_destino} ({destino.nombre})")

    # Orden fijo de bloqueo (id de almacén ascendente): evita interbloqueos distribuidos
    # entre traspasos cruzados SC→BE y BE→SC.
    participantes = sorted([(alm_origen, origen, DESCONTAR), (alm_destino, destino, ACREDITAR)])
    preparados = []
    try:
        for almacen, nodo, sentencia in participantes:
            gid = f"{tid}-{nodo.cod}"
            informar(f"FASE 1 · {nodo}: conectando…")
            conn = conectar(nodo, USUARIO)
            try:
                conn.tpc_begin(gid)
                for producto, cantidad in items.items():
                    cur = conn.execute(sentencia, {"almacen": almacen, "producto": producto, "cantidad": cantidad})
                    if sentencia is DESCONTAR and cur.rowcount == 0:
                        raise TraspasoError(f"stock insuficiente del producto {producto} en el almacén "
                                            f"{almacen} (voto NO)")
                conn.tpc_prepare()
            except BaseException:
                conn.close()  # sin PREPARE: cerrar la conexión revierte la transacción
                raise
            preparados.append((nodo, gid, conn))
            informar(f"FASE 1 · {nodo}: PREPARE TRANSACTION '{gid}' → voto SÍ")
            if pausa:
                informar(f"  … pausa de {pausa:g} s (momento para cortar un enlace)")
                time.sleep(pausa)

        _registrar(tid, "PREPARADO")
        if caer_en == "preparado":
            informar("✖ Simulación: el coordinador cae con los participantes PREPARADOS")
            os._exit(3)
        _registrar(tid, "COMMIT")  # ← punto de decisión irrevocable
        informar("DECISIÓN: COMMIT registrado en traspasos_log (Nodo 3)")
    except Exception as e:
        motivo = str(e).strip().splitlines()[0] if str(e).strip() else e.__class__.__name__
        informar(f"DECISIÓN: ABORTAR — {motivo}")
        try:
            _registrar(tid, "ABORTADO", motivo)
        except psycopg.Error:
            informar("  ⚠ no se pudo registrar ABORTADO; la recuperación lo deducirá (presunción de aborto)")
        for nodo, gid, conn in preparados:
            _resolver(nodo, gid, conn, False, informar)
        raise TraspasoError(motivo) from e

    if caer_en == "decision":
        informar("✖ Simulación: el coordinador cae después de decidir COMMIT")
        os._exit(4)
    for nodo, gid, conn in preparados:
        _resolver(nodo, gid, conn, True, informar)
    informar(f"✔ Traspaso {tid} confirmado en ambos nodos")
    return tid


def main():
    p = argparse.ArgumentParser(description="Traspaso interdepartamental con 2PC")
    p.add_argument("--origen", type=int, required=True, help="id del almacén de origen (ej. 201)")
    p.add_argument("--destino", type=int, required=True, help="id del almacén de destino (ej. 601)")
    p.add_argument("--producto", type=int, required=True)
    p.add_argument("--cantidad", type=int, required=True)
    p.add_argument("--pausa", type=float, default=0, help="segundos de pausa tras cada PREPARE")
    p.add_argument("--caer-en", choices=["preparado", "decision"], help="simula la caída del coordinador")
    a = p.parse_args()
    try:
        traspasar(a.origen, a.destino, {a.producto: a.cantidad}, a.pausa, caer_en=a.caer_en)
    except TraspasoError as e:
        raise SystemExit(f"Traspaso abortado: {e}")


if __name__ == "__main__":
    main()
