# Manual de operación

Cómo se usa el sistema día a día: desde varias laptops, desde el panel web y desde la terminal.
La instalación de una laptop está en el [README](../README.md#preparar-una-laptop) y el montaje de
los servidores en [DESPLIEGUE_AZURE.md](DESPLIEGUE_AZURE.md).

| Dónde se opera | Para qué | Cómo se abre |
|---|---|---|
| **Panel web** (cualquier laptop de consola) | Vender, traspasos, consultas, fallas: todo con clics y mostrando el SQL | Doble clic en `abrir_panel.bat` → http://localhost:8000 |
| **Terminal** (PowerShell en la carpeta del proyecto) | Lo mismo con comandos, más las pruebas automáticas | `gestion.py`, `sgbdd.coordinador_2pc`, `pruebas.ejecutar_pruebas` |
| **Cloud Shell de Azure** (portal → `>_` → Bash) | Encender y apagar las **máquinas virtuales** | Portal de Azure |
| **SSH a un servidor** (`ssh azureuser@vm-be`) | Mirar «por dentro» una sucursal: contenedor, base, firewall | Desde una laptop de consola |

---

## A · Trabajar desde varias laptops

Las bases de datos viven en las 6 VMs de Azure; **ninguna laptop guarda datos**. Cada laptop es una
**consola** que se conecta a esas bases por la red privada (Tailscale). Por eso:

- Varias laptops pueden trabajar **al mismo tiempo**: todas ven y modifican las mismas bases.
- Si una laptop se apaga o se cierra, **no pasa nada** con el sistema.
- Cada laptop necesita lo mismo: el proyecto clonado, Python, Tailscale con la **cuenta del grupo** y el
  **`.env` común** (ver el README).

**Reglas del equipo:**

| Regla | Por qué |
|---|---|
| El `.env` se pasa por USB o mensaje privado, **nunca** por GitHub | Tiene las contraseñas de las 6 bases y de las sucursales |
| Todos entran a Tailscale con la **cuenta del grupo** | Con otra cuenta, el panel funciona pero `aislar`, `apagar` y `vender` sobre un nodo no pueden entrar a los servidores |
| Para desconectar una sucursal se usa `py gestion.py aislar xx` o el panel, **nunca** `tailscale down` | `tailscale down` deja la VM incomunicada y solo se recupera desde el portal de Azure |
| Una sola persona enciende y apaga las VMs (Cloud Shell) | Evita que alguien las apague en medio de una prueba de otro |
| Antes de trabajar: `git pull` | Todas las laptops con la misma versión del código |
| Al terminar el día: `py gestion.py restablecer` y apagar las VMs | Deja los nodos en orden y no consume crédito |

**En la defensa**, lo más claro es **una laptop por rol**:

| Laptop | Entra como | Qué muestra |
|---|---|---|
| 1 · Proyector | La Paz (administración central) | Panorama nacional, consultas distribuidas, crédito (FC2), auditoría, simulación de fallas |
| 2 | Sucursal Tarija | Ventas y **solicita** un traspaso |
| 3 | Sucursal Oruro | **Acepta** el traspaso (ve la solicitud en «Por recibir»), vende con la red cortada |
| Cualquiera | Terminal | `py gestion.py estado`, `aislar`, pruebas automáticas |

---

## B · El panel web

**Ingreso.** Se elige la sucursal y se escribe su contraseña (`CLAVE_LP` … `CLAVE_BE` del `.env`).
Cada sucursal solo ve y opera sus propios datos; el sistema lo exige también en la API (si una
sucursal intenta ver otra, la respuesta es «Solo puede ver los datos de su sucursal»). La Paz entra
además a la **administración central**.

| Menú de cada sucursal | Qué hace | Qué demuestra |
|---|---|---|
| **Vender** | Catálogo con fotos, carrito, cobro y comprobante | Transacción 100 % local (funciona sin red nacional) |
| **Historial de ventas** | Sus ventas y el detalle de cada una | Fragmentos FV y FDV de esa sucursal |
| **Clientes** | Datos generales de sus clientes | Fragmento vertical FC1 (el crédito no está aquí) |
| **Inventario** | Stock de sus almacenes | Fragmento derivado FI: stock propio de cada sucursal |
| **Traspasos** | Solicitar, recibir (aceptar o rechazar) y seguir traspasos | Aprobación de dos encargados + 2PC entre dos bases |

| Administración central (solo La Paz) | Qué demuestra |
|---|---|
| **Panorama nacional** | Estado de los 6 servidores y ventas por departamento (consulta global) |
| **Clientes y crédito** | Reconstrucción vertical FC1 ⋈ FC2 (el crédito solo existe en La Paz) |
| **Catálogo y precios** | Replicación del catálogo: el precio llega en vivo a cada sucursal |
| **Consultas distribuidas** | Transparencia: el plan muestra qué fragmentos consultó el optimizador |
| **Auditoría de traspasos** | Registro de decisiones del 2PC y recuperación de transacciones en duda |
| **Simulación de fallas** | Cortar la red o apagar el servidor de una sucursal y verificar qué sigue funcionando |

**Un traspaso, paso a paso:**

1. La sucursal de origen: *Traspasos → Nuevo traspaso* → elige sucursal, departamento y almacén de
   destino → agrega productos → **Solicitar traspaso**. La mercadería todavía no se mueve.
2. La sucursal de destino: *Traspasos → Por recibir* (el menú muestra un contador) → **Aceptar y
   recibir** o **Rechazar** con un motivo.
3. Al aceptar, el sistema verifica que las dos sucursales estén en la red y ejecuta el 2PC: en
   pantalla se ven la fase 1 (PREPARE y votos), la decisión registrada en Cochabamba y la fase 2.
4. Si una sucursal no está en la red, el traspaso no se inicia; si se cae a mitad, se revierte en
   ambas. En ningún caso queda medio traspaso.

---

## C · La terminal

En todos los comandos, `py` significa `.\.venv\Scripts\python.exe`:

```powershell
cd <carpeta del proyecto>
Set-Alias py .\.venv\Scripts\python.exe
```

Códigos de nodo: `lp` La Paz · `sc` Santa Cruz · `cb` Cochabamba · `tj` Tarija · `or` Oruro · `be` Beni.
Almacenes: dos por departamento, numerados `N01`–`N04` según el nodo (101–102 La Paz, 201–202 Santa Cruz,
301–302 Cochabamba, 401–402 Chuquisaca y 403–404 Tarija, 501–502 Oruro y 503–504 Potosí, 601–602 Beni y
603–604 Pando).
### C1 · Ver el estado

```powershell
py gestion.py estado        # los 6 nodos: EN LÍNEA · AISLADO · APAGADO · SIN CONEXIÓN
py gestion.py verificar     # conectividad entre la consola y cada nodo, y entre nodos
tailscale status            # qué servidores están en la red privada
tailscale ping vm-be        # latencia real hasta Beni
```

| Estado | Significa | La sucursal… |
|---|---|---|
| EN LÍNEA | Responde por la red nacional | vende, recibe y envía traspasos |
| AISLADO | Su enlace WAN está cortado, el servidor funciona | **vende** (autonomía local); no hace traspasos |
| APAGADO | Su servidor de base de datos está detenido | no atiende ni localmente |
| SIN CONEXIÓN | No se alcanza ni la máquina (VM apagada o sin Tailscale) | — |

### C2 · Provocar y restablecer fallas

Los comandos se ejecutan **en el servidor del nodo** por SSH, como lo haría su operador.

```powershell
py gestion.py aislar be        # corta el enlace WAN de Beni (firewall); Beni sigue vendiendo
py gestion.py reconectar be    # restablece el enlace; la réplica del catálogo se pone al día sola

py gestion.py apagar be        # caída total del servidor de base de datos de Beni
py gestion.py encender be      # lo enciende y espera a que esté sano (también: prender be)

py gestion.py restablecer      # deja TODO como en operación normal (reconecta y enciende los 6)
py gestion.py restablecer be   # solo Beni

py gestion.py latencia be 300  # 300 ms de retardo en el enlace de Beni (0 lo quita)
```

### C3 · Ventas y SQL en una sucursal

```powershell
py gestion.py vender be                          # venta en la terminal LOCAL de Beni (funciona aislada)
py gestion.py sql be "SELECT count(*) FROM ventas"
py gestion.py sql lp "SELECT * FROM nacional.resumen_nacional_disponible()"   # consulta tolerante
py gestion.py sql lp "SELECT departamento_id, count(*) FROM nacional.ventas_nacionales GROUP BY 1"
```

`vender` y `sql` usan la consola local del servidor (dentro del contenedor), no la red nacional: por
eso funcionan con el nodo AISLADO. Con el nodo APAGADO fallan, como debe ser.

### C4 · Traspasos con 2PC

En el panel un traspaso necesita que el encargado de destino lo **acepte**. Desde la terminal se
ejecuta directamente el **protocolo de las bases de datos**, útil para probar el 2PC:

```powershell
# 5 unidades del producto 15, del almacén 201 (Santa Cruz) al 601 (Beni)
py -m sgbdd.coordinador_2pc --origen 201 --destino 601 --producto 15 --cantidad 5

# con pausa de 15 s después de cada PREPARE, para cortar un enlace a mitad
py -m sgbdd.coordinador_2pc --origen 201 --destino 601 --producto 15 --cantidad 5 --pausa 15

# simula la caída del COORDINADOR (deja transacciones «en duda»)
py -m sgbdd.coordinador_2pc --origen 201 --destino 601 --producto 11 --cantidad 7 --caer-en preparado
py -m sgbdd.coordinador_2pc --origen 201 --destino 601 --producto 11 --cantidad 7 --caer-en decision

py gestion.py recuperar --edad-minima 0   # resuelve las transacciones en duda según el registro
```

Ver el stock antes y después, y el registro de decisiones:

```powershell
py gestion.py sql sc "SELECT stock_actual FROM inventario WHERE id_almacen = 201 AND id_producto = 15"
py gestion.py sql be "SELECT stock_actual FROM inventario WHERE id_almacen = 601 AND id_producto = 15"
py gestion.py sql cb "SELECT gid, estado, items, detalle FROM traspasos_log ORDER BY creado_en DESC LIMIT 5"
py gestion.py sql cb "SELECT id, origen, destino, estado, motivo FROM solicitudes_traspaso ORDER BY id DESC LIMIT 5"
py gestion.py sql sc "SELECT gid, prepared FROM pg_prepared_xacts"      # transacciones en duda
```

#### Los tres escenarios del 2PC

**a) Traspaso exitoso:** el primer comando. Se ve `PREPARE … voto SÍ` en ambos, `DECISIÓN: COMMIT` y
`COMMIT PREPARED` en ambos. Santa Cruz −5, Beni +5, total nacional igual.

**b) Beni pierde la conexión a mitad** (el caso del documento del proyecto). Dos ventanas:

```powershell
# Ventana 1
py -m sgbdd.coordinador_2pc --origen 201 --destino 601 --producto 15 --cantidad 5 --pausa 15
# Ventana 2, apenas aparezca «pausa de 15 s»
py gestion.py aislar be
```

Resultado: `DECISIÓN: ABORTAR` y `ROLLBACK PREPARED` en Santa Cruz: su stock queda intacto. Después:
`py gestion.py reconectar be`.

**c) Beni ya está sin red antes de empezar:** `py gestion.py aislar be` y luego el traspaso: aborta en
la fase 1 porque Beni no puede votar. Santa Cruz no cambia. Mientras tanto `py gestion.py vender be`
sigue funcionando.

### C5 · Pruebas automáticas (P0 a P13)

```powershell
py -m pruebas.ejecutar_pruebas              # las 14, incluidas las de fallas (aíslan y apagan Beni)
py -m pruebas.ejecutar_pruebas P7 P8 P9     # solo algunas
```

| Prueba | Qué demuestra |
|---|---|
| P0 | Reglas de la fragmentación (completitud, disyunción, reconstrucción) |
| P1 | Autonomía local: Beni aislado vende |
| P2, P3, P4 | Consulta nacional con un nodo caído: error controlado, poda de fragmentos, consulta tolerante |
| P5, P6 | Réplica del catálogo con Beni aislado y su puesta al día al reconectar |
| P7, P8, P9 | 2PC: éxito, caída del destino (rollback), caída del coordinador (recuperación) |
| P10 | 20 traspasos simultáneos: el stock nunca baja de 0 |
| P11 | Seguridad: matriz de permisos por rol |
| P12 | La Paz aislada: las demás siguen vendiendo |
| P13 | Beni apagado: los demás venden y Beni se pone al día al volver |

Cada prueba deja los nodos como estaban, aunque falle.

### C6 · Mirar una sucursal por dentro (SSH)

```powershell
ssh azureuser@vm-be
```

```bash
grep NODOS_LOCALES ~/sgbdd/.env                 # qué nodo aloja este servidor
docker ps                                       # el contenedor PostgreSQL y su estado
sudo iptables -S DOCKER-USER                    # reglas «sgbdd-aislado» si el enlace está cortado
docker exec -it nodo6_be psql -U postgres -d bd_be
#   SELECT departamento_id, count(*) FROM ventas GROUP BY 1;   -- solo BE y PA: su fragmento
#   \q
exit
```

### C7 · Las máquinas virtuales (Cloud Shell de Azure, Bash)

```bash
az vm list -g rg-sgbdd -d --query "[].{VM:name, Region:location, Estado:powerState}" -o table
az vm start      -g rg-sgbdd -n vm-be                                  # encender una
az vm deallocate -g rg-sgbdd -n vm-be                                  # apagar una (corte de luz real)
az vm start      --ids $(az vm list -g rg-sgbdd --query [].id -o tsv)  # encender todas
az vm deallocate --ids $(az vm list -g rg-sgbdd --query [].id -o tsv)  # apagar todas: no cobra cómputo
```

Apagar la VM completa es la falla más fuerte: la sucursal queda SIN CONEXIÓN. Al encenderla, Docker
levanta el nodo solo y la réplica del catálogo se pone al día.

## D · Si algo falla

| Síntoma | Solución |
|---|---|
| Un comando se queda esperando | Tailscale pide verificación SSH: abra el enlace que muestra, o ponga la ACL en `accept` |
| `no se alcanza su servidor (vm-xx)` | La VM está apagada o sin Tailscale: `az vm start …` o, en el portal, Ejecutar comando → `tailscale up` |
| Hay transacciones en duda (`2PC PEND.` > 0) | `py gestion.py recuperar --edad-minima 0` |
| Un nodo quedó aislado o apagado después de una prueba | `py gestion.py restablecer` |
| `recuperar` dice que Cochabamba no responde | La recuperación decide con el registro del Nodo 3: `py gestion.py restablecer cb` y repita |
| `restablecer` no alcanza un servidor (`ssh: … timed out`) | La máquina está apagada o sin Tailscale: no se arregla desde la consola. Portal → vm-xx → Ejecutar comando → `tailscale up`, o Cloud Shell `az vm start -g rg-sgbdd -n vm-xx` |
| El panel no refleja un cambio | En el navegador, Ctrl + F5 |
