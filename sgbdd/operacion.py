"""Operación de los nodos: despliegue, configuración entre nodos, estado y simulación de fallas.

Compartido por gestion.py (consola), el panel Streamlit y las pruebas.
"""
import subprocess
import time

import psycopg

from .config import MODO, NODOS, RAIZ, ENV, conectar

RED_WAN = "sgbdd_wan"


def docker(*args, check=True):
    r = subprocess.run(["docker", *args], cwd=RAIZ, text=True, encoding="utf-8",
                       capture_output=True)
    if check and r.returncode != 0:
        raise RuntimeError(f"docker {' '.join(args[:3])}…: {r.stderr.strip() or r.stdout.strip()}")
    return r


def locales():
    return [n for n in NODOS.values() if n.local]


# ------------------------------------------------------------------ consola local
def consola(nodo, comando, usuario="postgres"):
    """Ejecuta SQL en la consola LOCAL del servidor (socket dentro del contenedor).

    Representa al operador o cajero de la sucursal: no usa la red, así que
    funciona aunque el nodo esté aislado de la WAN. Devuelve filas como listas.
    """
    r = docker("exec", nodo.contenedor, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-A", "-t",
               "-F", "|", "-U", usuario, "-d", nodo.bd, "-c", comando, check=False)
    if r.returncode != 0:
        raise RuntimeError(r.stderr.strip())
    return [linea.split("|") for linea in r.stdout.strip().splitlines() if linea]


def ejecutar_archivo(nodo, ruta, **variables):
    args = ["exec", nodo.contenedor, "psql", "-X", "-q", "-v", "ON_ERROR_STOP=1",
            "-U", "postgres", "-d", nodo.bd, "-f", f"/sql/{ruta}"]
    for clave, valor in variables.items():
        args += ["-v", f"{clave}={valor}"]
    docker(*args)


def vender_local(nodo, departamento=None):
    """Registra una venta de demostración como cajero, en la consola local del nodo."""
    dep = departamento or nodo.deptos[0]
    fila = consola(nodo, f"SELECT * FROM venta_demo('{dep}')", usuario="rol_cajero")[0]
    return {"id_venta": int(fila[0]), "departamento": fila[1], "total_bs": float(fila[2]),
            "productos": int(fila[3])}


# ------------------------------------------------------------------ fallas de red
def _exigir_lab(nodo):
    if MODO != "lab" or not nodo.local:
        raise RuntimeError(f"En modo red, corte el enlace de {nodo} en su equipo: `tailscale down` "
                           "(y `tailscale up` para reconectar)")


def aislado(nodo) -> bool:
    r = docker("inspect", "-f", "{{json .NetworkSettings.Networks}}", nodo.contenedor, check=False)
    return r.returncode == 0 and RED_WAN not in r.stdout


def aislar(nodo):
    """Corta el enlace WAN del nodo. El nodo SIGUE funcionando localmente (autonomía)."""
    _exigir_lab(nodo)
    if not aislado(nodo):
        docker("network", "disconnect", RED_WAN, nodo.contenedor)


def reconectar(nodo):
    _exigir_lab(nodo)
    if aislado(nodo):
        docker("network", "connect", RED_WAN, nodo.contenedor)


# ------------------------------------------------------------------ despliegue
def levantar(admin=False, informar=print):
    servicios = [n.contenedor for n in locales()] + (["pgadmin"] if admin else [])
    args = ["compose"] + (["--profile", "admin"] if admin else []) + ["up", "-d", *servicios]
    docker(*args)
    esperar_sanos(locales(), informar)


def esperar_sanos(nodos, informar=print, limite=600):
    pendientes = {n.contenedor for n in nodos}
    inicio = time.time()
    while pendientes:
        for c in sorted(pendientes):
            estado = docker("inspect", "-f", "{{.State.Health.Status}}", c, check=False).stdout.strip()
            if estado == "healthy":
                pendientes.discard(c)
                informar(f"  ✔ {c} listo")
        if pendientes:
            if time.time() - inicio > limite:
                raise RuntimeError(f"Tiempo agotado esperando: {', '.join(sorted(pendientes))} "
                                   "(revise `docker logs <contenedor>`)")
            time.sleep(3)


def configurar(informar=print):
    """Configuración entre nodos (idempotente): suscripciones al catálogo y capa global en LP."""
    lp = NODOS["lp"]
    for nodo in locales():
        if nodo is lp:
            continue
        ejecutar_archivo(nodo, "replicas/post/10_suscripcion.sql", nodo_cod=nodo.cod,
                         lp_host=lp.host_interno, lp_port=lp.port_interno,
                         app_password=ENV["APP_PASSWORD"])
        informar(f"  ✔ {nodo}: suscrito al catálogo de La Paz")
    if lp.local:
        direcciones = {}
        for n in NODOS.values():
            if n is not lp:
                direcciones[f"h_{n.cod}"] = n.host_interno
                direcciones[f"p_{n.cod}"] = n.port_interno
        ejecutar_archivo(lp, "nodo1_lp/post/10_transparencia_fdw.sql",
                         app_password=ENV["APP_PASSWORD"], **direcciones)
        ejecutar_archivo(lp, "nodo1_lp/post/20_vistas_globales.sql")
        informar(f"  ✔ {lp}: servidores remotos y esquema global «nacional» creados")
        try:
            ejecutar_archivo(lp, "nodo1_lp/post/30_datos_financieros.sql")
            informar(f"  ✔ {lp}: fichas financieras (FC2) cargadas")
        except RuntimeError as e:
            informar(f"  ⚠ FC2 no cargado (¿todos los nodos en línea?): {e}. Repita `configurar` luego.")


def reiniciar():
    """Elimina contenedores y volúmenes: se pierden TODOS los datos."""
    docker("compose", "--profile", "admin", "down", "-v", "--remove-orphans")


# ------------------------------------------------------------------ estado
def estado_nodos():
    filas = []
    for nodo in NODOS.values():
        fila = {"nodo": str(nodo), "contenedor": nodo.contenedor, "direccion": f"{nodo.host}:{nodo.port}",
                "en_linea": False, "ventas": None, "2pc_pendientes": None, "replicacion": None}
        try:
            with conectar(nodo, "fdw_lector", autocommit=True) as c:
                ventas, pendientes = c.execute(
                    """SELECT (SELECT count(*) FROM ventas),
                              (SELECT count(*) FROM pg_prepared_xacts WHERE database = current_database())"""
                ).fetchone()
                if nodo.cod == "lp":
                    slots = c.execute("""SELECT count(*) FILTER (WHERE active), count(*)
                                         FROM pg_replication_slots""").fetchone()
                    replicacion = f"publicador: {slots[0]}/{slots[1]} suscriptores conectados"
                else:
                    sub = c.execute("""SELECT pid IS NOT NULL, latest_end_time FROM pg_stat_subscription
                                       WHERE subname LIKE 'sub_catalogo_%' LIMIT 1""").fetchone()
                    replicacion = ("sin suscripción" if sub is None
                                   else "suscripción activa" if sub[0] else "suscripción detenida")
            fila.update(en_linea=True, ventas=ventas, **{"2pc_pendientes": pendientes}, replicacion=replicacion)
        except psycopg.Error as e:
            fila["replicacion"] = f"sin conexión ({e.__class__.__name__})"
        if MODO == "lab" and nodo.local and aislado(nodo):
            fila["replicacion"] = "AISLADO de la WAN"
        filas.append(fila)
    return filas
