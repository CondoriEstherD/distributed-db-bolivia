# Informe de pruebas · SGBDD BoliviaDistribución S.A.

**Entorno:** modo `lab` (6 nodos PostgreSQL 16 en Docker, una laptop con Windows 11), datos limpios
(`reiniciar --si` → `levantar` → `configurar`), 03/11/2026.
**Resultado:** **14/14 pruebas pasan.** Salida completa: [`evidencias/pruebas_lab.txt`](evidencias/pruebas_lab.txt).

## Casos P0–P13

| ID | Prueba | Acción | Resultado esperado | Resultado obtenido | Evidencia |
|---|---|---|---|---|---|
| P0 | Reglas de corrección de la fragmentación | Contar ventas, departamentos e ids repetidos en `ventas_nacionales`; reconstruir FC1 ⋈ FC2 | ≥ 50 000 ventas, 9 departamentos, 0 duplicados, 0 huérfanos | 50 000 ventas en 9 departamentos, 0 duplicados; FC1 ⋈ FC2 = 3 609 clientes, 0 huérfanos (3,9 s) | [pruebas_lab.txt](evidencias/pruebas_lab.txt) |
| P1 | Autonomía local | Aislar Beni y registrar una venta en Beni y otra en Santa Cruz | Ambos nodos venden | Beni aislado vendió #6000002501; Santa Cruz vendió #2000015001 (3,1 s) | [pruebas_lab.txt](evidencias/pruebas_lab.txt) |
| P2 | Consulta global con un nodo caído | Con Beni aislado, `SELECT count(*) FROM ventas_nacionales` | Error controlado en ≤ 6 s, sin bloqueo | Error `could not connect to server "srv_be"` en 4,2 s | [pruebas_lab.txt](evidencias/pruebas_lab.txt) |
| P3 | Eliminación de fragmentos | Con Beni aislado, consultar solo SC | La consulta funciona porque no toca `fv6_be` | 15 001 ventas de SC (4,9 s) · plan en [plan_C6.txt](evidencias/plan_C6.txt) | [pruebas_lab.txt](evidencias/pruebas_lab.txt) |
| P4 | Consulta tolerante a fallos | `resumen_nacional_disponible()` con Beni aislado | Resumen parcial que marca `fv6_be` | 5 fragmentos EN LÍNEA; `fv6_be` FUERA DE LÍNEA (9,8 s) | [pruebas_lab.txt](evidencias/pruebas_lab.txt) |
| P5 | Consistencia eventual del catálogo | Con Beni aislado, subir un precio en La Paz | SC lo recibe; Beni conserva el anterior | 9.50 → 10.50: SC en 0,5 s; Beni conserva 9.50 | [pruebas_lab.txt](evidencias/pruebas_lab.txt) |
| P6 | Sincronización diferida | Cambiar el precio con Beni aislado y reconectarlo | Beni se pone al día solo | Beni recibió 11.50 a los 5,1 s de reconectarse | [pruebas_lab.txt](evidencias/pruebas_lab.txt) |
| P7 | Traspaso 2PC exitoso SC → BE | `traspasar(201, 601, producto 10, 5 u.)` | Confirmado en ambos nodos; stock nacional sin cambio | SC 960 → 955, BE 449 → 454; nacional 9 163 sin cambio; log COMMIT | [traspaso_2pc.txt](evidencias/traspaso_2pc.txt) |
| P8 | Caída del destino durante el 2PC | Aislar Beni durante la pausa posterior al PREPARE de SC | Abortar; origen intacto; nada en duda | Abortado (`connection timeout expired`); SC intacto en 955; 0 preparadas; log ABORTADO | [traspaso_2pc.txt](evidencias/traspaso_2pc.txt) |
| P9 | Caída del coordinador | Matar el coordinador en «preparado» y en «decision»; ejecutar la recuperación | ROLLBACK y COMMIT según el registro | «preparado» → ROLLBACK PREPARED en ambos; «decision» → COMMIT PREPARED en ambos | [recuperacion_2pc.txt](evidencias/recuperacion_2pc.txt) |
| P10 | Concurrencia | 20 traspasos simultáneos de 10 u. sobre 100 u. | 10 confirmados, stock ≥ 0, total conservado | 10 confirmados, 10 rechazados; stock SC final 0; nacional 9 368 conservado | [pruebas_lab.txt](evidencias/pruebas_lab.txt) |
| P11 | Seguridad | 4 accesos fuera de la matriz CRUD y 1 inicio de sesión con la contraseña de otro rol | Los 5 rechazados por el gestor | 5/5 denegados | [pruebas_lab.txt](evidencias/pruebas_lab.txt) |
| P12 | Caída del nodo central | Aislar La Paz y vender en SC, CB y BE | Los 3 venden | Ventas 2000015002, 3000010001 y 6000002502 | [pruebas_lab.txt](evidencias/pruebas_lab.txt) |
| P13 | Caída total de Beni | Apagar el servidor de Beni, vender en SC, cambiar un precio y encender Beni | Los demás venden; Beni recibe el cambio pendiente | SC vendió #2000015003; `fv6_be` FUERA DE LÍNEA; Beni recibió el precio en 0,5 s | [pruebas_lab.txt](evidencias/pruebas_lab.txt) |

> Las capturas del panel (Consultas distribuidas, Traspaso 2PC, Recuperación 2PC) se agregan en
> `docs/evidencias/` el día del ensayo general; las evidencias en texto de arriba ya contienen la misma
> información (planes `EXPLAIN` y trazas del coordinador).

## Transparencia: qué fragmentos consulta el optimizador

Planes obtenidos con `EXPLAIN (VERBOSE, COSTS OFF)` desde La Paz, como `rol_analista`:

| Consulta | Fragmentos consultados | Lectura | Evidencia |
|---|---|---|---|
| C1 · Ventas por departamento | `fv1`…`fv6` (5 remotos con `Async Foreign Scan` + local) | Cada nodo calcula su propio `GROUP BY` (*Aggregate on* en el SQL remoto); La Paz solo une 6 resúmenes pequeños, no 50 000 filas | [plan_C1.txt](evidencias/plan_C1.txt) |
| C6 · Solo Santa Cruz | únicamente `fv2_sc` | Poda de particiones: el predicado `departamento_id = 'SC'` descarta los otros 5 fragmentos | [plan_C6.txt](evidencias/plan_C6.txt) |
| C2 · Ventas de Tarija con su cliente | `fv4_tj` para las ventas | Solo se lee el fragmento de ventas del nodo 4; los clientes se buscan en FC1 | [plan_C2.txt](evidencias/plan_C2.txt) |

## Por qué el 2PC garantiza atomicidad

- **P7 · Traspaso exitoso.** En la fase 1 cada participante ejecuta su cambio y `PREPARE TRANSACTION`:
  el cambio queda escrito en disco pero sin confirmar, y el nodo promete poder confirmarlo. Solo cuando
  los dos votan SÍ, el coordinador escribe COMMIT en `traspasos_log` (Cochabamba), y ese es el punto
  irrevocable. Después envía `COMMIT PREPARED` a ambos. El stock nacional no cambia: las unidades salen de
  SC y entran en BE en la misma transacción lógica.
- **P8 · Caída del destino.** SC ya había votado SÍ, pero Beni no responde, así que falta un voto y el
  coordinador decide ABORTAR y envía `ROLLBACK PREPARED` a SC. Ningún nodo queda con medio traspaso:
  la mercancía no se pierde ni se duplica.
- **P9 · Caída del coordinador.** Los participantes preparados no pueden decidir solos: quedan «en duda»
  y conservan sus bloqueos. La recuperación lee `traspasos_log`: si la decisión registrada es COMMIT,
  confirma en todos; si no hay COMMIT (estado INICIADO o PREPARADO), aplica **presunción de aborto** y
  deshace en todos. Así ambos nodos terminan siempre en el mismo estado.
- **P10 · Concurrencia.** El descuento es `UPDATE inventario SET stock_actual = stock_actual - n
  WHERE … AND stock_actual >= n`. La comprobación y la resta son **una sola sentencia atómica**: el
  segundo traspaso espera el bloqueo de fila del primero y, al obtenerlo, vuelve a evaluar el `WHERE`
  con el stock ya descontado. Si no alcanza, actualiza 0 filas y el participante vota NO. No hay ventana
  entre «leer» y «escribir» en la que otro traspaso pueda colarse, así que el stock nunca baja de 0.
  Además, los participantes se bloquean siempre en orden de id de almacén, lo que evita interbloqueos
  entre traspasos cruzados SC → BE y BE → SC.

## Fallas en red real

> Pendiente de la tarea 6B: se completa con los 7 equipos conectados por Tailscale (casos P1–P6, P8,
> P12 y P13 con `tailscale down` y `python gestion.py apagar be` en E6). Por cada caso: acción, tiempo,
> resultado y captura.

| ID | Acción en red real | Tiempo | Resultado | Evidencia |
|---|---|---|---|---|
| P1 | | | | |
| P2 | | | | |
| P3 | | | | |
| P4 | | | | |
| P5 | | | | |
| P6 | | | | |
| P8 | | | | |
| P12 | | | | |
| P13 | | | | |

## Latencia del enlace de Beni

La sección 7.4 de la especificación pide simular un enlace lento. Para eso, `tc netem` aplica un retardo a
la interfaz del contenedor `nodo6_be`, con una variación de ± 20 % y 1 % de pérdida de paquetes.

**Medición:** `python -m pruebas.medir_latencia`, en modo lab, el 03/11/2026. La latencia se controla
con `python gestion.py latencia be <ms>` o desde el panel, en **Simulación de fallas**.

| Latencia de Beni | C1 (consulta nacional) | Traspaso 2PC SC → BE | Catálogo LP → BE |
|---|---|---|---|
| 0 ms | 0,18 s | 0,27 s | 0,6 s |
| 300 ms | 4,68 s | 3,32 s | 0,5 s |
| 800 ms | cancelada a los 8,1 s (`statement_timeout`) | abortado a los 3,4 s (`connect_timeout`) | 0,5 s |

**Lectura de los resultados:**

- **C1 y el traspaso crecen mucho más que la latencia.** Abrir una conexión remota cuesta varios viajes
  de ida y vuelta: TCP, autenticación SCRAM y los parámetros de sesión de `postgres_fdw`. Después se
  suman el cursor, la lectura y el cierre. Con 300 ms, unos 15 viajes explican los 4,7 s de C1. El 2PC
  abre dos conexiones y hace PREPARE y COMMIT en cada una.
- **Con 800 ms, el sistema corta en lugar de bloquearse.** Es el comportamiento diseñado:
  - La consulta nacional se cancela por el `statement_timeout` de 8 s.
  - El traspaso aborta antes del PREPARE porque Beni no completa la conexión en 3 s
    (`connect_timeout`). El origen queda intacto, `traspasos_log` registra ABORTADO y no queda ninguna
    transacción en duda.
  - Las consultas que no necesitan a Beni no se ven afectadas, porque el optimizador descarta su
    fragmento.
- **El catálogo no cambia.** `netem` retrasa solo los paquetes que *salen* de Beni. La replicación
  lógica *entra* a Beni (La Paz envía los cambios), así que solo se retrasan las confirmaciones de Beni,
  que no frenan la aplicación de los cambios. Los 0,5 s corresponden al intervalo de sondeo de la
  medición.

**Si se quiere tolerar enlaces de más de 500 ms**, hay que subir `connect_timeout` (en `sgbdd/config.py`
y en los servidores remotos de `10_transparencia_fdw.sql`) y `statement_timeout`. El costo es detectar
más tarde un nodo caído (P2 hoy lo detecta en 4,2 s).
