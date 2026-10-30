# BoliviaDistribución S.A. — Plan de Implementación por Fases (SGBDD, 6 nodos)

> **Estado (30/10/2026): implementado.** Este plan fue la guía de diseño; la implementación final
> difiere en algunos detalles operativos. Para comandos y configuración vigentes ver el `README.md`:
> puertos **15431–15436** (no 5432/5433), un único archivo **`.env`** (no `nodos.env`), código en el
> paquete **`sgbdd/`**, operación con **`gestion.py`** y pruebas con **`python -m pruebas.ejecutar_pruebas`**.

> Plan técnico para construir, probar y defender el prototipo. Cada fase tiene: objetivo, tareas,
> entregable y **criterio de "terminado"** (lo que tiene que funcionar antes de pasar a la siguiente).
> Todo con herramientas **100 % gratuitas**.

---

## 0. Decisiones de arquitectura (y por qué)

| Decisión | Elección | Justificación para la defensa |
|---|---|---|
| Motor | **PostgreSQL 16** (uno por nodo) | Gratis, tiene todo nativo: `postgres_fdw` (transparencia), replicación lógica (catálogo), `PREPARE TRANSACTION` (2PC). |
| ¿Citus / CockroachDB? | **No** | Esconden la fragmentación dentro del motor: el tribunal no ve *tus* fragmentos, ni *tu* 2PC. Con PostgreSQL "puro" cada concepto del curso es visible en un script. |
| Infraestructura | **Docker** en **3-4 laptops** (despliegue real, lo pide el ingeniero) + modo "todo en una laptop" para desarrollar | Mismos scripts en ambos modos: solo cambia el archivo de direcciones (`nodos.env`). Ver **§11**. |
| Red entre laptops | **Tailscale** (VPN WireGuard, plan gratuito) o router propio | Simula la WAN/VPN corporativa que une departamentos lejanos. Ver **§11.2**. |
| Transparencia | Tabla **particionada por LIST** en La Paz cuyas particiones son **tablas foráneas** | Es literalmente la definición formal de fragmentación horizontal (σ por `departamento_id`) y además da *partition pruning* (`EXPLAIN` lo muestra). |
| Catálogo | Replicación lógica `PUBLICATION`/`SUBSCRIPTION` desde LP | Asíncrona; Beni se pone al día solo al reconectar ("sincronización diferida"). |
| 2PC | **Coordinador en Python** (psycopg 3) contra los nodos, log de decisiones en **Nodo 3 (Cochabamba)** | `postgres_fdw` **no permite** `PREPARE TRANSACTION` sobre tablas foráneas → el coordinador debe abrir conexiones directas. CB es el "hub de traspasos" según el enunciado. |
| Interfaz | **Streamlit** (dashboard) + **pgAdmin 4** (administración) | Ambos gratis; Streamlit = un solo archivo Python, comparte código con el coordinador 2PC. |

### ⚠️ Correcciones al documento de trabajo actual
1. **2PC vía `postgres_fdw` no funciona** (error *"cannot PREPARE a transaction that has operated on postgres_fdw foreign tables"*). El 2PC se hace desde el coordinador Python.
2. **`docker stop` no demuestra autonomía local**: apaga el nodo. Usar `docker network disconnect` → Beni queda **vivo y vendiendo localmente** pero aislado. Eso es autonomía.
3. Falta el caso más evaluado de 2PC: **transacción en duda** (in-doubt) cuando el coordinador cae después del PREPARE. Se agrega log de decisiones + script de recuperación.
4. **IDs globales**: si cada nodo usa `SERIAL` desde 1, `id_venta = 1` existe 6 veces y la vista nacional se rompe. Se usan rangos por nodo.
5. **No existen FOREIGN KEY entre nodos.** Se definen reglas explícitas (ver §1.4).
6. No usar tildes/Ñ en identificadores: `productos_catalogo`, no `PRODUCTOS_CATÁLOGO`.

---

## 0.1 Estrategia de desarrollo (confirmada: el ingeniero acepta Docker)

**Prioridad del proyecto: la base de datos.** El 95 % de la nota (Diseño, Autonomía/Transparencia, Transacciones, Demo)
se gana con SQL, red y 2PC. La interfaz solo sirve para *mostrar* eso con claridad.

| Etapa | Dónde | Semanas | Qué se hace |
|---|---|---|---|
| **1. Laboratorio** | **1 laptop**, 6 contenedores Docker | 1 → 3 (inicio) | Todo el SQL, réplica, fdw, 2PC y pruebas P1-P12. Rápido de reiniciar. |
| **2. Despliegue distribuido** | **4 laptops** con Docker + **Tailscale** | 3 | Los **mismos scripts**, solo cambia `nodos.env`. Repetir P1-P12 entre laptops. |
| **3. Defensa** | 4 laptops (Beni sola en L4) | Día D | Guion §7.2. Plan B: modo 1 laptop + video. |

> Las **VMs (§12) quedan como opción**, no como requisito: Docker en varias laptops con Tailscale ya es un despliegue
> distribuido real (cada laptop = un departamento, la VPN = la WAN). Solo usar VMs si el ingeniero lo exige.

## 0.2 Stack tecnológico definitivo (todo gratis)

| Capa | Tecnología | Para qué | Prioridad |
|---|---|---|---|
| **Motor BD** | **PostgreSQL 16** (imagen `postgres:16`) | Un motor por nodo | 🔴 Núcleo |
| Fragmentación horizontal | Tablas locales + `CHECK` por fragmento | FV1-FV6, inventario derivado | 🔴 Núcleo |
| Fragmentación vertical | `clientes_datos_generales` (nodos) / `clientes_financiero` (LP) + `GRANT` | FC1 / FC2 | 🔴 Núcleo |
| Transparencia | Extensión **`postgres_fdw`** + tablas particionadas con particiones foráneas | `ventas_nacionales` | 🔴 Núcleo |
| Replicación | **Replicación lógica** nativa (`PUBLICATION`/`SUBSCRIPTION`) | Catálogo en 6 nodos | 🔴 Núcleo |
| Transacciones | **`PREPARE TRANSACTION` / `COMMIT PREPARED`** nativos (2PC) | Traspasos | 🔴 Núcleo |
| Coordinador 2PC | **Python 3.12+** + **psycopg 3** (API `tpc_*`) | Orquestar el 2PC y la recuperación | 🔴 Núcleo |
| Carga de datos | SQL `generate_series` (+ Faker opcional) | ≥ 50 000 ventas | 🔴 Núcleo |
| Contenedores | **Docker Desktop** (WSL2) + **Docker Compose** | 6 nodos | 🔴 Núcleo |
| Red entre laptops | **Tailscale** (alternativa: ZeroTier / router propio) | WAN simulada | 🔴 Núcleo |
| Simular WAN lenta | `tc netem` dentro del contenedor | Latencia Beni | 🟡 Extra |
| Administración SQL | **pgAdmin 4** (contenedor) o **DBeaver Community** | Mostrar DDL, `EXPLAIN` | 🟠 Demo |
| Interfaz demo | **Streamlit** (Python) | Panel de nodos, 2PC, fallos | 🟠 Demo |
| Control de versiones | **Git + GitHub** (repo privado) | Trabajo en equipo | 🟠 Necesario |
| Diagramas | **dbdiagram.io**, **draw.io**, Mermaid | ER, arquitectura, secuencia 2PC | 🟠 Documentación |
| Grabación | **OBS Studio** | Video de respaldo | 🟡 Plan B |

**No se usan (y por qué, por si preguntan):** Citus/CockroachDB (ocultan la distribución), ORMs (el SQL es lo que se evalúa),
Vercel/hosting web (ver §6.1), Grafana/Metabase (bonito pero no suma puntos de BD).

## 0.3 Qué instalar en cada laptop (checklist)
- [ ] Docker Desktop con WSL2 (`docker run hello-world` funciona)
- [ ] Git + acceso al repo de GitHub
- [ ] Tailscale con la cuenta del equipo (`tailscale status` muestra las 4 laptops)
- [ ] Python 3.12+ → `pip install psycopg[binary] streamlit pandas` (al menos en L1 y L3)
- [ ] VS Code (gratis) con extensión de Markdown / SQL
- [ ] Regla de firewall para puertos 5432-5433 (§11.5)
- [ ] (Solo L1) pgAdmin o DBeaver

---

## 1. FASE 1 — Arquitectura y Modelado (Semana 1, días 1-3)

### 1.1 Códigos y mapeo nodo ↔ departamento
| Nodo | Contenedor | Puerto host | BD | Departamentos | Rango de IDs |
|---|---|---|---|---|---|
| 1 | `nodo1_lp` | 5431 | `bd_lp` | LP | 1 000 000 000 … |
| 2 | `nodo2_sc` | 5432 | `bd_sc` | SC | 2 000 000 000 … |
| 3 | `nodo3_cb` | 5433 | `bd_cb` | CB | 3 000 000 000 … |
| 4 | `nodo4_tj` | 5434 | `bd_tj` | TJ, CH | 4 000 000 000 … |
| 5 | `nodo5_or` | 5435 | `bd_or` | OR, PO | 5 000 000 000 … |
| 6 | `nodo6_be` | 5436 | `bd_be` | BE, PA | 6 000 000 000 … |

```sql
id_venta BIGINT GENERATED ALWAYS AS IDENTITY (START WITH 2000000001) PRIMARY KEY  -- en SC
```
El primer dígito del ID dice en qué nodo nació el registro (útil para depurar y para la defensa).

### 1.2 Esquema de fragmentación (qué tabla vive dónde)

| Tabla | Tipo | Ubicación |
|---|---|---|
| `ventas`, `detalle_venta` | Horizontal primaria (σ `departamento_id`) | Fragmento FVi en su nodo |
| `almacenes` | Horizontal primaria (σ `departamento_id`) | Su nodo |
| `inventario` | **Horizontal derivada** (semi-join con `almacenes`) | Nodo del almacén |
| `clientes_datos_generales` | Vertical FC1 + horizontal por `departamento_id` | Nodos 1-6 |
| `clientes_financiero` | Vertical FC2 | **Solo Nodo 1** |
| `productos_catalogo` | Replicación total | Nodos 1-6 (maestro: LP) |
| `traspasos_log` | Log del coordinador 2PC | Solo Nodo 3 |
| `departamentos`, `empleados` (mínima) | Catálogos pequeños | Replicados / locales |

> `detalle_venta` lleva también `departamento_id` (o se fragmenta **derivado** de `ventas`); recomendado: derivada por `id_venta`, y documentarlo así con la fórmula `FDVi = DETALLE_VENTA ⋉ FVi`.

### 1.3 Reglas de corrección de la fragmentación (esto da puntos en "Diseño")
Hay que **enunciarlas y probarlas con una consulta** en el documento:
- **Completitud**: todo registro de VENTAS pertenece a algún fragmento → `CHECK` en cada nodo + los 9 departamentos cubiertos.
- **Reconstrucción**: `VENTAS = FV1 ∪ … ∪ FV6` (horizontal) y `CLIENTES = FC1 ⋈id_cliente FC2` (vertical; la PK se repite en ambos fragmentos).
- **Disyunción**: ningún registro está en dos fragmentos → los `CHECK` son mutuamente excluyentes.

```sql
-- En nodo 4 (Tarija): la restricción materializa el predicado del fragmento
ALTER TABLE ventas ADD CONSTRAINT ck_fragmento_fv4 CHECK (departamento_id IN ('TJ','CH'));
```

### 1.4 Integridad referencial en un sistema distribuido
| Relación | ¿FK real? | Regla |
|---|---|---|
| `detalle_venta → ventas` | Sí (mismo nodo) | FK normal |
| `detalle_venta → productos_catalogo` | Sí (catálogo replicado localmente) | FK normal ✅ gracias a la replicación |
| `inventario → almacenes / productos` | Sí (local) | FK normal |
| `ventas → clientes_datos_generales` | Sí, local | **Regla de negocio**: un nodo solo vende a clientes de su región + un cliente genérico "SIN NOMBRE / NIT 0" por nodo (práctica real en facturación boliviana). |
| `clientes_financiero → clientes_datos_generales` | **No** (nodos distintos) | Se valida con una consulta de conciliación desde LP (§3.4). Cliente sin fila financiera = solo ventas al contado. El crédito lo **otorga LP** (auditoría). |

### 1.5 Matriz CRUD por nodo (entregable obligatorio)
| Tabla | Nodo 1 LP | Nodos 2-6 | Nodo 3 CB (extra) |
|---|---|---|---|
| `productos_catalogo` | **CRUD** (maestro) | R (réplica, escritura revocada) | R |
| `ventas` / `detalle_venta` | CRUD propio · R global (fdw) | CRUD propio | CRUD propio |
| `clientes_datos_generales` | CRUD propio · R global | CRUD propio | CRUD propio |
| `clientes_financiero` | **CRUD exclusivo** | — (sin acceso) | — |
| `inventario` | CRUD propio · R global | CRUD propio · U vía 2PC | CRUD propio · U vía 2PC |
| `traspasos_log` | R (fdw) | — | **CRUD** (coordinador) |

La matriz se **impone con `GRANT/REVOKE`**, no solo se dibuja:
```sql
-- Nodos 2-6
REVOKE INSERT, UPDATE, DELETE ON productos_catalogo FROM rol_cajero;
```

### 1.6 Roles de seguridad (por nodo)
- `rol_cajero`: CRUD en ventas/clientes locales, R catálogo.
- `rol_analista` (solo LP): SELECT en vistas nacionales.
- `rol_auditor` (solo LP): acceso a `clientes_financiero`.
- `fdw_lector`: usuario técnico en nodos 2-6, **solo SELECT**, usado por los `USER MAPPING`.
- `replicador`: rol con `REPLICATION` para las suscripciones.
- Contraseñas en `.env` (nunca en Git; subir `.env.example`).

### Entregables Fase 1
- Diagrama ER global + esquemas fragmentados por nodo (**dbdiagram.io** o **draw.io**, gratis; o Mermaid en el Markdown).
- Fórmulas σ / π / ⋉ de cada fragmento, reglas de corrección, matriz CRUD, justificación.
- ✅ *Terminado cuando*: cada tabla tiene nodo asignado, tipo de fragmento y regla de integridad definida.

---

## 2. FASE 2 — Infraestructura y Datos (Semana 1 día 4 → Semana 2 día 2)

### 2.1 Estructura del repositorio
```
proyecto_base/
├─ docker-compose.yml
├─ .env.example
├─ sql/
│  ├─ comun/        00_tipos.sql, 01_tablas_locales.sql, 02_catalogo.sql   (se ejecuta en los 6)
│  ├─ nodo1_lp/     10_financiero.sql, 20_fdw.sql, 30_vistas.sql, 40_publicacion.sql
│  ├─ nodo2_sc/ … nodo6_be/   10_checks.sql, 40_suscripcion.sql
│  └─ nodo3_cb/     50_traspasos_log.sql
├─ datos/           generar_datos.sql
├─ coordinador/     traspaso_2pc.py, recuperar_2pc.py
├─ dashboard/       app.py   (Streamlit)
├─ pruebas/         fallo_red.sh, concurrencia.py, consistencia.sql
└─ docs/
```

### 2.2 Docker Compose (esqueleto)
```yaml
x-pg: &pg
  image: postgres:16
  environment:
    POSTGRES_PASSWORD: ${PG_PASSWORD}
  command: >
    postgres -c wal_level=logical
             -c max_prepared_transactions=100
             -c max_replication_slots=10 -c max_wal_senders=10
             -c max_slot_wal_keep_size=1GB
             -c shared_buffers=128MB
  networks: [red_nacional]

services:
  nodo1_lp:
    <<: *pg
    environment: { POSTGRES_PASSWORD: "${PG_PASSWORD}", POSTGRES_DB: bd_lp }
    ports: ["5431:5432"]
    volumes:
      - ./sql/comun:/docker-entrypoint-initdb.d/0_comun:ro   # ver nota
      - datos_lp:/var/lib/postgresql/data
  # nodo2_sc … nodo6_be igual, cambiando BD, puerto y volumen
  pgadmin:
    image: dpage/pgadmin4
    environment: { PGADMIN_DEFAULT_EMAIL: admin@bd.bo, PGADMIN_DEFAULT_PASSWORD: "${PG_PASSWORD}" }
    ports: ["5050:80"]
    networks: [red_nacional]

networks: { red_nacional: {} }
volumes: { datos_lp: {}, datos_sc: {}, datos_cb: {}, datos_tj: {}, datos_or: {}, datos_be: {} }
```
Notas:
- `docker-entrypoint-initdb.d` **no recorre subcarpetas**: montar archivos con prefijo numérico (`01_…sql`) o un `init.sh` por nodo que ejecute la carpeta común y la propia.
- Los scripts de init corren **solo con volumen vacío**: para re-ejecutar, `docker compose down -v`.
- `max_prepared_transactions > 0` es **obligatorio** en todos los nodos para 2PC.
- Las suscripciones (Fase 2.4) y los `SERVER` fdw se crean **después** de que todos los nodos estén arriba → script `sql/post_init.sh` que se corre una vez.
- 6 × PostgreSQL con 128 MB ≈ 1,5 GB RAM. Windows: Docker Desktop con WSL2.

### 2.3 DDL base (común, adaptando el CHECK y el START por nodo)
```sql
CREATE TABLE productos_catalogo (
  id_producto     INT PRIMARY KEY,                -- PK obligatoria para replicación lógica
  codigo_barras   VARCHAR(13) UNIQUE NOT NULL,
  nombre          VARCHAR(120) NOT NULL,
  descripcion     TEXT,
  precio_unitario NUMERIC(10,2) NOT NULL CHECK (precio_unitario > 0),
  categoria       VARCHAR(40) NOT NULL
);

CREATE TABLE clientes_datos_generales (
  id_cliente      BIGINT GENERATED ALWAYS AS IDENTITY (START WITH 2000000001) PRIMARY KEY,
  nit_ci          VARCHAR(20) NOT NULL,
  razon_social    VARCHAR(150) NOT NULL,
  telefono        VARCHAR(20),
  direccion       VARCHAR(200),
  departamento_id CHAR(2) NOT NULL CHECK (departamento_id = 'SC')
);

CREATE TABLE almacenes (
  id_almacen      INT PRIMARY KEY,                -- p.ej. 201, 202 en SC; 601 en BE
  nombre_almacen  VARCHAR(80) NOT NULL,
  departamento_id CHAR(2) NOT NULL CHECK (departamento_id = 'SC'),
  direccion       VARCHAR(200)
);

CREATE TABLE inventario (
  id_almacen   INT REFERENCES almacenes,
  id_producto  INT REFERENCES productos_catalogo,
  stock_actual INT NOT NULL CHECK (stock_actual >= 0),   -- última línea de defensa contra stock negativo
  stock_minimo INT NOT NULL DEFAULT 0,
  PRIMARY KEY (id_almacen, id_producto)
);

CREATE TABLE ventas (
  id_venta        BIGINT GENERATED ALWAYS AS IDENTITY (START WITH 2000000001) PRIMARY KEY,
  fecha_hora      TIMESTAMPTZ NOT NULL DEFAULT now(),
  departamento_id CHAR(2) NOT NULL CHECK (departamento_id = 'SC'),
  id_cliente      BIGINT NOT NULL REFERENCES clientes_datos_generales,
  id_empleado     INT NOT NULL,
  total_bs        NUMERIC(12,2) NOT NULL CHECK (total_bs >= 0)
);

CREATE TABLE detalle_venta (
  id_detalle      BIGINT GENERATED ALWAYS AS IDENTITY (START WITH 2000000001) PRIMARY KEY,
  id_venta        BIGINT NOT NULL REFERENCES ventas ON DELETE CASCADE,
  id_producto     INT NOT NULL REFERENCES productos_catalogo,
  cantidad        INT NOT NULL CHECK (cantidad > 0),
  precio_aplicado NUMERIC(10,2) NOT NULL,
  subtotal        NUMERIC(12,2) GENERATED ALWAYS AS (cantidad * precio_aplicado) STORED
);

CREATE INDEX ON ventas (fecha_hora);
CREATE INDEX ON ventas (id_cliente);
CREATE INDEX ON detalle_venta (id_venta);
```
Solo Nodo 1:
```sql
CREATE TABLE clientes_financiero (
  id_cliente         BIGINT PRIMARY KEY,            -- mismo ID que FC1 (clave de reconstrucción)
  limite_credito     NUMERIC(12,2) NOT NULL DEFAULT 0,
  saldo_pendiente    NUMERIC(12,2) NOT NULL DEFAULT 0,
  calificacion_riesgo CHAR(1) NOT NULL CHECK (calificacion_riesgo IN ('A','B','C','D','E')),
  estado_credito     VARCHAR(12) NOT NULL CHECK (estado_credito IN ('ACTIVO','SUSPENDIDO','MOROSO')),
  CHECK (saldo_pendiente <= limite_credito)
);
```
Solo Nodo 3:
```sql
CREATE TABLE traspasos_log (
  gid          VARCHAR(64) PRIMARY KEY,            -- id global de la transacción 2PC
  origen       CHAR(2) NOT NULL, destino CHAR(2) NOT NULL,
  id_almacen_origen INT NOT NULL, id_almacen_destino INT NOT NULL,
  id_producto  INT NOT NULL, cantidad INT NOT NULL CHECK (cantidad > 0),
  estado       VARCHAR(12) NOT NULL CHECK (estado IN ('INICIADO','PREPARADO','COMMIT','ABORTADO')),
  creado_en    TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 2.4 Replicación del catálogo
```sql
-- Nodo 1 (LP)
CREATE ROLE replicador WITH REPLICATION LOGIN PASSWORD '***';
GRANT SELECT ON productos_catalogo TO replicador;
CREATE PUBLICATION pub_catalogo FOR TABLE productos_catalogo;

-- Nodos 2-6 (la tabla ya debe existir vacía)
CREATE SUBSCRIPTION sub_catalogo
  CONNECTION 'host=nodo1_lp port=5432 dbname=bd_lp user=replicador password=***'
  PUBLICATION pub_catalogo;          -- copy_data = true: copia inicial automática
```
Monitoreo: `SELECT * FROM pg_stat_subscription;` (réplica) y `SELECT slot_name, active, pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), confirmed_flush_lsn)) FROM pg_replication_slots;` (LP) → muestra el **retraso de Beni** en bytes.

### 2.5 Carga de datos (≥ 50 000 ventas)
Generar **dentro de cada nodo con `generate_series`** (sin dependencias, segundos). Distribución realista:

| Nodo | % ventas | Ventas |
|---|---|---|
| SC | 30 % | 15 000 |
| LP | 25 % | 12 500 |
| CB | 20 % | 10 000 |
| TJ+CH | 10 % | 5 000 |
| OR+PO | 10 % | 5 000 |
| BE+PA | 5 % | 2 500 |

```sql
-- Ejemplo nodo 4 (alterna TJ/CH); 1-5 detalles por venta; precios del catálogo replicado
WITH cli AS (SELECT array_agg(id_cliente) ids FROM clientes_datos_generales)
INSERT INTO ventas (fecha_hora, departamento_id, id_cliente, id_empleado, total_bs)
SELECT now() - random() * interval '365 days',
       CASE WHEN g % 3 = 0 THEN 'CH' ELSE 'TJ' END,
       cli.ids[1 + floor(random() * cardinality(cli.ids))::int],   -- cliente aleatorio por fila
       (random()*20)::int + 1, 0
FROM generate_series(1, 5000) g, cli;
-- luego detalle_venta con generate_series y, al final:
UPDATE ventas v SET total_bs = d.s FROM (SELECT id_venta, sum(subtotal) s FROM detalle_venta GROUP BY 1) d
WHERE d.id_venta = v.id_venta;
```
> Si se prefiere Python, **Faker** (gratis) da nombres/NIT/direcciones creíbles.

Además: ~200 productos (en LP; se replican solos), ~2 000 clientes, 2-3 almacenes por nodo, inventario para cada (almacén, producto), ~300 filas en `clientes_financiero`.

### Entregables Fase 2
- `docker compose up -d` levanta los 6 nodos + pgAdmin.
- ✅ *Terminado cuando*: `SELECT count(*) FROM ventas` en cada nodo suma ≥ 50 000; insertar un producto en LP aparece en los 6 nodos; `UPDATE productos_catalogo` en SC es **rechazado**.

---

## 3. FASE 3 — Transparencia y Consultas Distribuidas (Semana 2, días 3-5)

### 3.1 Servidores foráneos (en Nodo 1)
```sql
CREATE EXTENSION postgres_fdw;
CREATE SERVER srv_sc FOREIGN DATA WRAPPER postgres_fdw
  OPTIONS (host 'nodo2_sc', port '5432', dbname 'bd_sc',
           connect_timeout '3',        -- falla rápido si el nodo cae
           async_capable 'true',       -- consulta los 5 nodos EN PARALELO (PG14+)
           fetch_size '5000');
CREATE USER MAPPING FOR rol_analista SERVER srv_sc
  OPTIONS (user 'fdw_lector', password '***');
-- repetir para srv_cb, srv_tj, srv_or, srv_be
```

### 3.2 Vista nacional como tabla particionada (la pieza clave)
```sql
CREATE TABLE ventas_nacionales (
  id_venta BIGINT NOT NULL, fecha_hora TIMESTAMPTZ NOT NULL, departamento_id CHAR(2) NOT NULL,
  id_cliente BIGINT NOT NULL, id_empleado INT NOT NULL, total_bs NUMERIC(12,2) NOT NULL
) PARTITION BY LIST (departamento_id);

-- FV1 local: la tabla ventas de LP se adjunta como partición (mismas columnas)
ALTER TABLE ventas_nacionales ATTACH PARTITION ventas FOR VALUES IN ('LP');

CREATE FOREIGN TABLE fv2_sc PARTITION OF ventas_nacionales FOR VALUES IN ('SC')
  SERVER srv_sc OPTIONS (table_name 'ventas');
CREATE FOREIGN TABLE fv3_cb PARTITION OF ventas_nacionales FOR VALUES IN ('CB')
  SERVER srv_cb OPTIONS (table_name 'ventas');
CREATE FOREIGN TABLE fv4_tj PARTITION OF ventas_nacionales FOR VALUES IN ('TJ','CH')
  SERVER srv_tj OPTIONS (table_name 'ventas');
CREATE FOREIGN TABLE fv5_or PARTITION OF ventas_nacionales FOR VALUES IN ('OR','PO')
  SERVER srv_or OPTIONS (table_name 'ventas');
CREATE FOREIGN TABLE fv6_be PARTITION OF ventas_nacionales FOR VALUES IN ('BE','PA')
  SERVER srv_be OPTIONS (table_name 'ventas');
```
Lo mismo para `detalle_nacional`, `clientes_nacionales`, `inventario_nacional`.

Por qué es mejor que una vista `UNION ALL`:
- `SELECT * FROM ventas_nacionales` → el analista **no sabe** dónde están los datos (transparencia de localización y fragmentación).
- `... WHERE departamento_id = 'TJ'` → **solo consulta Tarija** (partition pruning). Demostrarlo con `EXPLAIN (VERBOSE)`.
- `GROUP BY departamento_id` → postgres_fdw **empuja la agregación** a cada nodo (viaja el resultado, no 50 000 filas). Mostrar el `Remote SQL` en el `EXPLAIN`.

> Si además piden literalmente una "vista", crear `CREATE VIEW v_ventas_nacionales AS SELECT … FROM ventas_nacionales;` (con nombres amigables y join a departamento).

### 3.3 Consultas distribuidas obligatorias (preparar en `sql/nodo1_lp/60_consultas_demo.sql`)
1. Ventas totales por departamento y mes (agregación distribuida).
2. **JOIN cliente LP ↔ ventas Tarija** (pedido explícitamente en el PDF):
   ```sql
   SELECT c.razon_social, f.limite_credito, f.saldo_pendiente, sum(v.total_bs) compras_tarija
   FROM ventas_nacionales v
   JOIN clientes_nacionales c USING (id_cliente)
   JOIN clientes_financiero f USING (id_cliente)       -- FC2 local en LP
   WHERE v.departamento_id IN ('TJ','CH')
   GROUP BY 1,2,3 ORDER BY 4 DESC LIMIT 20;
   ```
3. **Reconstrucción vertical**: `clientes_completo = clientes_nacionales ⋈ clientes_financiero` (vista solo para `rol_auditor`).
4. Top 10 productos a nivel nacional (detalle de 6 nodos ⋈ catálogo local).
5. Inventario bajo mínimo en todo el país (`stock_actual < stock_minimo`).

### 3.4 Consultas de verificación (integridad sin FK)
```sql
-- Disyunción: no debe devolver filas
SELECT id_venta FROM ventas_nacionales GROUP BY id_venta HAVING count(*) > 1;
-- Financieros huérfanos (FC2 sin FC1)
SELECT f.id_cliente FROM clientes_financiero f
LEFT JOIN clientes_nacionales c USING (id_cliente) WHERE c.id_cliente IS NULL;
```

### 3.5 Consulta tolerante a fallos (extra, sube nota en "Transparencia")
Si un nodo está caído, `SELECT * FROM ventas_nacionales` **falla entero**. Ofrecer una función que devuelve lo disponible y avisa:
```sql
CREATE FUNCTION resumen_nacional_disponible()
RETURNS TABLE (departamento_id CHAR(2), total NUMERIC, estado TEXT) LANGUAGE plpgsql AS $$
DECLARE p RECORD;
BEGIN
  FOR p IN SELECT c.relname FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
           WHERE i.inhparent = 'ventas_nacionales'::regclass LOOP
    BEGIN
      RETURN QUERY EXECUTE format(
        'SELECT departamento_id, sum(total_bs), ''ONLINE''::text FROM %I GROUP BY 1', p.relname);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Fragmento % no disponible: %', p.relname, SQLERRM;
      RETURN QUERY SELECT NULL::char(2), NULL::numeric, 'OFFLINE: ' || p.relname;
    END;
  END LOOP;
END $$;
```

✅ *Terminado cuando*: las 5 consultas corren desde LP, `EXPLAIN` muestra pruning y agregación remota, y la función devuelve resultados parciales con un nodo desconectado.

---

## 4. FASE 4 — Transacción Distribuida 2PC (Semana 2 día 5 → Semana 3 día 2)

### 4.1 Protocolo (traspaso SC → BE)
```
Coordinador (Python)            Nodo 3 CB (log)   Nodo 2 SC (origen)          Nodo 6 BE (destino)
 1. INSERT log 'INICIADO' ─────────►
 2. BEGIN; UPDATE stock -= n ────────────────────────► (fila bloqueada)
    PREPARE TRANSACTION 'gid'  ──────────────────────► VOTO SÍ (o NO si no hay stock)
 3. BEGIN; UPSERT stock += n ─────────────────────────────────────────────────► 
    PREPARE TRANSACTION 'gid'  ──────────────────────────────────────────────► VOTO SÍ / timeout
 4. Si ambos SÍ: UPDATE log 'COMMIT'  (← punto de decisión, durable)
      COMMIT PREPARED 'gid' en SC y BE
    Si alguno NO/timeout: UPDATE log 'ABORTADO'
      ROLLBACK PREPARED 'gid' en los que votaron SÍ   ← requisito del PDF
```

### 4.2 SQL que ejecuta cada participante
```sql
-- Origen (SC): descuento atómico, sin SELECT previo (evita condición de carrera)
BEGIN;
UPDATE inventario SET stock_actual = stock_actual - 50
WHERE id_almacen = 201 AND id_producto = 15 AND stock_actual >= 50;
-- si filas afectadas = 0 → stock insuficiente → ROLLBACK y voto NO
PREPARE TRANSACTION 'trp-20261029-0001-SC';

-- Destino (BE)
BEGIN;
INSERT INTO inventario (id_almacen, id_producto, stock_actual) VALUES (601, 15, 50)
ON CONFLICT (id_almacen, id_producto) DO UPDATE SET stock_actual = inventario.stock_actual + 50;
PREPARE TRANSACTION 'trp-20261029-0001-BE';

-- Fase 2
COMMIT PREPARED 'trp-20261029-0001-SC';   COMMIT PREPARED 'trp-20261029-0001-BE';
-- o
ROLLBACK PREPARED 'trp-20261029-0001-SC';
```

### 4.3 Coordinador (`coordinador/traspaso_2pc.py`) — puntos de implementación
- Conexiones directas con `psycopg` (v3) y `connect_timeout=3`, `options='-c statement_timeout=5000 -c lock_timeout=3000'`.
- psycopg trae API 2PC nativa: `conn.xid()`, `tpc_begin()`, `tpc_prepare()`, `tpc_commit()`, `tpc_rollback()`, `tpc_recover()`.
- Parámetro `pausa_entre_fases` (segundos) **para la demo**: deja tiempo de desconectar Beni en vivo.
- Si la conexión al participante muere **después** de su PREPARE, el rollback/commit se hace abriendo **una conexión nueva** y ejecutando `ROLLBACK/COMMIT PREPARED 'gid'` (la transacción preparada sobrevive en disco, incluso a un reinicio del nodo).
- Orden fijo de bloqueo (por `id_almacen` ascendente) para evitar deadlocks entre traspasos cruzados SC→BE y BE→SC.
- Registro opcional del movimiento en cada nodo (`movimientos_inventario`) dentro de la misma transacción local, para auditoría.

### 4.4 Recuperación de transacciones en duda (`coordinador/recuperar_2pc.py`)
Escenario: ambos nodos votaron SÍ, el coordinador muere antes de la fase 2. Las filas quedan **bloqueadas** (`SELECT * FROM pg_prepared_xacts;` lo muestra).
Regla de recuperación (presunción de abort):
- Si `traspasos_log.estado = 'COMMIT'` → `COMMIT PREPARED` en quienes falten.
- Si no → `ROLLBACK PREPARED`.
Ejecutar al arrancar el coordinador y con un botón en el dashboard. **Este es el punto que diferencia un 2PC "de libro" de uno profesional.**

### 4.5 Concurrencia (`pruebas/concurrencia.py`)
- Stock SC del producto 15 = 100. Lanzar **20 traspasos simultáneos de 10 unidades** (hilos).
- Esperado: exactamente 10 confirmados, 10 abortados por stock, stock SC = 0, **nunca negativo**.
- **Invariante de conservación**: `stock_total_nacional(producto)` antes = después (consulta vía `inventario_nacional`). Mostrarlo en pantalla: es la prueba de "sin inconsistencias" de la rúbrica.

✅ *Terminado cuando*: 4 escenarios pasan — éxito, stock insuficiente, Beni cae en mitad (rollback SC), coordinador cae tras PREPARE (recuperación).

---

## 5. FASE 5 — Fallos, Autonomía y Consistencia (Semana 3, días 2-3)

### 5.1 Simulación de corte de red (no apagar el nodo)
```bash
docker network disconnect proyecto_base_red_nacional nodo6_be   # Beni aislado
docker network connect    proyecto_base_red_nacional nodo6_be   # Beni reconecta
```
Con el host aún puede conectarse a Beni por el puerto 5436 → se ve que **Beni sigue vendiendo localmente**.

Opcional (realismo Amazonía): ancho de banda bajo y latencia con `tc netem` (agregar `cap_add: [NET_ADMIN]` al servicio e instalar `iproute2` en la imagen):
```bash
docker exec nodo6_be tc qdisc add dev eth0 root netem delay 400ms 100ms loss 5% rate 256kbit
```

### 5.2 Matriz de pruebas (registrar resultado + captura en el documento)
| # | Prueba | Acción | Resultado esperado |
|---|---|---|---|
| P1 | Autonomía local | Aislar BE; insertar ventas en BE y en SC | Ambos insertan sin error |
| P2 | Vista global degradada | Con BE aislado, `SELECT * FROM ventas_nacionales` en LP | Error claro (no cuelga: `connect_timeout`) |
| P3 | Pruning con nodo caído | `WHERE departamento_id='SC'` con BE aislado | **Funciona** (no toca BE) |
| P4 | Consulta tolerante | `resumen_nacional_disponible()` | 5 nodos ONLINE + BE OFFLINE |
| P5 | Catálogo – consistencia eventual | Aislar BE, cambiar precio en LP, revisar SC y BE | SC actualizado en < 1 s; BE con precio viejo |
| P6 | Sincronización diferida | Reconectar BE | BE recibe el cambio automáticamente; medir tiempo |
| P7 | 2PC éxito | Traspaso SC→BE | Stock movido, log COMMIT |
| P8 | 2PC caída destino | Traspaso con pausa; aislar BE durante la pausa | Rollback automático en SC, stock intacto |
| P9 | 2PC en duda | Matar coordinador tras PREPARE | `pg_prepared_xacts` con filas; recuperación las resuelve |
| P10 | Concurrencia | 20 traspasos paralelos | Sin negativos, invariante conservado |
| P11 | Seguridad | Desde SC intentar leer `clientes_financiero` / editar catálogo | Denegado |
| P12 | Caída de LP | Aislar LP | Nodos 2-6 venden; solo se pierde consulta nacional y edición de catálogo |

### 5.3 Consistencia del catálogo (que piden explícitamente)
- La replicación lógica es **eventualmente consistente** → explicarlo y medir el *lag* (`pg_stat_subscription.latest_end_time`).
- Para mostrar el contraste con **consistencia fuerte**: actualizar un precio en los 6 nodos con el mismo coordinador 2PC (con `session_replication_role` / desactivando la suscripción solo para esa prueba) → si un nodo está caído, la actualización **no se puede hacer**. Conclusión para la defensa (teorema CAP): para el catálogo se elige **disponibilidad** (eventual); para el inventario se elige **consistencia** (2PC).

---

## 6. FASE 6 — Interfaz de Demostración (Semana 3, días 3-4) — opciones gratuitas

| Herramienta | Uso | Costo | Recomendación |
|---|---|---|---|
| **Streamlit** (Python) | Dashboard de la demo | Gratis, OSS | ⭐ **Principal**: 1 archivo, reutiliza el coordinador 2PC |
| **pgAdmin 4** (contenedor) | Mostrar DDL, ejecutar SQL, ver `EXPLAIN` gráfico | Gratis | ⭐ Para mostrar scripts al tribunal |
| **DBeaver Community** | Cliente SQL de escritorio con ER automático | Gratis | Alternativa a pgAdmin; buen diagrama ER |
| **Grafana OSS** (contenedor) | Gráficas en vivo: ventas por nodo, lag de réplica | Gratis | Opcional "wow", consume tiempo |
| Metabase OSS / Adminer | BI / cliente web ligero | Gratis | No necesarios |
| dbdiagram.io / draw.io | Diagramas ER y de arquitectura | Gratis | Para la documentación |

### 6.1 ¿Y Vercel?
**No conviene para este proyecto.** Vercel aloja la web **en la nube (internet)**, pero los nodos están en las laptops,
dentro de la red privada Tailscale. Para que Vercel los alcance habría que **exponer PostgreSQL a internet** (inseguro y
contradice el diseño) y, el día de la defensa, la demo dependería del internet de la universidad.
Además, en la demo hay que **desconectar nodos**: la interfaz tiene que estar *dentro* de la red, junto a ellos.

**Streamlit corriendo en L1** cumple todo: es local, gratis, un solo archivo Python, sin HTML/CSS/JS, y
reutiliza el mismo código del coordinador 2PC. Si sobra tiempo al final, se puede publicar en Vercel una
**página estática de documentación** (arquitectura, diagramas), sin conexión a la BD — opcional, no suma puntos.

**Regla de oro:** cada pantalla del dashboard debe mostrar **el SQL que ejecuta** (`st.code`). El tribunal evalúa la BD;
la interfaz es solo una ventana a ella.

### Pantallas del dashboard Streamlit (`dashboard/app.py`)
1. **Mapa de nodos**: semáforo verde/rojo por nodo (`SELECT 1` con timeout 1 s), lag de réplica por suscriptor, nº de `pg_prepared_xacts` pendientes.
2. **Consulta nacional**: botón ejecuta `ventas_nacionales` agrupado → `st.bar_chart` por departamento; checkbox "mostrar EXPLAIN".
3. **Venta local**: elegir nodo → registrar venta (demuestra autonomía con el nodo aislado).
4. **Traspaso 2PC**: origen, destino, producto, cantidad, *pausa entre fases*, checkbox **"simular caída del destino"** → muestra paso a paso (PREPARE ✓ / ✗, COMMIT/ROLLBACK) y stocks antes/después + invariante.
5. **Fallos**: botones "Aislar nodo" / "Reconectar" (llaman `docker network disconnect/connect` vía `subprocess`), botón "Recuperar transacciones en duda".
6. **Catálogo**: editar precio en LP y ver en tabla los 6 precios convergiendo.

Ejecutar: `pip install streamlit psycopg[binary] pandas` → `streamlit run dashboard/app.py` (http://localhost:8501).

---

## 7. FASE 7 — Documentación y Sustentación (Semana 3, días 4-5)

### 7.1 Documentación (5 %, pero barata)
- **Manual de arquitectura**: topología, fórmulas de fragmentación, reglas de corrección, matriz CRUD, decisiones (§0) y CAP.
- **Scripts DDL/DML** comentados (ya en `sql/`).
- **Guía de despliegue**: requisitos, `.env`, `docker compose up -d`, `post_init.sh`, carga de datos, cómo correr dashboard y pruebas, cómo resetear (`down -v`).
- **Informe de pruebas**: tabla §5.2 con capturas.

### 7.2 Guion de la demo en vivo (20 %) — ~12 minutos
1. (1 min) Arquitectura en una diapositiva: 6 nodos, qué vive dónde.
2. (2 min) `docker ps` + dashboard en verde. Conteo de ventas por nodo (≥ 50 000).
3. (2 min) Transparencia: `SELECT * FROM ventas_nacionales` + `EXPLAIN` con pruning; JOIN cliente LP ↔ ventas Tarija.
4. (2 min) Catálogo: cambiar precio en LP → aparece en todos. Intentar editar en SC → denegado.
5. (3 min) **Aislar Beni**: Beni sigue vendiendo; vista global degradada; cambiar precio → Beni desactualizado; reconectar → se sincroniza solo.
6. (3 min) **2PC**: traspaso exitoso → traspaso con caída de Beni (rollback SC, stock intacto) → coordinador caído (transacción en duda + recuperación) → prueba de concurrencia con invariante.

Plan B: **video grabado** de la demo completa (OBS Studio, gratis) por si falla la laptop/proyector.

### 7.3 Preguntas probables del tribunal (preparar respuesta)
- ¿Por qué 2PC y no 3PC? ¿Cuál es el problema de bloqueo de 2PC? (→ mostrar P9).
- ¿Qué pasa si cae el coordinador? ¿Y si cae LP?
- ¿Por qué no hay FK entre nodos? ¿Cómo garantizan integridad?
- ¿Cómo evitan IDs duplicados?
- ¿Consistencia fuerte o eventual en el catálogo? ¿Por qué? (CAP)
- ¿Qué es fragmentación derivada? ¿Cómo prueban completitud, reconstrucción y disyunción?
- ¿Por qué no Citus/CockroachDB?

---

## 8. Cronograma y reparto (equipo de 4)

| Semana | Integrante A (Arquitecto/BD) | B (Infra/Datos) | C (Transacciones) | D (Interfaz/Docs) |
|---|---|---|---|---|
| 1 | ER, fragmentos, fórmulas, matriz CRUD | docker-compose, init scripts | Diseño protocolo 2PC + log | Repo, plantillas de documento, diagramas |
| 2 | Vistas particionadas, fdw, consultas | Carga 50k, replicación, roles | Coordinador + recuperación | Dashboard pantallas 1-3 |
| 3 | Pruebas P1-P6, consistencia | Pruebas de red (netem) | Pruebas P7-P10 | Pantallas 4-6, manual, guion, video |

Equipo de 3: unir B y D. Integración diaria en GitHub (gratis); un `README` con "cómo levantar todo en 3 comandos".

---

## 9. Checklist contra la rúbrica

| Criterio | % | Evidencia que vamos a mostrar |
|---|---|---|
| Diseño y Fragmentación | 25 | Fórmulas σ/π/⋉, CHECK por fragmento, reglas de corrección probadas con SQL, matriz CRUD con GRANT |
| Autonomía Local y Transparencia | 25 | P1, P3, P4, P12 · `ventas_nacionales` con pruning y agregación remota |
| Transacciones y Concurrencia | 25 | P7-P10 · log de decisiones · recuperación en duda · invariante de stock |
| Demostración Práctica | 20 | Guion de 12 min + dashboard + video de respaldo |
| Documentación | 5 | Manual, scripts comentados, guía de despliegue, informe de pruebas |

## 10. Riesgos y mitigación
| Riesgo | Mitigación |
|---|---|
| Laptop sin RAM para 6 nodos | `shared_buffers=128MB`; cerrar otros programas; probar en la laptop de la defensa |
| Docker Desktop / WSL2 falla en Windows | Instalarlo la semana 1; plan B: 6 bases en un solo PostgreSQL local con fdw entre bases (pierde realismo de red) |
| Slot de replicación de Beni llena el disco estando aislado mucho tiempo | `max_slot_wal_keep_size=1GB` |
| Transacciones preparadas olvidadas bloquean filas | Script de recuperación + indicador en dashboard |
| Wi-Fi de la universidad bloquea puertos (modo multi-laptop) | Demo principal en Docker de una sola laptop |
| Scripts de init no se re-ejecutan | `docker compose down -v` antes de reconstruir |
| Una laptop del equipo falla el día de la defensa | Cualquier laptop puede levantar cualquier nodo (mismo repo); `pg_dump` de cada nodo guardado; modo "6 nodos en una laptop" como último recurso |

---

## 11. Despliegue distribuido real: laptops, red y VPS

### 11.1 Cómo funciona en el mundo real (lo que hay que explicar en la defensa)
Los departamentos están a cientos de km. **No se conectan con un cable directo**: cada sede tiene su **red local (LAN)**
con su servidor de BD, y las sedes se unen por una **WAN**:

```
   SEDE LA PAZ (LAN 10.1.0.0/24)                 SEDE SANTA CRUZ (LAN 10.2.0.0/24)
 ┌──────────────────────────────┐              ┌──────────────────────────────┐
 │ Cajas/PCs ── Servidor BD LP  │              │ Servidor BD SC ── Cajas/PCs  │
 │                 │            │              │       │                      │
 │            Router/Firewall ═══╪══ Internet ══╪═══ Router/Firewall           │
 └──────────────────────────────┘   + túnel    └──────────────────────────────┘
                                    VPN cifrado
                     (o enlace MPLS dedicado de Entel / Tigo / Viva)
```
- **Opción empresa 1 — MPLS**: línea privada alquilada al operador. Cara, estable, latencia garantizada.
- **Opción empresa 2 — VPN sitio a sitio** (IPsec o WireGuard) sobre internet común. Barata; es lo más usado hoy.
- En ambos casos, para la base de datos **todas las sedes parecen estar en una sola red privada**: el Nodo LP
  se conecta a `10.2.0.10:5432` (SC) aunque esté a 900 km.
- La distancia se nota en **latencia** (aprox. decenas de ms LP↔SC, cientos de ms en zonas con enlace satelital/radio
  como Beni/Pando) y en **cortes**. **Por eso el diseño es así**: lo cotidiano (ventas, stock) es local y rápido;
  solo lo nacional (consolidación, traspasos, catálogo) cruza la WAN. Esa es la justificación de toda la fragmentación.

### 11.2 Cómo lo simulamos con laptops (3 niveles, de más simple a más realista)

| Nivel | Red | Cuándo usarlo | Representa |
|---|---|---|---|
| **A. Una laptop** | Red virtual de Docker | Desarrollo diario (Fases 2-5) | Laboratorio |
| **B. Misma LAN** | Router propio o hotspot del celular; IPs `192.168.x.x` | Pruebas en clase | Red corporativa en un solo edificio |
| **C. VPN overlay** ⭐ | **Tailscale** (gratis) sobre cualquier internet; IPs `100.x.y.z` | Defensa y pruebas desde casas distintas | **VPN sitio a sitio entre departamentos** (lo real) |

**Recomendado: Nivel C con Tailscale.**
- Gratis (plan personal), usa WireGuard, cifrado, sin abrir puertos del router, funciona aunque cada integrante esté en su casa
  o el Wi-Fi de la universidad bloquee el tráfico entre equipos (*client isolation*, muy común).
- Instalación: descargar Tailscale → iniciar sesión con la **misma cuenta del equipo** en las 4 laptops → cada una recibe
  una IP fija `100.x.y.z` y un nombre (`laptop-lp`, `laptop-sc`, …). Probar: `ping laptop-sc`.
- Alternativa gratuita equivalente: **ZeroTier**.
- Para la demo es **más convincente**: "apagamos la VPN de Beni" = corte del enlace WAN de Beni.

> Nivel B falla seguido en la universidad (aislamiento de clientes en el Wi-Fi). Si se usa, llevar un **router propio**.

### 11.3 Reparto de nodos en laptops

**Con 4 laptops** (recomendado, Beni queda sola para desconectarla físicamente):
| Laptop | Nodos | Además corre |
|---|---|---|
| L1 "La Paz" | Nodo 1 LP | pgAdmin, dashboard Streamlit, vistas nacionales |
| L2 | Nodo 2 SC + Nodo 4 TJ | — |
| L3 | Nodo 3 CB + Nodo 5 OR | **Coordinador 2PC** + `traspasos_log` |
| L4 "Beni" | Nodo 6 BE | dashboard local de caja (para mostrar que sigue vendiendo aislada) |

**Con 3 laptops**: L1 = LP · L2 = SC + TJ + CB · L3 = OR + BE.

Requisito por laptop: Docker Desktop (WSL2) y ~1 GB de RAM libre por nodo.
Alternativa si una laptop no soporta Docker: **PostgreSQL 16 instalado directamente** (instalador gratuito de EDB); los scripts SQL son los mismos.

### 11.4 Mismo código, distinta dirección: el archivo `nodos.env`
El repo es **el mismo en todas las laptops**. Lo único que cambia es dónde vive cada nodo:
```ini
# nodos.env  (Nivel C - Tailscale)
HOST_LP=laptop-lp      PORT_LP=5432
HOST_SC=laptop-sc      PORT_SC=5432
HOST_TJ=laptop-sc      PORT_TJ=5433      # 2 nodos en la misma laptop → otro puerto
HOST_CB=laptop-cb      PORT_CB=5432
HOST_OR=laptop-cb      PORT_OR=5433
HOST_BE=laptop-be      PORT_BE=5432
```
- Cada laptop levanta solo sus nodos: `docker compose --profile sc --profile tj up -d` (perfiles en el compose).
- Los scripts de fdw y suscripción leen las direcciones con variables de `psql`:
  ```sql
  CREATE SERVER srv_sc FOREIGN DATA WRAPPER postgres_fdw
    OPTIONS (host :'host_sc', port :'port_sc', dbname 'bd_sc', connect_timeout '3', async_capable 'true');
  ```
  ejecutados como `psql -v host_sc=laptop-sc -v port_sc=5432 -f 20_fdw.sql`.
- Nivel A (una laptop): `nodos.env` apunta a los nombres de contenedor (`nodo2_sc`, puerto 5432).
- El coordinador 2PC y el dashboard leen el mismo `nodos.env`.

### 11.5 Qué hay que configurar para que una laptop acepte conexiones de otra
1. **Puerto publicado** en el compose: `ports: ["5432:5432"]` (y `"5433:5432"` para el segundo nodo de esa laptop).
2. **PostgreSQL escuchando afuera**: la imagen oficial ya trae `listen_addresses='*'`. En instalación nativa, editar `postgresql.conf`.
3. **`pg_hba.conf`**: permitir solo la red del proyecto (no "todo internet"):
   ```
   host  all          fdw_lector  100.64.0.0/10   scram-sha-256   # red Tailscale
   host  replication  replicador  100.64.0.0/10   scram-sha-256
   host  bd_xx        replicador  100.64.0.0/10   scram-sha-256   # la suscripción también conecta a la BD
   ```
   (en Nivel B, cambiar por `192.168.1.0/24`).
4. **Firewall de Windows** (PowerShell como administrador):
   ```powershell
   New-NetFirewallRule -DisplayName "PostgreSQL SGBDD" -Direction Inbound -Protocol TCP -LocalPort 5432,5433 -Action Allow
   ```
5. **Probar** desde otra laptop antes de tocar SQL: `Test-NetConnection laptop-sc -Port 5432` → `TcpTestSucceeded : True`.

### 11.6 Orden de despliegue el día de la prueba (runbook)
1. Todas las laptops: Tailscale conectado, `git pull`, mismo `nodos.env`.
2. Cada laptop: `docker compose --profile <sus nodos> up -d` → crea tablas locales y carga sus datos.
3. L1 (LP): crear catálogo + `PUBLICATION`.
4. Laptops 2-4: crear `SUBSCRIPTION` (necesitan ver a LP).
5. L1: crear servidores fdw + tablas particionadas nacionales.
6. L3: iniciar coordinador 2PC.
7. L1: abrir dashboard → los 6 semáforos en verde.

Script `desplegar.ps1` por laptop que haga los pasos que le tocan.

### 11.7 Cómo se opera ("manejar" el sistema)
| Tarea | Comando |
|---|---|
| Ver estado de mis nodos | `docker compose ps` |
| Ver logs de un nodo | `docker logs -f nodo2_sc` |
| Entrar a SQL de un nodo | `docker exec -it nodo2_sc psql -U postgres -d bd_sc` |
| ¿Los demás nodos responden? | dashboard, o `Test-NetConnection <host> -Port <puerto>` |
| Lag de replicación del catálogo | en LP: `SELECT * FROM pg_replication_slots;` |
| Transacciones 2PC pendientes | en cada nodo: `SELECT * FROM pg_prepared_xacts;` |
| Respaldo de un nodo | `docker exec nodo2_sc pg_dump -U postgres -Fc bd_sc > respaldo_sc.dump` |
| Simular corte WAN de Beni | en L4: `tailscale down` (o apagar Wi-Fi) · volver: `tailscale up` |
| Reiniciar desde cero | `docker compose down -v` y volver a desplegar |

### 11.8 ¿VPS gratuito? — opcional, no obligatorio
Un VPS sirve para tener **el Nodo LP "en la nube" siempre encendido** (como el data center central de la empresa),
mientras los demás nodos están en laptops. No es necesario para aprobar; suma realismo.

| Proveedor | Qué da gratis | Ojo |
|---|---|---|
| **Oracle Cloud – Always Free** ⭐ | VMs ARM con varios núcleos y bastante RAM, sin vencimiento | Pide tarjeta para verificar; a veces no hay capacidad en la región |
| **Azure for Students** | Crédito para estudiantes, **sin tarjeta**, con correo institucional | Crédito limitado y con vencimiento |
| **GitHub Student Developer Pack** | Créditos en DigitalOcean y otros | Requiere validar que eres estudiante |
| Google Cloud Free Tier | Una VM e2-micro (poca RAM) | Justo para 1 nodo PostgreSQL pequeño |
| AWS Free Tier | Créditos iniciales por tiempo limitado | Fácil generar cobros por error |

(Las condiciones cambian seguido: revisarlas en la página de cada proveedor antes de registrarse.)

Reglas si usan VPS:
- Instalar **Tailscale también en el VPS** y **no abrir el puerto 5432 a internet** (los bots prueban contraseñas de PostgreSQL todo el tiempo).
- Poner alerta de gasto en 0 y apagar la VM después de la defensa.

---

## 12. Máquinas virtuales (VM) como nodos — OPCIONAL (el ingeniero aceptó Docker)

### 12.1 Qué es y por qué el ingeniero lo menciona
Una **VM** es una computadora completa simulada por software (CPU, RAM, disco, tarjeta de red y sistema operativo propios)
dentro de la laptop. **Cada VM representa el servidor físico de un departamento.**

```
 LAPTOP L2 (Windows, anfitrión)
 ┌─────────────────────────────────────────────────────────┐
 │  VirtualBox                                             │
 │  ┌───────────────────────┐   ┌───────────────────────┐  │
 │  │ VM "srv-sc"           │   │ VM "srv-tj"           │  │
 │  │ Ubuntu Server 24.04   │   │ Ubuntu Server 24.04   │  │
 │  │ PostgreSQL 16 (bd_sc) │   │ PostgreSQL 16 (bd_tj) │  │
 │  │ IP propia 192.168.1.22│   │ IP propia 192.168.1.24│  │
 │  └──────────┬────────────┘   └──────────┬────────────┘  │
 │        tarjeta de red virtual (modo Puente/Bridged)     │
 └──────────────────────┬──────────────────────────────────┘
                        │  Router / Wi-Fi / Tailscale
              Otras laptops con sus VMs (LP, CB, OR, BE)
```

| | Contenedor Docker | Máquina virtual |
|---|---|---|
| Qué simula | Solo el proceso PostgreSQL aislado | Un **servidor completo** con su sistema operativo |
| RAM por nodo | ~150-300 MB | ~1-2 GB |
| Arranque | Segundos | ~30-60 s |
| IP propia en la red | No (usa la de la laptop + puerto) | **Sí**, como un servidor real |
| Realismo para la defensa | Medio | **Alto** |
| Simular corte de red | `docker network disconnect` | **Desconectar el "cable" virtual** (un clic) |

El PDF acepta ambos ("entornos virtualizados o contenedores"). **Si el ingeniero pide VM, se usan VM.** Los scripts SQL son los mismos.

### 12.2 Software gratuito
| Herramienta | Nota |
|---|---|
| **VirtualBox 7** ⭐ | Gratis, el más usado en universidades, fácil de clonar VMs |
| Hyper-V | Ya viene en Windows 11 Pro; más rápido, interfaz menos amigable |
| VMware Workstation Pro | Gratis para uso personal |
| **Ubuntu Server 24.04 LTS** | Sistema de cada VM: sin entorno gráfico, consume poca RAM |

> Si la laptop tiene WSL2/Docker activos, VirtualBox funciona igual pero algo más lento. No mezclar: **o VM o Docker** para los nodos.

### 12.3 Modos de red de la VM (lo más importante)
| Modo | La VM se ve desde… | Uso en el proyecto |
|---|---|---|
| NAT (por defecto) | Nadie de afuera | ❌ No sirve: otras laptops no la alcanzan |
| Solo anfitrión (Host-only) | Solo la propia laptop | Para varias VMs en **una** laptop |
| Red interna | Solo VMs de la misma laptop | Igual que el anterior, sin acceso de la laptop |
| **Adaptador puente (Bridged)** ⭐ | **Toda la red física** (router) | VMs en varias laptops con router propio: cada VM recibe IP del router |
| NAT + **Tailscale dentro de la VM** ⭐ | Toda la red Tailscale | Laptops en redes distintas o Wi-Fi que bloquea; cada VM tiene su IP `100.x.y.z` |

Puente sobre Wi-Fi a veces no funciona (depende del router/tarjeta). Si falla → **Tailscale instalado en cada VM** (no en la laptop).

### 12.4 Reparto con VMs
- Igual que §11.3: **1-2 VMs por laptop** (6 VMs en una sola laptop requieren ~8-10 GB de RAM libre).
- L4 tiene **solo la VM de Beni** → para la demo: VirtualBox → Configuración → Red → desmarcar **"Cable conectado"**. Beni sigue vendiendo
  localmente y el resto del país la ve caída. Volver a marcar → la réplica del catálogo se pone al día sola.

### 12.5 Cómo construirlas sin repetir trabajo
1. Crear **una VM plantilla**: Ubuntu Server, 1,5 GB RAM, 1-2 CPU, 15 GB disco.
2. Dentro: `sudo apt install postgresql-16` (o el paquete `postgresql` de Ubuntu 24.04, que es la versión 16),
   configurar `postgresql.conf` (`listen_addresses='*'`, `wal_level=logical`, `max_prepared_transactions=100`) y `pg_hba.conf` (§11.5), habilitar SSH.
3. **Snapshot** "base limpia".
4. **Clonar** (clon enlazado, ahorra disco) → exportar `.ova` y pasarla por USB a las otras laptops.
5. En cada clon: cambiar nombre (`sudo hostnamectl set-hostname srv-sc`), crear su BD y correr sus scripts.
6. **Snapshot "listo para la defensa"** en cada VM → si algo se rompe, se restaura en segundos.

### 12.6 Operación
| Tarea | Cómo |
|---|---|
| Entrar al servidor | `ssh usuario@srv-sc` desde cualquier laptop |
| Ver estado de PostgreSQL | `sudo systemctl status postgresql` |
| Logs | `sudo tail -f /var/log/postgresql/postgresql-16-main.log` |
| Psql | `sudo -u postgres psql -d bd_sc` |
| Firewall de la VM | `sudo ufw allow from 100.64.0.0/10 to any port 5432` |
| Corte de red | Desmarcar "Cable conectado" o `sudo tailscale down` |
| Volver atrás | Restaurar snapshot |

`nodos.env` funciona igual: solo que ahora cada nodo tiene **su propia IP y siempre puerto 5432**.
