"""Mide el efecto de la latencia del enlace de Beni (tarea 6A, sección 7.4 de la especificación).

Modo lab. Por cada latencia (0, 300 y 800 ms) mide la consulta C1, un traspaso 2PC de Santa Cruz
a Beni y la propagación de un cambio del catálogo a Beni. Al terminar deja la latencia en 0.
Uso:  python -m pruebas.medir_latencia
"""
import time

import psycopg

from sgbdd import operacion as op
from sgbdd.config import RAIZ
from sgbdd.coordinador_2pc import TraspasoError, traspasar
from pruebas.ejecutar_pruebas import (ALM_BE, ALM_SC, BE, LP, cambiar_precio, consultar, esperar,
                                      precio, silencio)

C1 = (RAIZ / "sql/consultas/consultas_distribuidas.sql").read_text(encoding="utf-8") \
    .split("-- [C1]")[1].split("-- [C2]")[0].split("\n", 1)[1]


def cronometrar(funcion):
    """Segundos que tarda, o el motivo si el gestor la corta (p. ej. statement_timeout de 8 s)."""
    inicio = time.perf_counter()
    try:
        funcion()
    except (psycopg.Error, TraspasoError) as e:
        return f"cancelada tras {time.perf_counter() - inicio:.1f} s ({str(e).splitlines()[0][:50]})"
    return f"{time.perf_counter() - inicio:.2f} s"


def main():
    print("| Latencia de Beni | C1 (consulta nacional) | Traspaso 2PC SC → BE | Catálogo LP → BE |")
    print("|---|---|---|---|")
    try:
        for ms in (0, 300, 800):
            op.latencia(BE, ms)
            c1 = cronometrar(lambda: consultar(LP, C1))
            trp = cronometrar(lambda: traspasar(ALM_SC, ALM_BE, 10, 1, informar=silencio))
            _, nuevo = cambiar_precio(1)
            cat = esperar(lambda: precio(BE, 1) == nuevo, 60)
            print(f"| {ms} ms | {c1} | {trp} | {cat:.1f} s |", flush=True)
    finally:
        op.latencia(BE, 0)


if __name__ == "__main__":
    main()
