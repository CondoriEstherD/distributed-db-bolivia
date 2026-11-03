"""Operación de los nodos: despliegue, configuración entre nodos, estado y simulación de fallas.

Compartido por gestion.py (consola), el panel Streamlit y las pruebas.
"""
import re
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
        if "is not running" in r.stderr:
            raise RuntimeError(f"{nodo} está apagado: el servidor no atiende ni siquiera localmente")
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


def _exigir_local(nodo):
    if not nodo.local:
        raise RuntimeError(f"{nodo} no está en este equipo: ejecute el comando en el equipo que lo aloja")


def apagado(nodo) -> bool:
    r = docker("inspect", "-f", "{{.State.Running}}", nodo.contenedor, check=False)
    return r.returncode == 0 and r.stdout.strip() == "false"


def apagar(nodo):
    """Caída total: detiene el servidor del nodo (deja de operar incluso localmente)."""
    _exigir_local(nodo)
    docker("stop", nodo.contenedor)


def encender(nodo, informar=print):
    """Reinicia el servidor; la réplica del catálogo se pone al día sola al volver."""
    _exigir_local(nodo)
    docker("start", nodo.contenedor)
    esperar_sanos([nodo], informar)


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


def latencia(nodo, ms):
    """Retardo del enlace del nodo con tc/netem: `ms` ± ms/5 y 1 % de pérdida; 0 lo quita.

    Requiere `cap_add: [NET_ADMIN]` en el servicio (solo Beni lo tiene). Al aislar y reconectar
    el nodo, Docker crea una interfaz nueva y la latencia desaparece.
    """
    _exigir_local(nodo)
    c = nodo.contenedor
    if "NET_ADMIN" not in docker("inspect", "-f", "{{.HostConfig.CapAdd}}", c).stdout:
        raise RuntimeError(f"{nodo} no tiene cap_add: [NET_ADMIN] en docker-compose.yml (solo Beni)")
    if docker("exec", c, "sh", "-c", "command -v tc", check=False).returncode != 0:
        docker("exec", "-u", "root", c, "sh", "-c",
               "apt-get update -qq && apt-get install -y -qq iproute2 >/dev/null")
    if ms > 0:
        docker("exec", "-u", "root", c, "tc", "qdisc", "replace", "dev", "eth0", "root", "netem",
               "delay", f"{ms}ms", f"{ms // 5}ms", "loss", "1%")
    else:  # sin latencia previa, `tc qdisc del` falla: se ignora
        docker("exec", "-u", "root", c, "tc", "qdisc", "del", "dev", "eth0", "root", check=False)


def latencia_actual(nodo) -> int:
    """Retardo configurado en ms (0 si no hay o no se puede leer)."""
    r = docker("exec", nodo.contenedor, "sh", "-c", "tc qdisc show dev eth0", check=False)
    m = re.search(r"delay (\d+)ms", r.stdout)
    return int(m.group(1)) if m else 0


# ------------------------------------------------------------------ despliegue
def levantar(admin=False, informar=print):
    if not locales():
        # Sin servicios, `docker compose up` levantaría los 6 nodos en este equipo.
        raise RuntimeError("Este equipo no aloja nodos (NODOS_LOCALES vacío): es la consola de "
                           "operación. Use `python gestion.py estado` o el panel.")
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
    if not locales():
        informar("  Este equipo no aloja nodos (NODOS_LOCALES vacío): no hay nada que configurar.")
    for nodo in locales():
        if nodo is lp:
            continue
        ejecutar_archivo(nodo, "replicas/post/10_suscripcion.sql", nodo_cod=nodo.cod,
                         lp_host=lp.host_interno, lp_port=lp.port_interno,
                         pass_replicador=ENV["PASS_REPLICADOR"])
        informar(f"  ✔ {nodo}: suscrito al catálogo de La Paz")
    if lp.local:
        direcciones = {}
        for n in NODOS.values():
            if n is not lp:
                direcciones[f"h_{n.cod}"] = n.host_interno
                direcciones[f"p_{n.cod}"] = n.port_interno
        ejecutar_archivo(lp, "nodo1_lp/post/10_transparencia_fdw.sql",
                         pass_fdw_lector=ENV["PASS_FDW_LECTOR"], **direcciones)
        ejecutar_archivo(lp, "nodo1_lp/post/20_vistas_globales.sql")
        informar(f"  ✔ {lp}: servidores remotos y esquema global «nacional» creados")
        try:
            ejecutar_archivo(lp, "nodo1_lp/post/30_datos_financieros.sql")
            informar(f"  ✔ {lp}: fichas financieras (FC2) cargadas")
        except RuntimeError as e:
            informar(f"  ⚠ FC2 no cargado (¿todos los nodos en línea?): {e}. Repita `configurar` luego.")


def respaldar(nodo):
    """Copia lógica completa de la base del nodo en respaldos/<cod>_<AAAAMMDD-HHMM>.dump."""
    _exigir_local(nodo)
    carpeta = RAIZ / "respaldos"
    carpeta.mkdir(exist_ok=True)
    destino = carpeta / f"{nodo.cod}_{time.strftime('%Y%m%d-%H%M')}.dump"
    docker("exec", nodo.contenedor, "pg_dump", "-U", "postgres", "-Fc", "-f", "/tmp/r.dump", nodo.bd)
    docker("cp", f"{nodo.contenedor}:/tmp/r.dump", str(destino))
    return destino


def restaurar(nodo, archivo):
    """Devuelve la base del nodo al estado del respaldo, en UNA transacción (todo o nada).

    No se tocan la replicación ni el catálogo: la suscripción sigue sin perder su posición, y
    recrear la publicación rompería a los suscriptores en PostgreSQL 16 («publication does not
    exist»). El catálogo conserva su estado actual; en La Paz se corrige con UPDATE, que se replica.
    """
    _exigir_local(nodo)
    docker("cp", str(archivo), f"{nodo.contenedor}:/tmp/r.dump")
    excluir = ("SUBSCRIPTION", "PUBLICATION", " productos_catalogo ")
    lista = docker("exec", nodo.contenedor, "pg_restore", "-l", "/tmp/r.dump").stdout
    lista = "\n".join(l for l in lista.splitlines() if not any(x in l for x in excluir)) + "\n"
    subprocess.run(["docker", "exec", "-i", nodo.contenedor, "sh", "-c", "cat > /tmp/r.lista"],
                   input=lista, text=True, encoding="utf-8", check=True)
    docker("exec", nodo.contenedor, "pg_restore", "-U", "postgres", "--clean", "--if-exists",
           "--single-transaction", "-L", "/tmp/r.lista", "-d", nodo.bd, "/tmp/r.dump")


def reiniciar():
    """Elimina contenedores y volúmenes: se pierden TODOS los datos."""
    docker("compose", "--profile", "admin", "down", "-v", "--remove-orphans")


# ------------------------------------------------------------------ estado
def estado_nodos():
    filas = []
    for nodo in NODOS.values():
        fila = {"cod": nodo.cod, "nodo": str(nodo), "contenedor": nodo.contenedor, "estado": "SIN CONEXIÓN", "direccion": f"{nodo.host}:{nodo.port}",
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
            fila.update(en_linea=True, estado="EN LÍNEA", ventas=ventas, **{"2pc_pendientes": pendientes}, replicacion=replicacion)
        except psycopg.Error as e:
            fila["replicacion"] = f"sin conexión ({e.__class__.__name__})"
        if nodo.local and apagado(nodo):
            fila.update(estado="APAGADO", replicacion="servidor detenido")
        elif MODO == "lab" and nodo.local and aislado(nodo):
            fila.update(estado="AISLADO", replicacion="AISLADO de la WAN")
        filas.append(fila)
    return filas
