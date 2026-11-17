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
from psycopg import sql as psql
from psycopg.rows import dict_row
from pydantic import BaseModel

from sgbdd import operacion as op
from sgbdd.config import ENV, MODO, NODOS, RAIZ, conectar, nodo_de_almacen
from sgbdd.coordinador_2pc import ACREDITAR, DESCONTAR, TraspasoError, traspasar
from sgbdd.recuperacion_2pc import recuperar

app = FastAPI(title="SGBDD BoliviaDistribución", docs_url="/api/docs", openapi_url="/api/openapi.json")

# ------------------------------------------------------------------ acceso por sucursal
# Cada sucursal entra con su propia contraseña (CLAVE_LP … CLAVE_BE en .env) y solo ve y opera
# sus propios datos. La Paz es además la administración central (vista nacional, crédito FC2,
# precios, consultas, auditoría 2PC y fallas). Sin CLAVE_xx se usa PANEL_CLAVE; sin ninguna, no
# se pide contraseña (uso local de laboratorio).
CLAVE = ENV.get("PANEL_CLAVE", "")
CLAVES = {cod: ENV.get(f"CLAVE_{cod.upper()}", CLAVE) for cod in NODOS}
SECRETO = (CLAVE or "sgbdd-lab").encode()
CENTRAL = "lp"
LIBRES = {"/api/sesion", "/api/login", "/api/logout", "/api/sucursales"}
SOLO_CENTRAL = ("/api/consultas", "/api/recuperacion", "/api/fallas", "/api/verificar", "/api/central")


def _firma(cod):
    return hmac.new(SECRETO, f"sucursal:{cod}".encode(), hashlib.sha256).hexdigest()


def sucursal_de(request: Request):
    """Código de la sucursal de la sesión (o None)."""
    cod, _, firma = request.cookies.get("sgbdd", "").partition(".")
    return cod if cod in NODOS and hmac.compare_digest(firma, _firma(cod)) else None


def exigir(request: Request, cod):
    """La sesión debe ser de esa sucursal, o de la administración central."""
    s = sucursal_de(request)
    if s != cod and s != CENTRAL:
        raise HTTPException(403, f"Su sesión es de {NODOS[s].nombre if s else 'ninguna sucursal'}: "
                                 f"no puede operar en {NODOS[cod].nombre}")


@app.middleware("http")
async def acceso(request: Request, call_next):
    ruta = request.url.path
    if ruta.startswith("/api/") and ruta not in LIBRES:
        s = sucursal_de(request)
        if s is None:
            return JSONResponse({"detail": "Inicie sesión con la contraseña de su sucursal"}, status_code=401)
        m = re.match(r"/api/nodos/(\w+)/", ruta)
        if m and m.group(1) != s and s != CENTRAL:
            return JSONResponse({"detail": f"Solo puede ver los datos de su sucursal ({NODOS[s].nombre})"},
                                status_code=403)
        es_cambio_precio = ruta.startswith("/api/catalogo/") and request.method == "POST"
        if (ruta.startswith(SOLO_CENTRAL) or es_cambio_precio) and s != CENTRAL:
            return JSONResponse({"detail": "Solo la administración central (La Paz)"}, status_code=403)
    return await call_next(request)


class Login(BaseModel):
    sucursal: str
    clave: str = ""


@app.get("/api/sucursales")
def api_sucursales():
    """Lista para la pantalla de ingreso (sin datos sensibles)."""
    return [{"cod": n.cod, "num": n.num, "nombre": n.nombre, "deptos": list(n.deptos),
             "requiere_clave": bool(CLAVES[n.cod]), "central": n.cod == CENTRAL} for n in NODOS.values()]


@app.get("/api/sesion")
def sesion(request: Request):
    s = sucursal_de(request)
    return {"modo": MODO, "autorizado": s is not None, "sucursal": s, "central": s == CENTRAL}


@app.post("/api/login")
def login(datos: Login):
    if datos.sucursal not in NODOS:
        raise HTTPException(404, "Sucursal desconocida")
    esperada = CLAVES[datos.sucursal]
    if esperada and not hmac.compare_digest(datos.clave.encode(), esperada.encode()):
        raise HTTPException(401, "Contraseña incorrecta")
    r = JSONResponse({"ok": True})
    r.set_cookie("sgbdd", f"{datos.sucursal}.{_firma(datos.sucursal)}", httponly=True, samesite="strict",
                 max_age=12 * 3600)
    return r


@app.post("/api/logout")
def logout():
    r = JSONResponse({"ok": True})
    r.delete_cookie("sgbdd")
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


# ------------------------------------------------------------------ terminal local de la sucursal
# Un corte de la WAN aísla la BASE de la sucursal de las demás sucursales (regla de firewall en su
# servidor), pero la sucursal sigue operando: su caja entra al servidor por la red local. La consola
# la emula entrando al servidor del nodo (SSH en red; Docker en lab) y usando psql DENTRO del
# contenedor (socket local), sin pasar por la red de bases de datos.
MARCA = "-m comment --comment sgbdd-aislado -j DROP"
REGLAS = (f"DOCKER-USER -i tailscale0 {MARCA}", f"DOCKER-USER -o tailscale0 {MARCA}")


def _ejecutar(args, entrada=None, timeout=25):
    try:
        return subprocess.run(args, input=entrada, capture_output=True, text=True, encoding="utf-8", timeout=timeout)
    except subprocess.TimeoutExpired as e:
        raise HTTPException(503, "El servidor de la sucursal no respondió. Si Tailscale pide verificación SSH, "
                                 "ponga la regla SSH de la ACL en modo «accept».") from e


def en_servidor(n, comando, entrada=None, timeout=25):
    """Comando de shell en el servidor (VM) del nodo, por SSH sobre Tailscale (solo modo red)."""
    return _ejecutar(["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=6", f"azureuser@vm-{n.cod}", comando],
                     entrada, timeout)


def psql_local(n, sql_texto, params=None, usuario="fdw_lector"):
    """SQL en la consola local del servidor del nodo (no usa la WAN). Devuelve filas como dicts."""
    if params:
        sql_texto = sql_texto % tuple(psql.Literal(p).as_string(None) for p in params)
    consulta = f"SELECT coalesce(json_agg(t), '[]') FROM ({sql_texto.strip().rstrip(';')}) t;"
    cmd = ["docker", "exec", "-i", n.contenedor, "psql", "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1",
           "-U", usuario, "-d", n.bd]
    r = en_servidor(n, " ".join(cmd), consulta) if MODO == "red" else _ejecutar(cmd, consulta)
    if r.returncode != 0:
        raise HTTPException(503, f"{n} (terminal local): {error(r.stderr or r.stdout)}")
    return json.loads(r.stdout.strip() or "[]")


def _diagnostico(f):
    """Nodo que no responde por la WAN (modo red): ¿aislado, apagado o servidor inalcanzable?"""
    n = NODOS[f["cod"]]
    cmd = (f"docker inspect -f '{{{{.State.Running}}}}' {n.contenedor}; "
           f"sudo iptables -C {REGLAS[0]} 2>/dev/null && echo AISLADO; "
           f"docker exec {n.contenedor} psql -X -At -U postgres -d {n.bd} -c 'SELECT count(*) FROM ventas' 2>/dev/null")
    try:
        r = en_servidor(n, cmd, timeout=12)
    except HTTPException:
        return f
    lineas = r.stdout.split()
    if r.returncode == 255 or not lineas:  # SSH falló: VM apagada o sin Tailscale
        return f
    if lineas[0] == "false":
        return {**f, "estado": "APAGADO", "replicacion": "servidor de base de datos detenido"}
    if "AISLADO" in lineas:
        ventas = int(lineas[-1]) if lineas[-1].isdigit() else None
        return {**f, "estado": "AISLADO", "ventas": ventas,
                "replicacion": "enlace WAN cortado: opera solo localmente"}
    return f


_estado = {"t": 0.0, "v": [], "actualizando": False}
_estado_lock = threading.Lock()


def _calcular_estado():
    filas_estado = op.estado_nodos()
    if MODO == "red":
        with ThreadPoolExecutor(max_workers=len(NODOS)) as ex:
            filas_estado = list(ex.map(lambda f: f if f["en_linea"] else _diagnostico(f), filas_estado))
    return filas_estado


def _refrescar_estado():
    try:
        v = _calcular_estado()
        with _estado_lock:
            _estado.update(t=time.time(), v=v)
    finally:
        _estado["actualizando"] = False


def estado(forzar=False):
    """Estado de los 6 nodos. Con un nodo caído calcularlo tarda varios segundos (tiempos límite),
    así que se devuelve el último valor y se actualiza en segundo plano cada 5 s."""
    if forzar or not _estado["v"]:
        with _estado_lock:
            if forzar or not _estado["v"]:
                _estado.update(t=time.time(), v=_calcular_estado())
        return _estado["v"]
    if time.time() - _estado["t"] > 5 and not _estado["actualizando"]:
        _estado["actualizando"] = True
        threading.Thread(target=_refrescar_estado, daemon=True).start()
    return _estado["v"]


def estado_de(cod):
    return next(f["estado"] for f in estado() if f["cod"] == cod)


def en_linea(cod):
    return estado_de(cod) == "EN LÍNEA"


def leer_sucursal(n, sql_texto, params=None, usuario="fdw_lector"):
    """Lectura/escritura de UNA sucursal: por la red si está en línea; si su enlace WAN está cortado,
    por su terminal local (la sucursal sigue operando: autonomía local)."""
    if estado_de(n.cod) == "AISLADO":
        return psql_local(n, sql_texto, params, usuario)
    return filas(n, sql_texto, params, usuario)


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
    inv = leer_sucursal(n, SQL_INV_RESUMEN)[0]
    return {"sql": f"{SQL_RESUMEN};\n\n{SQL_INV_RESUMEN};", "por_departamento": leer_sucursal(n, SQL_RESUMEN),
            "unidades": inv["unidades"], "bajo_minimo": inv["bajo_minimo"]}


@app.get("/api/nodos/{cod}/ventas")
def api_ventas(cod: str, limite: int = 50):
    return {"sql": SQL_VENTAS % limite, "filas": leer_sucursal(nodo(cod), SQL_VENTAS, (min(limite, 500),))}


@app.get("/api/nodos/{cod}/ventas/{id_venta}")
def api_detalle(cod: str, id_venta: int):
    return {"sql": SQL_DETALLE % id_venta, "filas": leer_sucursal(nodo(cod), SQL_DETALLE, (id_venta,))}


@app.get("/api/nodos/{cod}/inventario")
def api_inventario(cod: str):
    return {"sql": SQL_INVENTARIO, "filas": leer_sucursal(nodo(cod), SQL_INVENTARIO)}


@app.get("/api/nodos/{cod}/catalogo")
def api_catalogo_nodo(cod: str):
    return {"sql": SQL_CATALOGO, "filas": leer_sucursal(nodo(cod), SQL_CATALOGO)}


@app.get("/api/nodos/{cod}/clientes")
def api_clientes(cod: str, departamento: str):
    n = nodo(cod)
    return {"clientes": leer_sucursal(n, SQL_CLIENTES, (departamento,)),
            "stock": {r["id_producto"]: r["stock"] for r in leer_sucursal(n, SQL_STOCK_DEPTO, (departamento,))}}


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
    local = estado_de(cod) == "AISLADO"
    id_venta = leer_sucursal(n, "SELECT registrar_venta(%s, %s, %s, %s::jsonb) AS id_venta",
                             (venta.departamento, venta.id_cliente, empleado, items), "rol_cajero")[0]["id_venta"]
    total = leer_sucursal(n, "SELECT total_bs FROM ventas WHERE id_venta = %s", (id_venta,))[0]["total_bs"]
    _estado["t"] = 0
    return {"sql": sql, "id_venta": id_venta, "total_bs": total, "terminal_local": local}


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
def api_traspasar(t: Traspaso, request: Request):
    """Ejecuta el 2PC y transmite cada paso del protocolo (NDJSON) mientras ocurre.
    La sucursal envía mercadería desde SUS almacenes; antes de empezar se verifica que las dos
    sucursales estén en la red nacional."""
    o, d = nodo_de_almacen(t.origen), nodo_de_almacen(t.destino)
    exigir(request, o.cod)
    caidos = [f"{n} ({estado_de(n.cod).lower()})" for n in (o, d) if not en_linea(n.cod)]
    if caidos:
        raise HTTPException(409, f"{' y '.join(caidos)}: el 2PC necesita el voto de ambas sucursales por la "
                                 "red. Las ventas locales de una sucursal aislada siguen permitidas.")
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
def api_log(request: Request):
    """Registro del coordinador (Nodo 3). Una sucursal ve solo los envíos en los que participa."""
    s = sucursal_de(request)
    filtro = "" if s == CENTRAL else f"WHERE origen = '{s}' OR destino = '{s}'\n"
    sql = f"""SELECT gid, origen, destino, id_almacen_origen, id_almacen_destino,
       COALESCE(items, jsonb_build_object(id_producto::text, cantidad)) AS items,
       estado, detalle, creado_en
FROM traspasos_log
{filtro}ORDER BY creado_en DESC LIMIT 30"""
    return {"sql": sql, "filas": filas(NODOS["cb"], sql)}


# ------------------------------------------------------------------ clientes
SQL_CLIENTES_SUC = """SELECT c.id_cliente, c.nit_ci, c.razon_social, c.telefono, c.direccion, c.departamento_id,
       count(v.id_venta) AS compras, coalesce(sum(v.total_bs), 0) AS total_bs, max(v.fecha_hora) AS ultima_compra
FROM clientes_datos_generales c
LEFT JOIN ventas v USING (id_cliente)
GROUP BY c.id_cliente
ORDER BY compras DESC, c.id_cliente"""


@app.get("/api/nodos/{cod}/clientes-lista")
def api_clientes_sucursal(cod: str):
    """Clientes de la sucursal: SOLO el fragmento FC1 (datos generales). El crédito (FC2) no está aquí."""
    return {"sql": SQL_CLIENTES_SUC, "filas": leer_sucursal(nodo(cod), SQL_CLIENTES_SUC)}


SQL_CREDITO = """SELECT id_cliente, nit_ci, razon_social, departamento_id, limite_credito, saldo_pendiente,
       calificacion_riesgo, estado_credito
FROM nacional.clientes_completo   -- FC1 (6 nodos, vía postgres_fdw) ⋈ FC2 (solo La Paz)
WHERE estado_credito <> 'SOLO CONTADO'
ORDER BY saldo_pendiente DESC"""


@app.get("/api/central/clientes")
def api_central_clientes():
    """Ficha crediticia completa: reconstrucción de la fragmentación vertical CLIENTES = FC1 ⋈ FC2."""
    return {"sql": SQL_CREDITO, "filas": filas(NODOS["lp"], SQL_CREDITO, usuario="rol_auditor", timeout_ms=30000)}


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
# Comandos que se ejecutan EN el servidor de la sucursal (modo red). Cortar el enlace no apaga
# Tailscale: bloquea solo el tráfico de la base hacia y desde las otras sucursales (WAN), así la
# sucursal sigue atendiendo localmente.
COMANDOS_FALLA = {
    "aislar": " && ".join(f"(sudo iptables -C {r} 2>/dev/null || sudo iptables -I {r})" for r in REGLAS),
    "reconectar": "; ".join(f"while sudo iptables -D {r} 2>/dev/null; do :; done" for r in REGLAS),
    "apagar": "docker stop {contenedor}",
    "encender": "docker start {contenedor}",
}


@app.get("/api/fallas/comandos")
def api_comandos_falla():
    return COMANDOS_FALLA


@app.post("/api/fallas/{cod}/{accion}")
def api_falla(cod: str, accion: str):
    n = nodo(cod)
    if accion not in COMANDOS_FALLA:
        raise HTTPException(404, "Acción desconocida")
    if MODO == "red":
        r = en_servidor(n, COMANDOS_FALLA[accion].format(contenedor=n.contenedor))
        if r.returncode not in (0, 1):
            raise HTTPException(503, f"{n}: {error(r.stderr or r.stdout)}")
    else:
        acciones = {"aislar": op.aislar, "reconectar": op.reconectar, "apagar": op.apagar,
                    "encender": lambda x: op.encender(x, informar=lambda *_: None)}
        try:
            acciones[accion](n)
        except RuntimeError as e:
            raise HTTPException(409, error(e)) from e
    with _conexiones_lock:  # las conexiones guardadas a ese nodo quedaron rotas
        for clave in [k for k in _conexiones if k[0] == cod]:
            par = _conexiones.pop(clave)
            if par[0] is not None:
                par[0].close()
    estado(forzar=True)
    return {"ok": True, "estado": estado_de(cod)}


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
            e = estado_de(n.cod)
            if e not in ("EN LÍNEA", "AISLADO"):
                raise HTTPException(503, f"{n.nombre}: servidor {e.lower()}, no atiende ni siquiera localmente")
            v = leer_sucursal(n, "SELECT * FROM venta_demo(%s)", (n.deptos[0],), "rol_cajero")[0]
            via = " desde su terminal local (sin WAN)" if e == "AISLADO" else ""
            texto = f"{n.nombre} registró la venta #{v['id_venta']} (Bs {float(v['total_bs']):,.2f}){via}"
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
