# Hoja de despliegue en red · 7 equipos

**Fecha del montaje:** ____ / ____ / 2026  **Hora de inicio:** ______  **Hora de fin:** ______
**Responsable:** Integrante 2 (infraestructura · Nodo 2 Santa Cruz)

> **¿Dónde se despliega?** No se usa un VPS ni un servicio en la nube. Cada nodo corre en Docker en la
> **laptop de un integrante**, y las 7 laptops se unen con **Tailscale**, que hace de red privada de la
> empresa (la WAN entre departamentos). Así cada laptop es una sucursal real, el despliegue es gratis y
> los datos nunca quedan expuestos a Internet (sección 12.1 de la especificación).

---

## 1. Asignación de equipos

Completar antes de empezar. **No escribir contraseñas en esta hoja.**

| Equipo | Nodo que aloja | `NODOS_LOCALES` | Puerto | Integrante | IP de Tailscale (`tailscale ip -4`) |
|---|---|---|---|---|---|
| E1 | Nodo 1 · La Paz (central) | `lp` | 15431 | | 100.___.___.___ |
| E2 | Nodo 2 · Santa Cruz | `sc` | 15432 | | 100.___.___.___ |
| E3 | Nodo 3 · Cochabamba (registro 2PC) | `cb` | 15433 | | 100.___.___.___ |
| E4 | Nodo 4 · Tarija y Chuquisaca | `tj` | 15434 | | 100.___.___.___ |
| E5 | Nodo 5 · Oruro y Potosí | `or` | 15435 | | 100.___.___.___ |
| E6 | Nodo 6 · Beni y Pando | `be` | 15436 | | 100.___.___.___ |
| E7 | Consola: panel, coordinador 2PC y pruebas | *(vacío)* | — | | 100.___.___.___ |

## 2. Preparación (en cada equipo)

| Paso | E1 | E2 | E3 | E4 | E5 | E6 | E7 |
|---|---|---|---|---|---|---|---|
| Docker Desktop abierto (`docker run hello-world`) · *E7 no lo necesita* | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | — |
| Python 3.12+ y `pip install -r requirements.txt` | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| Repositorio actualizado (`git pull origin main`) | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| Tailscale con la cuenta del grupo (`tailscale status` muestra los 7) | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| Suspensión desactivada (Configuración → Sistema → Energía → «Nunca») | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | — |
| Puerto propio abierto en el firewall (ver abajo) | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | — |
| `.env` copiado y con su `NODOS_LOCALES` | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |

**Firewall**, en PowerShell como administrador (cambiar el puerto según el equipo):

```powershell
New-NetFirewallRule -DisplayName "SGBDD nodo" -Direction Inbound -Protocol TCP -LocalPort 15432 -Action Allow
```

**`.env` común.** Debe ser idéntico en los 7 equipos. Solo cambia `NODOS_LOCALES`. Las contraseñas se
copian del `.env` que comparte el grupo por un medio privado.

```ini
MODO=red
NODOS_LOCALES=sc          # E1=lp · E2=sc · E3=cb · E4=tj · E5=or · E6=be · E7 vacío
BIND_IP=0.0.0.0
HOST_LP=100.x.x.x         # IP de E1 (tabla de la sección 1)
HOST_SC=100.x.x.x         # IP de E2
HOST_CB=100.x.x.x         # IP de E3
HOST_TJ=100.x.x.x         # IP de E4
HOST_OR=100.x.x.x         # IP de E5
HOST_BE=100.x.x.x         # IP de E6
# PORT_LP … PORT_BE se mantienen en 15431 … 15436
# PG_PASSWORD y las PASS_* iguales en los 7 equipos
```

## 3. Montaje, en este orden

| # | Dónde | Comando | Resultado esperado | Hecho |
|---|---|---|---|---|
| 1 | E1 a E6 | `python gestion.py levantar` | `✔ nodoN_xx listo` | ☐ |
| 2 | **Los 7** | `python gestion.py verificar` | «Conectividad completa» en cada equipo. No continuar si aparece un ✖ | ☐ |
| 3 | E2 a E6 | `python gestion.py configurar` | `suscrito al catálogo de La Paz` | ☐ |
| 4 | **E1, al final** | `python gestion.py configurar` | Esquema `nacional` creado y FC2 cargado | ☐ |
| 5 | E7 | `python gestion.py estado` | 6 nodos en línea y 5 réplicas activas | ☐ |
| 6 | E7 | `python -m pruebas.ejecutar_pruebas` | P0, P7, P9, P10 y P11 pasan | ☐ |
| 7 | E7 | `streamlit run dashboard/app.py` | El panel muestra los 6 nodos en línea | ☐ |

**Salida de `verificar` en E7** (pegar):

```

```

**Salida de `estado` en E7** (pegar):

```

```

**Salida de las pruebas en E7** (pegar):

```

```

## 4. Problemas encontrados

| Síntoma | Causa | Solución | Equipo |
|---|---|---|---|
| | | | |
| | | | |

Causas frecuentes de un ✖ en `verificar`:
- una IP o un puerto mal escrito en `.env`;
- el firewall bloquea el puerto;
- el nodo no está levantado;
- la laptop se suspendió;
- Tailscale está desconectado.

## 5. Cambiar un nodo de equipo

**Sí se puede.** Ningún nodo está atado a una laptop: el `.env` decide qué nodo corre en cada equipo.
Sirve, por ejemplo, si una laptop falla o si un integrante quiere alojar otro nodo. Ejemplo: Beni pasa
de E6 a otro equipo (EX).

| # | Dónde | Acción | Hecho |
|---|---|---|---|
| 1 | E6 (equipo anterior) | `python gestion.py respaldar be` y copiar el `.dump` de `respaldos/` a EX | ☐ |
| 2 | EX | Agregar `be` a su `NODOS_LOCALES` (p. ej. `NODOS_LOCALES=tj,be`) y abrir el puerto 15436 en su firewall | ☐ |
| 3 | **Los 7** | Cambiar `HOST_BE` por la IP de Tailscale de EX | ☐ |
| 4 | EX | `python gestion.py levantar` y `python gestion.py restaurar be respaldos/<archivo>.dump --si` | ☐ |
| 5 | EX y luego E1 | `python gestion.py configurar`, primero en EX y **al final en E1** | ☐ |
| 6 | E6 | `docker compose stop nodo6_be` (apagar la copia anterior) | ☐ |
| 7 | E1 | `python gestion.py sql lp "UPDATE productos_catalogo SET precio_unitario = precio_unitario"` (reenvía el catálogo al día) | ☐ |
| 8 | E7 | `python gestion.py estado`: Beni en línea con la nueva IP | ☐ |

Notas:
- **Un equipo puede alojar más de un nodo**, siempre que tenga RAM libre: unos 2 GB por nodo.
- **Si solo se cambia de persona** y no de laptop, no hay que hacer nada técnico: basta con actualizar
  la tabla de la sección 1.
- **Si falla la red completa**, el plan B es el modo `lab`: los 6 nodos en una sola laptop
  (`MODO=lab`, `NODOS_LOCALES=lp,sc,cb,tj,or,be`).

## 6. Cierre

- Tiempo total del montaje: ______ minutos.
- ☐ Desde E7 pasan P0, P7, P9, P10 y P11, y el panel muestra los 6 nodos en línea (criterio de la tarea 2).
- ☐ Copiar las salidas y los problemas de esta hoja al informe (`docs/INFORME_PRUEBAS.md`).
