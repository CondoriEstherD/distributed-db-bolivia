# Tareas del equipo · siguiente etapa

**Estado de partida (30/10/2026):**
- Los 6 nodos funcionan en modo localhost.
- Pasan las 14 pruebas, de P0 a P13.
- El panel tiene 7 páginas y simula dos tipos de falla: cortar el enlace de red y apagar el servidor.

**Lo que falta:**
1. Validar el sistema en red real.
2. Cumplir lo que el documento oficial promete y aún no existe: la latencia simulada, el informe de pruebas y el video.
3. Cerrar dos atajos técnicos: la contraseña compartida y la falta de respaldos.
4. Automatizar las pruebas.

Cada integrante tiene una tarea ligada al nodo que administra en la defensa (roles de la sección 5.2 de la especificación).

---

## Reglas para todos

1. **Solo la rama `main`:** no se crean otras ramas ni *Pull Requests*. Antes de empezar, `git pull origin main`; al terminar, un *commit* por tarea con un mensaje que empiece con `Tarea N:` y `git push origin main`.
2. **`.env` nunca se sube.** Las contraseñas se comparten por un medio privado.
3. **Cambios en `sql/`:** solo se aplican con los volúmenes vacíos. Después de cambiar cualquier archivo de esa carpeta, ejecutar:
   ```powershell
   python gestion.py reiniciar --si
   python gestion.py levantar
   python gestion.py configurar
   ```
4. **Condición para hacer push:** en localhost, `python -m pruebas.ejecutar_pruebas` da **14/14** y el panel abre sin errores (`streamlit run dashboard/app.py`).
5. **Archivos compartidos entre tareas:** las tareas 4, 5 y 6 modifican `gestion.py` o `sgbdd/operacion.py`. Antes del push, ejecutar `git pull origin main`, resolver los conflictos si los hay y volver a ejecutar las pruebas.
6. **Comentarios y mensajes** en español, con el mismo estilo del código existente.

---

## Tarea 1 · Documento oficial, guion y video
**Responsable:** Integrante 1 (arquitecto de datos · Nodo 1 La Paz)
**Archivos:** `docs/Especificacion_Tecnica_SGBDD_BoliviaDistribucion.docx`

1. **Completar los datos pendientes:** universidad, facultad, carrera, docente, ciudad y los 7 nombres (portada y tabla de roles). Comprobar con **Ctrl+B** buscando `[` que no quede ningún texto entre corchetes.
2. **Actualizar el plan de pruebas (sección 15):**
   - Agregar la fila **P13 · Caída total del nodo**. Acción: apagar el servidor de Beni. Resultado esperado: los demás nodos venden y, al encenderlo, Beni recibe los cambios pendientes del catálogo.
   - En los criterios de aceptación, cambiar "doce casos" por "catorce casos (P0 a P13)".
3. **Describir el panel:** agregar a la sección 12 un párrafo y una tabla con las 7 páginas del panel (copiar la tabla de la sección 6 del README).
4. **Sección de resultados:** cuando la tarea 3 entregue el informe, agregar la sección "Resultados obtenidos" con los tiempos reales. Subir el historial de versiones a **1.2**.
5. **Índice:** clic derecho en el índice → **Actualizar campos** → **Actualizar toda la tabla**.
6. **Guion de la defensa:** escribir `docs/GUION_DEFENSA.md` con una tabla de 4 columnas: minuto, integrante, qué hace en pantalla y qué explica. Cada integrante presenta su nodo y su tarea. Duración total: 15 minutos o menos.
7. **Video de respaldo:** grabar con OBS Studio la demostración completa en localhost, siguiendo el guion. Subirlo a Drive (no a GitHub) y poner el enlace en la sección 12 del README.

**Terminado cuando:** el documento no tiene ningún texto entre corchetes, el índice está actualizado, el guion está aprobado por los 7 y el video se reproduce desde el enlace.

---

## Tarea 2 · Despliegue real en 7 equipos
**Responsable:** Integrante 2 (infraestructura · Nodo 2 Santa Cruz)
**Archivos:** `docs/DESPLIEGUE_RED.md` (nuevo)

1. **Tailscale:** instalarlo en los 7 equipos con **una sola cuenta del grupo**. Anotar la IP de cada uno con `tailscale ip -4`.
2. **`.env` común:** prepararlo siguiendo la sección 9 del README. Debe ser idéntico en los 7 equipos salvo `NODOS_LOCALES` (vacío en E7). Si la tarea 5 ya está integrada, incluir las contraseñas por rol.
3. **Firewall:** en cada equipo de nodo, abrir **solo su puerto** (E1 → 15431 … E6 → 15436).
4. **Suspensión:** desactivarla en los equipos de nodo. En Windows, Configuración → Sistema → Energía → "Nunca".
5. **Verificar la conectividad antes de configurar:** ejecutar `python gestion.py verificar` en los 7 equipos, después de `levantar` en E1–E6. El comando inicia sesión en los 6 nodos y, en los equipos de nodo, comprueba que el **contenedor** llega a los otros 5 (la ruta de `postgres_fdw` y de la replicación). Ensayado el 03/11/2026 en una sola laptop con `MODO=red` y los nodos por IP: 36/36 conexiones, `configurar`, P0, P7, P9, P10, P11 y P13 pasan.
6. **Levantar y configurar en orden:**
   1. `python gestion.py levantar` en E1–E6.
   2. `python gestion.py configurar` en E2–E6.
   3. `python gestion.py configurar` en **E1, al final**.
7. **Verificar desde E7:**
   - `python gestion.py estado` (deben aparecer 6 nodos en línea y 5 réplicas activas).
   - `python -m pruebas.ejecutar_pruebas`.
   - `streamlit run dashboard/app.py`.
8. **Documentar** en `docs/DESPLIEGUE_RED.md`:
   - la tabla equipo / IP / nodo / integrante, **sin contraseñas**;
   - la salida de los pasos 5 y 7;
   - los problemas encontrados y su solución;
   - el tiempo total del montaje.

**Terminado cuando:** desde E7 pasan P0, P7, P9, P10 y P11, y el panel muestra los 6 nodos en línea.
**Si falla `pg_isready` desde el contenedor**, avisen al grupo enseguida: es el único punto de la red que no se pudo verificar en una sola laptop.

---

## Tarea 3 · Informe de pruebas con evidencias
**Responsable:** Integrante 3 (transacciones · Nodo 3 Cochabamba)
**Archivos:** `docs/INFORME_PRUEBAS.md` y `docs/evidencias/` (nuevos)

1. **Partir de datos limpios** (regla 3) para que P0 muestre exactamente 50 000 ventas.
2. **Guardar la salida completa de las pruebas:**
   ```powershell
   python -m pruebas.ejecutar_pruebas > docs/evidencias/pruebas_lab.txt
   ```
3. **Capturar las consultas:** en el panel, página **Consultas distribuidas**, activar "Mostrar plan de ejecución" y capturar:
   - **C1**, cuyo plan muestra la agregación calculada en cada nodo;
   - **C6**, que consulta solo `fv2_sc`;
   - **C2**, que consulta solo `fv4_tj` para las ventas.
4. **Capturar el 2PC:**
   - En **Traspaso 2PC**, un traspaso exitoso con las fases visibles.
   - El mismo traspaso con pausa de 10 s, aislando Beni durante la pausa (debe abortar).
   - En **Recuperación 2PC**, las dos caídas del coordinador y su resolución.
5. **Explicar el 2PC:** para P7, P8, P9 y P10, escribir 3–4 líneas sobre qué hace el protocolo y por qué el resultado demuestra atomicidad. Para P10, explicar por qué el `UPDATE … WHERE stock_actual >= cantidad` evita las condiciones de carrera.
6. **Armar el informe:** una tabla con las columnas ID, prueba, acción, resultado esperado, resultado obtenido y evidencia, donde la evidencia enlaza la imagen en `docs/evidencias/`. Incluir además la sección de fallas en red que entrega la tarea 6.

**Terminado cuando:** las 14 pruebas tienen su fila completa con evidencia, y los tiempos del informe coinciden con `pruebas_lab.txt`.

---

## Tarea 4 · Respaldo, restauración y traslado de un nodo
**Responsable:** Integrante 4 (datos · Nodo 4 Tarija)
**Archivos:** `sgbdd/operacion.py`, `gestion.py`, `.gitignore`, `README.md`

1. **Función `respaldar(nodo)` en `operacion.py`:**
   - Ejecuta dentro del contenedor `pg_dump -U postgres -Fc -f /tmp/r.dump <bd>`.
   - Copia el archivo con `docker cp` a `respaldos/<cod>_<AAAAMMDD-HHMM>.dump`.
   - Devuelve la ruta del archivo.
2. **Función `restaurar(nodo, archivo)`:** copia el archivo al contenedor con `docker cp` y ejecuta `pg_restore -U postgres --clean --if-exists -d <bd> /tmp/r.dump`.
3. **Comandos en `gestion.py`:** `respaldar <nodo>` y `restaurar <nodo> <archivo>`. `restaurar` debe pedir `--si`, igual que `reiniciar`.
4. **`.gitignore`:** agregar `respaldos/`.
5. **Simulacro en localhost:**
   1. Respaldar `be`.
   2. Registrar 3 ventas con `python gestion.py vender be`.
   3. Restaurar `be`. Las 3 ventas deben desaparecer.
   4. Revisar `python gestion.py estado`. Si la suscripción de Beni queda detenida, ejecutar `configurar` y documentarlo.
   5. Ejecutar las 14 pruebas.
6. **Traslado en red** (requiere la tarea 2):
   1. Mover Beni a otra laptop: agregar `be` a su `NODOS_LOCALES` y cambiar `HOST_BE` en los 7 `.env`.
   2. `levantar` en esa laptop y `restaurar` el respaldo.
   3. `configurar` primero en esa laptop y luego en E1.
7. **Documentar:** agregar los comandos a la tabla de operación del README y el procedimiento de traslado a "Solución de problemas".

**Terminado cuando:** el simulacro funciona, pasan las 14 pruebas y el traslado en red quedó documentado.

---

## Tarea 5 · Contraseña propia para cada rol
**Responsable:** Integrante 5 (replicación y seguridad · Nodo 5 Oruro)
**Archivos:**
- `.env.example`
- `docker-compose.yml`
- `docker/initdb/00_inicializar_nodo.sh`
- `sql/comun/01_roles.sql`
- `sql/nodo1_lp/init/10_nodo_central.sql`
- `sql/nodo1_lp/post/10_transparencia_fdw.sql`
- `sql/replicas/post/10_suscripcion.sql`
- `sgbdd/config.py`
- `sgbdd/operacion.py`

1. **Listar los usos actuales** de la contraseña común:
   ```powershell
   git grep -n -i "app_password"
   ```
2. **Variables nuevas** en `.env.example`:
   - en todos los nodos: `PASS_CAJERO`, `PASS_FDW_LECTOR` y `PASS_COORDINADOR`;
   - solo en La Paz: `PASS_ANALISTA`, `PASS_AUDITOR`, `PASS_ADMIN_CATALOGO` y `PASS_REPLICADOR`.
3. **Llevar cada variable hasta donde se usa:**
   - **Contenedores:** pasarlas en `docker-compose.yml` (sección `environment`) y en el script de inicialización (`psql -v pass_cajero=…`).
   - **Creación de roles:** cada rol de `01_roles.sql` y `10_nodo_central.sql` usa su variable.
   - **Consultas remotas:** el *user mapping* de `10_transparencia_fdw.sql` usa `PASS_FDW_LECTOR`. Pasar la variable desde `configurar()`.
   - **Replicación:** la suscripción de `10_suscripcion.sql` debe conectarse como **`replicador`** con `PASS_REPLICADOR`. Verificar que `replicador` tiene `SELECT` en `productos_catalogo`; la línea ya existe en `10_nodo_central.sql`.
4. **Conexión desde Python:** en `config.py`, crear el diccionario `CONTRASENAS = {"rol_cajero": ENV["PASS_CAJERO"], …}` y usarlo en `conectar()`. Eliminar el comentario `ponytail:`.
5. **Probar el rechazo:** agregar a P11 un caso que conecte como `rol_cajero` con la contraseña de `rol_analista` y espere un error de autenticación.

**Terminado cuando:**
- tras reiniciar desde cero, pasan las 14 pruebas;
- `git grep -i app_password` no devuelve resultados;
- el panel funciona.

**Coordinar con la tarea 2:** este cambio altera el `.env` de los 7 equipos. Integrarlo **antes** del despliegue final.

---

## Tarea 6 · Latencia simulada y fallas en red real
**Responsable:** Integrante 6 (pruebas de fallas · Nodo 6 Beni)
**Archivos:** `docker-compose.yml`, `sgbdd/operacion.py`, `gestion.py`, `dashboard/app_pages/fallas.py`

**Parte A: latencia del enlace de Beni** (el documento oficial la promete en la sección 7.4).
1. En `docker-compose.yml`, agregar `cap_add: [NET_ADMIN]` **solo** al servicio `nodo6_be` y recrear ese contenedor.
2. En `operacion.py`, crear `latencia(nodo, ms)`:
   - **Herramienta `tc`:** si no está instalada, ejecutar una sola vez `docker exec -u root <contenedor> sh -c "apt-get update && apt-get install -y iproute2"`.
   - **`ms > 0`:** `tc qdisc replace dev eth0 root netem delay <ms>ms <ms/5>ms loss 1%`.
   - **`ms == 0`:** `tc qdisc del dev eth0 root`. Si no había latencia, ignorar el error.
3. Agregar el comando `python gestion.py latencia be 300` (y `latencia be 0`).
4. En la página **Simulación de fallas** del panel, agregar un control "Latencia del enlace (ms)" (0, 100, 300 o 800) visible solo para Beni.
5. **Medir** con 0, 300 y 800 ms el tiempo de la consulta C1, de un traspaso de Santa Cruz a Beni y de la propagación del catálogo a Beni.

**Parte B: fallas en red real** (requiere la tarea 2).
1. Con los 7 equipos, ejecutar a mano P1–P6, P8, P12 y P13:
   - **Cortar el enlace:** `tailscale down` en E6 (en E1 para P12).
   - **Apagar el servidor (P13):** `python gestion.py apagar be` en E6.
   - **Ventas del nodo aislado:** se hacen en su propio equipo.
2. Anotar por cada caso la acción, el tiempo y el resultado, con una captura.

**Entregable:** la sección "Latencia" y la sección "Fallas en red real" de `docs/INFORME_PRUEBAS.md` (entregar a la tarea 3), y el comando documentado en el README.
**Terminado cuando:** `latencia be 300` sube los tiempos medidos y `latencia be 0` los normaliza; las 9 fallas en red tienen evidencia; pasan las 14 pruebas.

---

## Tarea 7 · Pruebas automáticas en GitHub y pruebas del panel
**Responsable:** Integrante 7 (interfaz y documentación · consola E7). Además vigila el workflow de GitHub Actions después de cada push.
**Archivos:** `.github/workflows/pruebas.yml` y `pruebas/test_panel.py` (nuevos), `README.md`

1. **Pruebas del panel:** crear `pruebas/test_panel.py` con `streamlit.testing.v1.AppTest`.
   - **Carga:** abrir cada una de las 7 páginas (`at.switch_page("app_pages/<pagina>.py")`) y comprobar `at.exception` vacío.
   - **Consultas:** ejecutar las 8 consultas y comprobar que cada una muestra `st.success`.
   - **Fallas, cortar el enlace:** en **Simulación de fallas**, provocar la falla en Beni y pulsar los 5 **Probar**. Esperado: la consulta nacional falla, las otras 4 verificaciones funcionan, y al final se pulsa **Restaurar nodo**.
   - **Fallas, apagar el servidor:** la misma secuencia. Esperado: falla también la venta en Beni.
   - **Recuperación:** las dos caídas del coordinador y luego la recuperación. Debe quedar 0 transacciones en duda.
   - **Ejecución:** `python -m pruebas.test_panel`, con un resumen final igual al de `ejecutar_pruebas.py`.
2. **Integración continua:** crear `.github/workflows/pruebas.yml` que, en cada *push* y *Pull Request* a `main`:
   1. use `ubuntu-latest` con Python 3.12;
   2. ejecute `pip install -r requirements.txt` y `cp .env.example .env`;
   3. ejecute `python gestion.py levantar`, `python gestion.py configurar`, `python -m pruebas.ejecutar_pruebas` y `python -m pruebas.test_panel`;
   4. si algo falla, guarde los registros con `docker compose logs` como *artifact*.
3. **Insignia:** reemplazar en el README la insignia fija "pruebas 14/14" por la insignia del workflow de GitHub Actions.
4. **Workflow en rojo:** si un push deja el workflow fallando, quien lo subió lo corrige en el siguiente commit antes de que nadie más suba cambios.

**Terminado cuando:** el workflow pasa en verde en GitHub, la insignia del README lo refleja y un push con una prueba rota deja el workflow en rojo.

---

## Orden de trabajo

| Etapa | Tareas | Por qué |
|---|---|---|
| 1 | 7 (integración continua), 5, 4 (localhost), 6A | Cambian código: primero la red de seguridad (CI), luego los cambios |
| 2 | 2 | Despliegue en red con el código definitivo |
| 3 | 6B, 4 (traslado), 3 | Necesitan la red funcionando |
| 4 | 1 | Necesita los resultados de todos |
