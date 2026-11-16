"""API del SGBDD BoliviaDistribución: expone por HTTP las operaciones del paquete `sgbdd`
(estado de nodos, ventas locales, consultas distribuidas, traspasos 2PC, catálogo, fallas y
recuperación) y sirve el frontend compilado (web/dist).

    uvicorn api.main:app --port 8000          # desde la raíz del proyecto → http://localhost:8000

Regla: toda respuesta que lee o escribe datos incluye el SQL enviado al nodo, para mostrarlo.
Se ejecuta en el equipo de consola; no se publica en internet salvo con PANEL_CLAVE.
"""
import hashlib
import hmac
import json
import queue
import re
import subprocess
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor

import psycopg
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from psycopg.rows import dict_row
from pydantic import BaseModel

from sgbdd import operacion as op
from sgbdd.config import ENV, MODO, NODOS, RAIZ, conectar, nodo_de_almacen
from sgbdd.coordinador_2pc import ACREDITAR, DESCONTAR, TraspasoError, traspasar
from sgbdd.recuperacion_2pc import recuperar

app = FastAPI(title="SGBDD BoliviaDistribución", docs_url="/api/docs", openapi_url="/api/openapi.json")

# ------------------------------------------------------------------ acceso
CLAVE = ENV.get("PANEL_CLAVE", "")
TOKEN = hmac.new(CLAVE.encode(), b"sgbdd-panel", hashlib.sha256).hexdigest()
LIBRES = {"/api/sesion", "/api/login"}


@app.middleware("http")
async def acceso(request: Request, call_next):
    ruta = request.url.path
    if CLAVE and ruta.startswith("/api/") and ruta not in LIBRES:
        if not hmac.compare_digest(request.cookies.get("sgbdd", ""), TOKEN):
            return JSONResponse({"detail": "Se requiere la contraseña del panel"}, status_code=401)
    return await call_next(request)


class Login(BaseModel):
    clave: str


@app.get("/api/sesion")
def sesion(request: Request):
    return {"requiere_clave": bool(CLAVE), "modo": MODO,
            "autorizado": not CLAVE or hmac.compare_digest(request.cookies.get("sgbdd", ""), TOKEN)}


@app.post("/api/login")
def login(datos: Login):
    if not CLAVE or not hmac.compare_digest(datos.clave.encode(), CLAVE.encode()):
        raise HTTPException(401, "Contraseña incorrecta")
    r = JSONResponse({"ok": True})
    r.set_cookie("sgbdd", TOKEN, httponly=True, samesite="strict", max_age=12 * 3600)
    return r


# ------------------------------------------------------------------ utilidades
def error(e):
    return str(e).strip().splitlines()[0] if str(e).strip() else e.__class__.__name__


# Una conexión abierta por (nodo, rol, tiempo límite), reutilizada: abrir una conexión a la WAN
# (TCP + SCRAM + parámetros de sesión) cuesta varios viajes de ida y vuelta a Chile o EE. UU.
# ponytail: una conexión por clave serializada con un candado; psycopg_pool si hubiera mucha concurrencia.
_conexiones = {}
_conexiones_lock = threading.Lock()


def filas(nodo, sql, params=None, usuario="fdw_lector", timeout_ms=8000):
    with _conexiones_lock:
        par = _conexiones.setdefault((nodo.cod, usuario, timeout_ms), [None, threading.Lock()])
    with par[1]:
        reutilizada = par[0] is not None and not par[0].closed
        for _ in range(2):
            try:
                if par[0] is None or par[0].closed:
                    par[0] = conectar(nodo, usuario, autocommit=True, statement_timeout_ms=timeout_ms)
                cur = par[0].cursor(row_factory=dict_row)
                cur.execute(sql, params)
                return cur.fetchall() if cur.description else []
            except psycopg.errors.QueryCanceled as e:  # tiempo límite: la conexión sigue sana, no reintentar
                raise HTTPException(503, f"{nodo}: {error(e)}") from e
            except psycopg.OperationalError as e:
                if par[0] is not None:
                    par[0].close()
                    par[0] = None
                if not reutilizada:  # conexión nueva que falla: el nodo no responde
                    raise HTTPException(503, f"{nodo}: {error(e)}") from e
                reutilizada = False  # la conexión guardada estaba rota: un reintento con una nueva
            except psycopg.Error as e:
                raise HTTPException(503, f"{nodo}: {error(e)}") from e


def nodo(cod):
    if cod not in NODOS:
        raise HTTPException(404, f"Nodo desconocido: {cod}")
    return NODOS[cod]


_estado = {"t": 0.0, "v": []}
_estado_lock = threading.Lock()


def estado(forzar=False):
    """Estado de los 6 nodos, reutilizado 4 s (cada lectura consulta los 6 servidores)."""
    with _estado_lock:
        if forzar or time.time() - _estado["t"] > 4:
            _estado.update(t=time.time(), v=op.estado_nodos())
        return _estado["v"]


def en_linea(cod):
    return any(f["cod"] == cod and f["estado"] == "EN LÍNEA" for f in estado())


def depto_de_almacen(a):
    """Dos almacenes por departamento, numerados en orden alfabético (04_datos_prueba.sql)."""
    return sorted(nodo_de_almacen(a).deptos)[(a % 100 - 1) // 2]


# ------------------------------------------------------------------ topología y estado
@app.get("/api/estado")
def api_estado(forzar: bool = False):
    resultado = []
    for f in estado(forzar):
        n = NODOS[f["cod"]]
        resultado.append({**f, "num": n.num, "nombre": n.nombre, "deptos": list(n.deptos), "bd": n.bd,
                          "servidor": f"vm-{n.cod}" if MODO == "red" else "este equipo", "local": n.local})
    return {"modo": MODO, "nodos": resultado}


@app.get("/api/almacenes")
def api_almacenes():
    return [{"id": a, "nodo": nodo_de_almacen(a).cod, "nodo_nombre": nodo_de_almacen(a).nombre,
             "num": nodo_de_almacen(a).num, "depto": depto_de_almacen(a),
             "nombre": f"Almacén {depto_de_almacen(a)}-{(a % 100 - 1) % 2 + 1}"}
            for n in NODOS.values() for a in range(n.num * 100 + 1, n.num * 100 + 2 * len(n.deptos) + 1)]


_productos = {"t": 0.0, "v": []}


@app.get("/api/productos")
def api_productos():
    """Catálogo (réplica total): se lee del primer nodo que responda."""
    if time.time() - _productos["t"] < 60 and _productos["v"]:
        return _productos["v"]
    for n in NODOS.values():
        if not en_linea(n.cod):
            continue
        try:
            v = filas(n, "SELECT id_producto AS id, nombre, categoria, codigo_barras, precio_unitario AS precio "
                         "FROM productos_catalogo ORDER BY id_producto")
            _productos.update(t=time.time(), v=v)
            return v
        except HTTPException:
            continue
    raise HTTPException(503, "Ningún nodo responde")


# ------------------------------------------------------------------ sucursal (lee SOLO su base)
SQL_RESUMEN = """SELECT departamento_id AS departamento, count(*) AS ventas, sum(total_bs) AS total_bs
FROM ventas GROUP BY 1 ORDER BY 1"""
SQL_INV_RESUMEN = """SELECT sum(stock_actual) AS unidades,
       count(*) FILTER (WHERE stock_actual < stock_minimo) AS bajo_minimo
FROM inventario"""
SQL_VENTAS = """SELECT v.id_venta, v.fecha_hora, v.departamento_id AS departamento,
       c.razon_social AS cliente, c.nit_ci, v.total_bs,
       (SELECT count(*) FROM detalle_venta d WHERE d.id_venta = v.id_venta) AS productos
FROM ventas v JOIN clientes_datos_generales c USING (id_cliente)
ORDER BY v.id_venta DESC LIMIT %s"""
SQL_DETALLE = """SELECT d.id_producto, p.nombre, d.cantidad, d.precio_aplicado, d.subtotal
FROM detalle_venta d JOIN productos_catalogo p USING (id_producto)
WHERE d.id_venta = %s ORDER BY d.id_detalle"""
SQL_INVENTARIO = """SELECT a.id_almacen, a.nombre_almacen AS almacen, a.departamento_id AS departamento,
       i.id_producto, p.nombre AS producto, p.categoria, i.stock_actual, i.stock_minimo
FROM inventario i
JOIN almacenes a USING (id_almacen)
JOIN productos_catalogo p USING (id_producto)
ORDER BY a.id_almacen, i.id_producto"""
SQL_CATALOGO = """SELECT id_producto, codigo_barras, nombre, categoria, precio_unitario
FROM productos_catalogo ORDER BY id_producto"""
SQL_CLIENTES = """SELECT id_cliente, razon_social, nit_ci FROM clientes_datos_generales
WHERE departamento_id = %s ORDER BY id_cliente"""
SQL_STOCK_DEPTO = """SELECT i.id_producto, sum(i.stock_actual) AS stock
FROM inventario i JOIN almacenes a USING (id_almacen)
WHERE a.departamento_id = %s GROUP BY 1"""


@app.get("/api/nodos/{cod}/resumen")
def api_resumen(cod: str):
    n = nodo(cod)
    inv = filas(n, SQL_INV_RESUMEN)[0]
    return {"sql": f"{SQL_RESUMEN};\n\n{SQL_INV_RESUMEN};", "por_departamento": filas(n, SQL_RESUMEN),
            "unidades": inv["unidades"], "bajo_minimo": inv["bajo_minimo"]}


@app.get("/api/nodos/{cod}/ventas")
def api_ventas(cod: str, limite: int = 50):
    return {"sql": SQL_VENTAS % limite, "filas": filas(nodo(cod), SQL_VENTAS, (min(limite, 500),))}


@app.get("/api/nodos/{cod}/ventas/{id_venta}")
def api_detalle(cod: str, id_venta: int):
    return {"sql": SQL_DETALLE % id_venta, "filas": filas(nodo(cod), SQL_DETALLE, (id_venta,))}


@app.get("/api/nodos/{cod}/inventario")
def api_inventario(cod: str):
    return {"sql": SQL_INVENTARIO, "filas": filas(nodo(cod), SQL_INVENTARIO)}


@app.get("/api/nodos/{cod}/catalogo")
def api_catalogo_nodo(cod: str):
    return {"sql": SQL_CATALOGO, "filas": filas(nodo(cod), SQL_CATALOGO)}


@app.get("/api/nodos/{cod}/clientes")
def api_clientes(cod: str, departamento: str):
    n = nodo(cod)
    return {"clientes": filas(n, SQL_CLIENTES, (departamento,)),
            "stock": {r["id_producto"]: r["stock"] for r in filas(n, SQL_STOCK_DEPTO, (departamento,))}}


class Item(BaseModel):
    id_producto: int
    cantidad: int


class Venta(BaseModel):
    departamento: str
    id_cliente: int
    items: list[Item]


@app.post("/api/nodos/{cod}/ventas")
def api_vender(cod: str, venta: Venta):
    """Transacción 100 % local en la sucursal (rol_cajero): registrar_venta() valida y descuenta."""
    n = nodo(cod)
    if venta.departamento not in n.deptos:
        raise HTTPException(400, f"{venta.departamento} no pertenece a {n}")
    items = json.dumps([i.model_dump() for i in venta.items])
    empleado = n.num * 100 + 1
    sql = (f"SELECT registrar_venta('{venta.departamento}', {venta.id_cliente}, {empleado},\n"
           f"       '{items}'::jsonb);")
    try:
        r = filas(n, "SELECT registrar_venta(%s, %s, %s, %s::jsonb) AS id_venta",
                  (venta.departamento, venta.id_cliente, empleado, items), "rol_cajero")
        id_venta = r[0]["id_venta"]
    except HTTPException:
        if not n.local:
            raise
        try:  # modo lab con el nodo aislado: la consola local del servidor no usa la red
            id_venta = int(op.consola(n, sql.rstrip(";"), usuario="rol_cajero")[0][0])
        except RuntimeError as e:
            raise HTTPException(503, error(e)) from e
    total = filas(n, "SELECT total_bs FROM ventas WHERE id_venta = %s", (id_venta,))[0]["total_bs"]
    _estado["t"] = 0
    return {"sql": sql, "id_venta": id_venta, "total_bs": total}


# ------------------------------------------------------------------ consultas distribuidas
FRAGMENTO = re.compile(r"\b(?:nacional|public)\.(f[a-z]+\d?_[a-z]{2}|ventas|detalle_venta|inventario|almacenes|"
                       r"clientes_datos_generales|clientes_financiero|productos_catalogo|traspasos_log)\b")


def consultas_predefinidas():
    texto = (RAIZ / "sql/consultas/consultas_distribuidas.sql").read_text(encoding="utf-8")
    b = re.split(r"^-- \[(C\d+)\] (.+?) \| (\w+)\s*$", texto, flags=re.M)
    return {b[i]: {"id": b[i], "titulo": b[i + 1], "rol": b[i + 2], "sql": b[i + 3].strip()}
            for i in range(1, len(b), 4)}


@app.get("/api/consultas")
def api_consultas():
    return list(consultas_predefinidas().values())


class Ejecucion(BaseModel):
    plan: bool = False


@app.post("/api/consultas/{cid}")
def api_ejecutar(cid: str, e: Ejecucion):
    c = consultas_predefinidas().get(cid)
    if not c:
        raise HTTPException(404, "Consulta desconocida")
    lp = NODOS["lp"]
    inicio = time.perf_counter()
    resultado = filas(lp, c["sql"], usuario=c["rol"], timeout_ms=30000 if cid == "C7" else 8000)
    respuesta = {"filas": resultado, "ms": round((time.perf_counter() - inicio) * 1000)}
    if e.plan:
        texto = "\n".join(r["QUERY PLAN"] for r in filas(lp, "EXPLAIN (VERBOSE, COSTS OFF) " + c["sql"].rstrip(";"),
                                                         usuario=c["rol"]))
        sin_remoto = "\n".join(linea for linea in texto.splitlines() if "Remote SQL" not in linea)
        respuesta.update(plan=texto, fragmentos=sorted(set(FRAGMENTO.findall(sin_remoto))))
    return respuesta


# ------------------------------------------------------------------ traspasos 2PC
SQL_STOCK = "SELECT id_producto, stock_actual FROM inventario WHERE id_almacen = %s AND id_producto = ANY(%s)"
# Stock nacional = suma de los 6 fragmentos de inventario, leídos en paralelo (la vista
# nacional.inventario_nacional da lo mismo, pero sus JOIN remotos tardan ~5 s en la WAN).
SQL_STOCK_NODO = "SELECT id_producto, sum(stock_actual) AS stock FROM inventario WHERE id_producto = ANY(%s) GROUP BY 1"


def stock_almacen(alm, prods):
    if not en_linea(nodo_de_almacen(alm).cod):
        return None
    try:
        return {r["id_producto"]: r["stock_actual"] for r in filas(nodo_de_almacen(alm), SQL_STOCK, (alm, prods))}
    except HTTPException:
        return None


@app.get("/api/traspasos/stock")
def api_stock(origen: int, destino: int, productos: str):
    prods = [int(p) for p in productos.split(",") if p.strip()]
    nacional = None
    if prods and all(f["en_linea"] for f in estado()):  # el total necesita los 6 fragmentos
        try:
            nacional = {}
            for grupo in en_paralelo(lambda n: filas(n, SQL_STOCK_NODO, (prods,))):
                for r in grupo:
                    nacional[r["id_producto"]] = nacional.get(r["id_producto"], 0) + r["stock"]
        except HTTPException:
            nacional = None
    o, d = stock_almacen(origen, prods), stock_almacen(destino, prods)
    return [{"id_producto": p, "origen": None if o is None else o.get(p),
             "destino": None if d is None else d.get(p),
             "nacional": None if nacional is None else nacional.get(p)} for p in prods]


@app.get("/api/traspasos/sql")
def api_traspaso_sql():
    return {"descontar": DESCONTAR.strip(), "acreditar": ACREDITAR.strip()}


class Traspaso(BaseModel):
    origen: int
    destino: int
    items: dict[int, int]
    pausa: float = 0


@app.post("/api/traspasos")
def api_traspasar(t: Traspaso):
    """Ejecuta el 2PC y transmite cada paso del protocolo (NDJSON) mientras ocurre."""
    o, d = nodo_de_almacen(t.origen), nodo_de_almacen(t.destino)
    caidos = [str(n) for n in (o, d) if not en_linea(n.cod)]
    if caidos:
        raise HTTPException(409, f"{' y '.join(caidos)} sin conexión: el 2PC necesita el voto de ambas "
                                 "sucursales. Sus ventas locales siguen permitidas.")
    cola = queue.Queue()

    def trabajar():
        try:
            tid = traspasar(t.origen, t.destino, t.items, min(t.pausa, 30),
                            informar=lambda m: cola.put({"tipo": "paso", "texto": m}))
            cola.put({"tipo": "fin", "ok": True, "gid": tid})
        except (TraspasoError, ValueError) as e:
            cola.put({"tipo": "fin", "ok": False, "error": error(e)})
        finally:
            _estado["t"] = 0

    threading.Thread(target=trabajar, daemon=True).start()

    def flujo():
        while True:
            m = cola.get()
            yield json.dumps(m, ensure_ascii=False) + "\n"
            if m["tipo"] == "fin":
                return

    return StreamingResponse(flujo(), media_type="application/x-ndjson")


@app.get("/api/traspasos/log")
def api_log():
    sql = """SELECT gid, origen, destino, id_almacen_origen, id_almacen_destino,
       COALESCE(items, jsonb_build_object(id_producto::text, cantidad)) AS items,
       estado, detalle, creado_en
FROM traspasos_log ORDER BY creado_en DESC LIMIT 15"""
    return {"sql": sql, "filas": filas(NODOS["cb"], sql)}


# ------------------------------------------------------------------ catálogo replicado
SQL_PRECIO = "SELECT precio_unitario FROM productos_catalogo WHERE id_producto = %s"


def en_paralelo(funcion):
    """Aplica `funcion` a los 6 nodos a la vez (en la WAN, uno por uno sumaría varios segundos)."""
    with ThreadPoolExecutor(max_workers=len(NODOS)) as ex:
        return list(ex.map(funcion, NODOS.values()))


@app.get("/api/catalogo/{id_producto}/replicas")
def api_replicas(id_producto: int):
    def precio_en(n):
        precio = None
        if en_linea(n.cod):
            try:
                r = filas(n, SQL_PRECIO, (id_producto,), timeout_ms=4000)
                precio = r[0]["precio_unitario"] if r else None
            except HTTPException:
                pass
        return {"cod": n.cod, "nodo": str(n), "precio": precio}

    resultado = en_paralelo(precio_en)
    maestro = resultado[0]["precio"]
    for r in resultado:
        r["replica"] = ("maestro" if r["cod"] == "lp" else "sin conexión" if r["precio"] is None else
                        "sincronizada" if maestro is not None and r["precio"] == maestro else "pendiente")
    return {"sql": SQL_PRECIO % id_producto, "replicas": resultado}


class Precio(BaseModel):
    precio: float


@app.post("/api/catalogo/{id_producto}/precio")
def api_precio(id_producto: int, p: Precio):
    if p.precio <= 0:
        raise HTTPException(400, "El precio debe ser positivo")
    sql = "UPDATE productos_catalogo SET precio_unitario = %s WHERE id_producto = %s"
    filas(NODOS["lp"], sql, (p.precio, id_producto), "rol_admin_catalogo")
    _productos["t"] = 0
    return {"sql": f"UPDATE productos_catalogo SET precio_unitario = {p.precio:.2f}\nWHERE id_producto = "
                   f"{id_producto};  -- como rol_admin_catalogo en La Paz"}


# ------------------------------------------------------------------ fallas
@app.post("/api/fallas/{cod}/{accion}")
def api_falla(cod: str, accion: str):
    """Solo para nodos de este equipo (modo lab). En red la falla se provoca en el servidor del nodo."""
    n = nodo(cod)
    acciones = {"aislar": op.aislar, "reconectar": op.reconectar, "apagar": op.apagar,
                "encender": lambda x: op.encender(x, informar=lambda *_: None)}
    if accion not in acciones:
        raise HTTPException(404, "Acción desconocida")
    try:
        acciones[accion](n)
    except RuntimeError as e:
        raise HTTPException(409, error(e)) from e
    estado(forzar=True)
    return {"ok": True}


@app.post("/api/verificar/{caso}")
def api_verificar(caso: str, cod: str = "be"):
    """Pruebas rápidas para mostrar qué sigue funcionando con un nodo caído."""
    afectado = nodo(cod)
    otro = NODOS["sc"] if cod != "sc" else NODOS["cb"]
    inicio = time.perf_counter()
    tabla = None
    try:
        if caso == "nacional":
            sql = "SELECT count(*) AS ventas FROM ventas_nacionales"
            texto = f"{filas(NODOS['lp'], sql, usuario='rol_analista')[0]['ventas']:,} ventas en todo el país"
        elif caso == "otro":
            sql = f"SELECT count(*) AS ventas FROM ventas_nacionales WHERE departamento_id = '{otro.deptos[0]}'"
            n = filas(NODOS["lp"], sql, usuario="rol_analista")[0]["ventas"]
            texto = f"{n:,} ventas de {otro.deptos[0]}: solo se consultó el fragmento de {otro.nombre}"
        elif caso == "tolerante":
            sql = "SELECT fragmento, departamento_id, ventas, estado FROM resumen_nacional_disponible()"
            tabla = filas(NODOS["lp"], sql, usuario="rol_analista", timeout_ms=30000)
            caidos = sorted({r["fragmento"] for r in tabla if r["estado"].startswith("FUERA")})
            texto = f"Fragmentos fuera de línea: {', '.join(caidos)}" if caidos else "Los 6 fragmentos responden"
        elif caso in ("venta_afectado", "venta_otro"):
            n = afectado if caso == "venta_afectado" else otro
            sql = f"SELECT * FROM venta_demo('{n.deptos[0]}');  -- como rol_cajero en {n.bd}"
            if not n.local and not en_linea(n.cod):
                raise HTTPException(503, f"La consola no alcanza a {n.nombre}: su venta local se hace en su "
                                         "propio servidor (ver la página de la sucursal).")
            v = (op.vender_local(n) if n.local else
                 filas(n, "SELECT * FROM venta_demo(%s)", (n.deptos[0],), "rol_cajero")[0])
            texto = f"{n.nombre} registró la venta #{v['id_venta']} (Bs {float(v['total_bs']):,.2f})"
        else:
            raise HTTPException(404, "Caso desconocido")
        ok = True
    except HTTPException as e:
        ok, texto, sql = False, e.detail, locals().get("sql", "")
    except RuntimeError as e:
        ok, texto, sql = False, error(e), locals().get("sql", "")
    return {"ok": ok, "texto": texto, "sql": sql, "tabla": tabla,
            "segundos": round(time.perf_counter() - inicio, 1)}


# ------------------------------------------------------------------ recuperación 2PC
@app.get("/api/recuperacion/en-duda")
def api_en_duda():
    def preparadas(n):
        if en_linea(n.cod):
            try:
                return [{"nodo": str(n), "gid": r["gid"], "preparada": r["prepared"], "sin_conexion": False}
                        for r in filas(n, "SELECT gid, prepared FROM pg_prepared_xacts "
                                          "WHERE database = current_database()")]
            except HTTPException:
                pass
        return [{"nodo": str(n), "gid": None, "preparada": None, "sin_conexion": True}]

    return [fila for grupo in en_paralelo(preparadas) for fila in grupo]


class Caida(BaseModel):
    momento: str


@app.post("/api/recuperacion/simular")
def api_simular(c: Caida):
    if c.momento not in ("preparado", "decision"):
        raise HTTPException(400, "Momento inválido")
    r = subprocess.run([sys.executable, "-m", "sgbdd.coordinador_2pc", "--origen", "201", "--destino", "601",
                        "--producto", "11", "--cantidad", "7", "--caer-en", c.momento],
                       cwd=RAIZ, capture_output=True, text=True, encoding="utf-8")
    return {"salida": (r.stdout.strip() or r.stderr.strip()), "cayo": r.returncode in (3, 4)}


class Recuperar(BaseModel):
    edad_minima: float = 0


@app.post("/api/recuperacion/recuperar")
def api_recuperar(r: Recuperar):
    mensajes = []
    try:
        recuperar(r.edad_minima, informar=mensajes.append)
    except psycopg.Error as e:
        raise HTTPException(503, f"Nodo 3 sin conexión: no se puede leer la decisión ({error(e)})") from e
    _estado["t"] = 0
    return {"mensajes": mensajes}


# ------------------------------------------------------------------ frontend compilado
DIST = (RAIZ / "web" / "dist").resolve()


@app.get("/{ruta:path}", include_in_schema=False)
def frontend(ruta: str):
    if ruta.startswith("api/"):
        raise HTTPException(404)
    archivo = (DIST / ruta).resolve()
    if ruta and archivo.is_file() and DIST in archivo.parents:
        return FileResponse(archivo)
    if (DIST / "index.html").is_file():
        return FileResponse(DIST / "index.html")
    return JSONResponse({"detail": "Frontend sin compilar: cd web && npm run build"}, status_code=404)
