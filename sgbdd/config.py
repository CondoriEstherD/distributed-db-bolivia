"""Topología de los 6 nodos y conexión a ellos, leídas de .env (única fuente de configuración)."""
from dataclasses import dataclass
from pathlib import Path

import psycopg

RAIZ = Path(__file__).resolve().parent.parent


def _leer_env(ruta: Path) -> dict:
    if not ruta.exists():
        raise SystemExit(f"No existe {ruta.name}. Ejecute primero: python gestion.py levantar")
    datos = {}
    for linea in ruta.read_text(encoding="utf-8").splitlines():
        linea = linea.strip()
        if linea and not linea.startswith("#") and "=" in linea:
            clave, valor = linea.split("=", 1)
            datos[clave.strip()] = valor.strip()
    return datos


ENV = _leer_env(RAIZ / ".env")
MODO = ENV.get("MODO", "lab")  # lab | red
LOCALES = {c.strip() for c in ENV.get("NODOS_LOCALES", "").split(",") if c.strip()}

# Contraseña de cada rol con el que se conectan los programas Python.
_VARIABLE_DEL_ROL = {"rol_cajero": "PASS_CAJERO", "fdw_lector": "PASS_FDW_LECTOR",
                     "coordinador_2pc": "PASS_COORDINADOR", "rol_analista": "PASS_ANALISTA",
                     "rol_auditor": "PASS_AUDITOR", "rol_admin_catalogo": "PASS_ADMIN_CATALOGO",
                     "replicador": "PASS_REPLICADOR"}
_faltan = [v for v in _VARIABLE_DEL_ROL.values() if v not in ENV]
if _faltan:
    raise SystemExit(f"Faltan en .env: {', '.join(_faltan)} (cópielas de .env.example)")
CONTRASENAS = {rol: ENV[variable] for rol, variable in _VARIABLE_DEL_ROL.items()}


@dataclass(frozen=True)
class Nodo:
    num: int
    cod: str
    nombre: str
    deptos: tuple

    @property
    def contenedor(self) -> str:
        return f"nodo{self.num}_{self.cod}"

    @property
    def bd(self) -> str:
        return f"bd_{self.cod}"

    @property
    def host(self) -> str:
        """Dirección vista desde los programas Python y desde otros equipos."""
        return ENV[f"HOST_{self.cod.upper()}"]

    @property
    def port(self) -> int:
        return int(ENV[f"PORT_{self.cod.upper()}"])

    @property
    def host_interno(self) -> str:
        """Dirección vista desde OTRO contenedor (postgres_fdw y replicación)."""
        return self.contenedor if MODO == "lab" else self.host

    @property
    def port_interno(self) -> int:
        return 5432 if MODO == "lab" else self.port

    @property
    def local(self) -> bool:
        return self.cod in LOCALES

    def __str__(self) -> str:
        return f"Nodo {self.num} · {self.nombre}"


NODOS = {n.cod: n for n in (
    Nodo(1, "lp", "La Paz", ("LP",)),
    Nodo(2, "sc", "Santa Cruz", ("SC",)),
    Nodo(3, "cb", "Cochabamba", ("CB",)),
    Nodo(4, "tj", "Tarija", ("TJ", "CH")),
    Nodo(5, "or", "Oruro", ("OR", "PO")),
    Nodo(6, "be", "Beni", ("BE", "PA")),
)}


def nodo_de_almacen(id_almacen: int) -> Nodo:
    """El id del almacén codifica su nodo (601 → Nodo 6), ver ck_almacenes_nodo."""
    for nodo in NODOS.values():
        if nodo.num == id_almacen // 100:
            return nodo
    raise ValueError(f"El almacén {id_almacen} no pertenece a ningún nodo")


def conectar(nodo: Nodo, usuario: str, autocommit: bool = False) -> psycopg.Connection:
    """Conexión con detección rápida de fallas de red (≤ 3 s al conectar, ≤ 5 s en curso)."""
    return psycopg.connect(
        host=nodo.host, port=nodo.port, dbname=nodo.bd,
        user=usuario, password=CONTRASENAS[usuario],
        connect_timeout=3, tcp_user_timeout=5000,
        keepalives=1, keepalives_idle=2, keepalives_interval=1, keepalives_count=2,
        options="-c statement_timeout=8000 -c lock_timeout=3000",
        application_name="sgbdd", autocommit=autocommit,
    )
