# Informe de pruebas · SGBDD BoliviaDistribución S.A.

> Las secciones de la tabla de casos P0–P13 y de fallas en red real se completan en las tareas 3 y 6B.

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
más tarde un nodo caído (P2 hoy lo detecta en 4,1 s).
