"""Consola de operación del SGBDD BoliviaDistribución.

  python gestion.py levantar [--admin]   levanta los nodos de NODOS_LOCALES (y pgAdmin)
  python gestion.py configurar           suscripciones al catálogo + esquema global en La Paz
  python gestion.py estado               salud, volumen y replicación de los 6 nodos
  python gestion.py verificar            conectividad entre equipos y contenedores (antes de configurar)
  python gestion.py aislar be            corta el enlace WAN del nodo (modo lab)
  python gestion.py reconectar be        restablece el enlace
  python gestion.py apagar be            caída total: detiene el servidor del nodo
  python gestion.py encender be          vuelve a encender el nodo
  python gestion.py latencia be 300      retardo de 300 ms en el enlace de Beni (0 lo quita)
  python gestion.py vender be            venta de demostración en la consola local del nodo
  python gestion.py sql lp "SELECT 1"    SQL en la consola local de un nodo (superusuario)
  python gestion.py recuperar            resuelve transacciones 2PC en duda
  python gestion.py respaldar be         copia la base del nodo en respaldos/
  python gestion.py restaurar be <archivo> --si   vuelve el nodo al estado del respaldo
  python gestion.py reiniciar --si       BORRA contenedores y datos
"""
import argparse
import shutil
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent
if not (RAIZ / ".env").exists():
    shutil.copy(RAIZ / ".env.example", RAIZ / ".env")
    print("Se creó .env a partir de .env.example — cambie las contraseñas antes de usarlo en red.")

from sgbdd import operacion as op  # noqa: E402  (necesita .env)
from sgbdd.config import NODOS  # noqa: E402
from sgbdd.recuperacion_2pc import recuperar  # noqa: E402


def _nodo(cod):
    if cod not in NODOS:
        raise argparse.ArgumentTypeError(f"nodo desconocido: {cod} (use {', '.join(NODOS)})")
    return NODOS[cod]


def cmd_estado(_):
    print(f"{'NODO':<24}{'EN LÍNEA':<10}{'VENTAS':>8}  {'2PC PEND.':>9}  REPLICACIÓN")
    for f in op.estado_nodos():
        ventas = "" if f["ventas"] is None else f"{f['ventas']:,}".replace(",", ".")
        pend = "" if f["2pc_pendientes"] is None else f["2pc_pendientes"]
        print(f"{f['nodo']:<24}{'sí' if f['en_linea'] else 'NO':<10}{ventas:>8}  {pend:>9}  {f['replicacion']}")


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="comando", required=True)
    s = sub.add_parser("levantar"); s.add_argument("--admin", action="store_true", help="incluye pgAdmin")
    sub.add_parser("configurar")
    sub.add_parser("estado")
    sub.add_parser("verificar")
    for nombre in ("aislar", "reconectar", "apagar", "encender", "vender", "respaldar"):
        sub.add_parser(nombre).add_argument("nodo", type=_nodo)
    s = sub.add_parser("latencia"); s.add_argument("nodo", type=_nodo); s.add_argument("ms", type=int)
    s = sub.add_parser("sql"); s.add_argument("nodo", type=_nodo); s.add_argument("consulta")
    s = sub.add_parser("restaurar"); s.add_argument("nodo", type=_nodo); s.add_argument("archivo", type=Path)
    s.add_argument("--si", action="store_true", help="confirma que se pierden los cambios posteriores")
    s = sub.add_parser("recuperar"); s.add_argument("--edad-minima", type=float, default=30)
    s = sub.add_parser("reiniciar"); s.add_argument("--si", action="store_true", help="confirma el borrado")
    a = p.parse_args()

    try:
        if a.comando == "levantar":
            print("Levantando nodos locales (la primera vez cargan sus datos: 1-3 min)…")
            op.levantar(a.admin)
            print("Siguiente paso: python gestion.py configurar")
        elif a.comando == "configurar":
            op.configurar()
        elif a.comando == "estado":
            cmd_estado(a)
        elif a.comando == "verificar":
            filas = op.verificar_red()
            for origen, destino, ok, detalle in filas:
                print(f"{'✔' if ok else '✖'} {origen:<14} → {destino:<22} {detalle}")
            fallas = sum(not ok for *_, ok, _ in filas)
            if fallas:
                sys.exit(f"{fallas} conexiones fallan: revise IP/puertos en .env, firewall y que el nodo esté levantado")
            print("Conectividad completa: puede ejecutar `configurar`.")
        elif a.comando == "aislar":
            op.aislar(a.nodo); print(f"{a.nodo} aislado de la WAN (sigue operando localmente)")
        elif a.comando == "reconectar":
            op.reconectar(a.nodo); print(f"{a.nodo} reconectado a la WAN")
        elif a.comando == "apagar":
            op.apagar(a.nodo); print(f"{a.nodo} APAGADO (servidor detenido)")
        elif a.comando == "encender":
            op.encender(a.nodo); print(f"{a.nodo} encendido; la réplica del catálogo se sincroniza sola")
        elif a.comando == "latencia":
            op.latencia(a.nodo, a.ms)
            print(f"{a.nodo}: latencia de {a.ms} ms" if a.ms else f"{a.nodo}: latencia eliminada")
        elif a.comando == "vender":
            print(op.vender_local(a.nodo))
        elif a.comando == "sql":
            for fila in op.consola(a.nodo, a.consulta):
                print(" | ".join(fila))
        elif a.comando == "respaldar":
            print(f"Respaldo de {a.nodo}: {op.respaldar(a.nodo)}")
        elif a.comando == "restaurar":
            if not a.archivo.is_file():
                sys.exit(f"No existe el archivo {a.archivo}")
            if not a.si:
                sys.exit(f"Esto reemplaza los datos de {a.nodo} por los del respaldo. Repita con --si para confirmar.")
            op.restaurar(a.nodo, a.archivo); print(f"{a.nodo} restaurado desde {a.archivo.name}")
        elif a.comando == "recuperar":
            recuperar(a.edad_minima)
        elif a.comando == "reiniciar":
            if not a.si:
                sys.exit("Esto borra TODOS los datos de los nodos. Repita con --si para confirmar.")
            op.reiniciar(); print("Contenedores y volúmenes eliminados.")
    except RuntimeError as e:
        sys.exit(f"Error: {e}")


if __name__ == "__main__":
    main()
