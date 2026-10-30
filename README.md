<div align="center">

# SGBDD · BoliviaDistribución S.A.

**Sistema de Base de Datos Distribuida para la gestión logística nacional**

Seis nodos PostgreSQL 16 (un contenedor por nodo) con fragmentación horizontal, derivada y vertical,
replicación lógica, transparencia de distribución y transacciones distribuidas con compromiso en dos fases.

![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white)
![Python](https://img.shields.io/badge/Python-3.12+-3776AB?logo=python&logoColor=white)
![Streamlit](https://img.shields.io/badge/Streamlit-panel-FF4B4B?logo=streamlit&logoColor=white)
![Tailscale](https://img.shields.io/badge/Tailscale-red%20privada-242424?logo=tailscale&logoColor=white)
![Pruebas](https://img.shields.io/badge/pruebas-13%2F13-success)

</div>

---

## Contenido

1. [Descripción](#1-descripción)
2. [Arquitectura](#2-arquitectura)
3. [Diseño de distribución](#3-diseño-de-distribución)
4. [Tecnologías](#4-tecnologías)
5. [Inicio rápido](#5-inicio-rápido)
6. [Demostración](#6-demostración)
7. [Pruebas](#7-pruebas)
8. [Operación](#8-operación)
9. [Despliegue en varios equipos](#9-despliegue-en-varios-equipos)
10. [Estructura del repositorio](#10-estructura-del-repositorio)
11. [Solución de problemas](#11-solución-de-problemas)
12. [Documentación y equipo](#12-documentación-y-equipo)

---

## 1. Descripción

BoliviaDistribución S.A. opera sucursales en los nueve departamentos del país. Cada sucursal debe
**vender aunque pierda la conexión con la oficina central**, mientras que la gerencia en La Paz necesita
**consultas nacionales como si existiera una sola base de datos**.

El sistema resuelve ese requisito con un diseño distribuido descendente (Özsu y Valduriez, 2020):

- Cada nodo guarda solo los datos de sus departamentos (**autonomía local**).
- La Paz ve todos los fragmentos mediante un esquema global (**transparencia**).
- El catálogo se replica de forma asíncrona (**disponibilidad**).
- Los traspasos de inventario entre nodos usan 2PC (**consistencia**).

## 2. Arquitectura

```mermaid
flowchart TB
    subgraph LP["Nodo 1 · La Paz (central) :15431"]
        direction TB
        N["Esquema «nacional»<br/>tablas particionadas + postgres_fdw"]
        FC2[("FC2 clientes_financiero")]
        PUB[["pub_catalogo"]]
    end

    SC["Nodo 2 · Santa Cruz<br/>:15432"]
    CB["Nodo 3 · Cochabamba<br/>:15433<br/>traspasos_log (2PC)"]
    TJ["Nodo 4 · Tarija + Chuquisaca<br/>:15434"]
    OR["Nodo 5 · Oruro + Potosí<br/>:15435"]
    BE["Nodo 6 · Beni + Pando<br/>:15436"]

    PUB -. "replicación lógica<br/>(catálogo)" .-> SC & CB & TJ & OR & BE
    N -- "consultas remotas<br/>(postgres_fdw)" --> SC & CB & TJ & OR & BE

    COORD{{"Coordinador 2PC<br/>(Python · psycopg 3)"}}
    COORD -- "PREPARE / COMMIT PREPARED" --> SC & BE
    COORD -- "registro de decisiones" --> CB

    UI["Panel Streamlit"] --> N
    UI --> COORD
```

| Nodo | Contenedor | Departamentos | Puerto | Ventas de prueba |
|---|---|---|---|---:|
| 1 · Central | `nodo1_lp` | La Paz | 15431 | 12 500 |
| 2 | `nodo2_sc` | Santa Cruz | 15432 | 15 000 |
| 3 | `nodo3_cb` | Cochabamba | 15433 | 10 000 |
| 4 | `nodo4_tj` | Tarija, Chuquisaca | 15434 | 5 000 |
| 5 | `nodo5_or` | Oruro, Potosí | 15435 | 5 000 |
| 6 | `nodo6_be` | Beni, Pando | 15436 | 2 500 |
| | | | **Total** | **50 000** |

## 3. Diseño de distribución

| Técnica | Relación | Implementación |
|---|---|---|
| Fragmentación horizontal primaria | `ventas`, `almacenes` | Predicado `departamento_id IN (…)` por nodo, garantizado con `CHECK` |
| Fragmentación horizontal derivada | `detalle_venta ⋉ ventas`, `inventario ⋉ almacenes` | Cada detalle vive en el nodo de su venta o almacén |
| Fragmentación vertical | `clientes` | FC1 `clientes_datos_generales` (nodos 1–6) · FC2 `clientes_financiero` (solo La Paz) |
| Replicación total | `productos_catalogo` | Publicación en La Paz, suscripción en nodos 2–6 |
| Identificadores globales | todas | Rango por nodo: `nodo × 10⁹ + n` (ventas, clientes) y `nodo × 100 + k` (almacenes) |
| Transparencia | esquema `nacional` | `PARTITION BY LIST` con particiones remotas: poda de fragmentos y agregación en cada nodo |
| Transacciones distribuidas | `inventario` | 2PC con registro en Cochabamba, orden fijo de bloqueos y recuperación por presunción de aborto |
| Seguridad | todas | Matriz CRUD con `GRANT/REVOKE`, mínimo privilegio, SCRAM, solo redes privadas |

Las reglas de corrección de la fragmentación (completitud, reconstrucción y disyunción) se verifican
automáticamente en la prueba P0.

## 4. Tecnologías

| Capa | Herramienta | Uso |
|---|---|---|
| Motor | PostgreSQL 16 | `postgres_fdw`, replicación lógica, `PREPARE TRANSACTION`, particionamiento |
| Infraestructura | Docker Compose | Un contenedor por nodo, red `sgbdd_wan` |
| Red entre equipos | Tailscale (gratuito) | Red privada cifrada sin exponer puertos a Internet |
| Coordinación | Python 3.12 + psycopg 3 | Coordinador 2PC, recuperación, consola de operación |
| Interfaz | Streamlit | Panel de demostración: cada acción muestra su SQL |
| Administración (opcional) | pgAdmin 4 | Exploración visual de los nodos |

## 5. Inicio rápido

**Requisitos:** Docker Desktop (en Windows, con WSL2) y Python 3.12 o superior.

```powershell
git clone https://github.com/CondoriEstherD/distributed-db-bolivia.git
cd distributed-db-bolivia

python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt

python gestion.py levantar      # crea .env, levanta los 6 nodos y carga los datos (1-3 min la primera vez)
python gestion.py configurar    # suscripciones al catálogo + esquema «nacional» en La Paz
python gestion.py estado        # salud, volumen y replicación de cada nodo
```

> [!IMPORTANT]
> Cambie `PG_PASSWORD` y `APP_PASSWORD` en `.env` antes de cualquier despliegue en red.
> El archivo `.env` está excluido del repositorio.

## 6. Demostración

```powershell
streamlit run dashboard/app.py   # http://localhost:8501
```

| Pestaña | Qué demuestra |
|---|---|
| Nodos | Estado, volumen de datos y replicación de cada nodo |
| Consultas nacionales | Consultas C1–C8 sobre los 6 nodos, con plan `EXPLAIN` (fragmentos consultados y SQL remoto) |
| Venta local | Transacción 100 % local; funciona con el nodo aislado |
| Traspaso 2PC | Fases de preparación y confirmación paso a paso, con el stock antes y después |
| Catálogo | Cambio de precio en La Paz y su propagación a cada nodo |
| Fallas | Aislar o reconectar nodos y resolver transacciones en duda |

## 7. Pruebas

```powershell
python -m pruebas.ejecutar_pruebas          # todos los casos
python -m pruebas.ejecutar_pruebas P7 P10   # casos concretos
```

| Caso | Escenario | Resultado medido |
|---|---|---|
| P0 | Reglas de corrección de la fragmentación | 50 000 ventas en 9 departamentos, sin duplicados |
| P1 | Autonomía local con Beni aislado | Beni sigue registrando ventas |
| P2 | Consulta global con un nodo caído | Error controlado en 4,1 s |
| P3 | Eliminación de fragmentos con un nodo caído | Las consultas que no lo requieren siguen funcionando |
| P4 | Consulta tolerante a fallos | Resumen parcial que indica el fragmento caído |
| P5 | Consistencia eventual del catálogo | Propagación en 0,2 s |
| P6 | Sincronización diferida al reconectar | Beni se pone al día 2,9 s después de reconectarse |
| P7 | Traspaso 2PC exitoso SC → BE | Confirmado en ambos nodos |
| P8 | Caída del destino durante el 2PC | Rollback: el origen queda intacto |
| P9 | Caída del coordinador | La recuperación confirma o deshace según el registro |
| P10 | 20 traspasos simultáneos sobre 100 unidades | 10 confirmados, stock nunca negativo, total nacional conservado |
| P11 | Seguridad: matriz CRUD | 4/4 operaciones prohibidas rechazadas por el gestor |
| P12 | Caída del nodo central | Los demás nodos siguen vendiendo |

## 8. Operación

| Tarea | Comando |
|---|---|
| Estado de los nodos | `python gestion.py estado` |
| Cortar el enlace WAN de un nodo (sigue operando local) | `python gestion.py aislar be` |
| Restablecer el enlace | `python gestion.py reconectar be` |
| Venta en la consola local de un nodo | `python gestion.py vender be` |
| SQL en un nodo | `python gestion.py sql lp "SELECT * FROM nacional.resumen_nacional_disponible()"` |
| Traspaso 2PC | `python -m sgbdd.coordinador_2pc --origen 201 --destino 601 --producto 15 --cantidad 50` |
| Traspaso con pausa (para cortar un enlace a mitad) | añadir `--pausa 10` |
| Resolver transacciones en duda | `python gestion.py recuperar` |
| pgAdmin (http://localhost:5050) | `python gestion.py levantar --admin` |
| Borrar todo y empezar de cero | `python gestion.py reiniciar --si` |

Identificadores útiles: almacenes `101-102` LP, `201-202` SC, `301-302` CB, `401-404` TJ/CH,
`501-504` OR/PO, `601-604` BE/PA. Productos: 1 a 200. Los ids de ventas y clientes empiezan con el número
del nodo que los creó (`6000002501` → Beni).

## 9. Despliegue en varios equipos

Los mismos scripts funcionan en una laptop (modo `lab`) o en cuatro (modo `red`); solo cambia `.env`.

```mermaid
flowchart LR
    L1["L1<br/>La Paz"] --- T(("Tailscale<br/>100.64.0.0/10"))
    L2["L2<br/>Santa Cruz + Tarija"] --- T
    L3["L3<br/>Cochabamba + Oruro<br/>+ coordinador 2PC"] --- T
    L4["L4<br/>Beni"] --- T
```

1. Instalar Tailscale en los 4 equipos con la misma cuenta y anotar cada IP (`tailscale ip -4`).
2. Clonar el repositorio y crear `.env` con **las mismas contraseñas y direcciones** en todos; solo cambia
   `NODOS_LOCALES`. Ejemplo para L2:
   ```ini
   MODO=red
   NODOS_LOCALES=sc,tj
   BIND_IP=0.0.0.0
   HOST_LP=100.64.0.1
   HOST_SC=100.64.0.2
   HOST_TJ=100.64.0.2
   HOST_CB=100.64.0.3
   HOST_OR=100.64.0.3
   HOST_BE=100.64.0.4
   # los puertos PORT_* se mantienen: 15431 … 15436
   ```
3. Abrir los puertos en el firewall de Windows (PowerShell como administrador):
   ```powershell
   New-NetFirewallRule -DisplayName "SGBDD PostgreSQL" -Direction Inbound -Protocol TCP -LocalPort 15431-15436 -Action Allow
   ```
4. Verificar la conectividad desde otro equipo: `Test-NetConnection 100.64.0.2 -Port 15432`.
5. En cada equipo, `python gestion.py levantar`. Con todos arriba, `python gestion.py configurar` en cada
   equipo, dejando L1 para el final (carga FC2 leyendo los 6 nodos).
6. Para cortar el enlace durante la demostración: `tailscale down` en el equipo del nodo (`tailscale up` para volver).

## 10. Estructura del repositorio

```
├── docker-compose.yml          6 nodos PostgreSQL 16 (+ pgAdmin opcional)
├── .env.example                credenciales y topología (copiar a .env)
├── docker/
│   ├── initdb/                 script de inicialización de cada nodo
│   └── pg_hba.conf             acceso solo desde redes privadas, SCRAM
├── sql/
│   ├── comun/                  01 roles · 02 esquema y fragmentos · 03 catálogo · 04 datos · 05 funciones · 06 permisos
│   ├── nodo1_lp/init/          FC2, roles centrales, publicación del catálogo
│   ├── nodo1_lp/post/          servidores remotos, esquema «nacional», vistas globales, datos FC2
│   ├── nodo3_cb/init/          registro de decisiones del coordinador 2PC
│   ├── replicas/post/          suscripción de los nodos 2-6
│   └── consultas/              consultas distribuidas de referencia C1-C8
├── sgbdd/
│   ├── config.py               topología (lee .env) y conexión a los nodos
│   ├── coordinador_2pc.py      protocolo de compromiso en dos fases
│   ├── recuperacion_2pc.py     resolución de transacciones en duda
│   └── operacion.py            despliegue, configuración, estado, simulación de fallas
├── gestion.py                  consola de operación
├── dashboard/app.py            panel de demostración (Streamlit)
├── pruebas/ejecutar_pruebas.py casos de prueba P0-P12
└── docs/                       especificación técnica y plan de implementación
```

## 11. Solución de problemas

| Síntoma | Causa y solución |
|---|---|
| `ports are not available` al levantar | Otro programa usa el puerto: cambie `PORT_*` en `.env`. |
| Un nodo no llega a «listo» | `docker logs nodo2_sc` muestra el script SQL que falló. |
| Cambié un script de `sql/comun` y no se aplica | Solo corren con el volumen vacío: `python gestion.py reiniciar --si`. |
| `configurar` avisa «FC2 no cargado» | Algún nodo estaba caído; repita `configurar` con todos en línea. |
| Conexiones lentas en Windows | Use `127.0.0.1` en lugar de `localhost` en `HOST_*` (evita el intento por IPv6). |
| Quedan filas bloqueadas tras un fallo del coordinador | `python gestion.py recuperar` (o `--edad-minima 0`). |

## 12. Documentación y equipo

- [Especificación técnica (APA 7)](docs/Especificacion_Tecnica_SGBDD_BoliviaDistribucion.docx)
- [Plan de implementación](docs/PLAN_IMPLEMENTACION.md)

**Asignatura:** Base de Datos II · Semestre 2-2026 · [Nombre de la universidad]
**Docente:** Ing. [Nombre del docente]

| Integrante | Responsabilidad |
|---|---|
| [Integrante 1] | Nodo central, transparencia y consultas globales |
| [Integrante 2] | Fragmentación y datos de los nodos regionales |
| [Integrante 3] | Coordinador 2PC y recuperación |
| [Integrante 4] | Seguridad, pruebas y panel de demostración |

### Referencias

Özsu, M. T., y Valduriez, P. (2020). *Principles of distributed database systems* (4.ª ed.). Springer.

PostgreSQL Global Development Group. (2024). *PostgreSQL 16 documentation*. https://www.postgresql.org/docs/16/

---

<div align="center"><sub>Proyecto académico · Bases de Datos Distribuidas · 2026</sub></div>
