# Manejo del sistema desde la terminal

Todo lo que hace el panel también se puede hacer con comandos. Hay **tres lugares** desde donde se
opera, cada uno con su papel:

| Dónde | Para qué | Cómo se abre |
|---|---|---|
| **PowerShell en la PC de consola** (carpeta del proyecto) | Estado, fallas, ventas, 2PC, pruebas. Es el lugar principal | `cd` a la carpeta del proyecto |
| **Cloud Shell de Azure** (portal → `>_` → Bash) | Encender, apagar o reiniciar las **máquinas virtuales** | Portal de Azure |
| **SSH a un servidor** (`ssh azureuser@vm-be`) | Mirar «por dentro» una sucursal: contenedor, base, firewall | Desde la PC de consola |

**Requisitos de la PC de consola:** Tailscale conectado (`tailscale status`), el `.env` común con
`MODO=red` y `NODOS_LOCALES=` vacío, y en la consola de Tailscale la regla SSH de la ACL en
`"action": "accept"` (si está en `check`, cada pocas horas pide abrir un enlace y los comandos se
quedan esperando).

## 0 · Usar el sistema desde otra laptop

Las bases de datos están en Azure, no en ninguna laptop. Cualquier laptop puede ser **consola**:
solo necesita entrar a la red privada (Tailscale) y tener la configuración común (`.env`). Varias
consolas pueden trabajar a la vez: todas ven y modifican las mismas bases.

**Una sola vez, en cada laptop:**

1. Instalar **Git**, **Python 3.12 o superior** y **Tailscale**. No hace falta Node ni Docker.
2. Entrar a Tailscale con la **cuenta del grupo**, la misma con la que se crearon las VMs. Así la
   laptop queda en la misma red y puede usar el SSH de Tailscale hacia las VMs.
   (Alternativa: invitar la cuenta de cada integrante desde la consola de Tailscale, pero entonces
   hay que etiquetar las VMs y permitir el SSH a esa etiqueta en la ACL.)
3. Clonar el proyecto y crear su entorno:
   ```powershell
   git clone https://github.com/CondoriEstherD/distributed-db-bolivia.git sgbdd
   cd sgbdd
   python -m venv .venv
   .\.venv\Scripts\pip install -r requirements.txt
   ```
4. Copiar el **`.env`** común de la consola principal, por un medio privado (USB o mensaje directo,
   **nunca** por GitHub). Trae las IP de Tailscale de las 6 VMs, las contraseñas de los roles y las
   de las sucursales. Debe tener `MODO=red` y `NODOS_LOCALES=` vacío.
5. Comprobar: `.\.venv\Scripts\python.exe gestion.py estado` → los 6 nodos EN LÍNEA.

**Cada vez:** doble clic en `abrir_panel.bat` (panel en http://localhost:8000) o los comandos de
abajo. Para actualizar el código: `git pull`.

**En la defensa** se puede usar una laptop por sucursal: en una se entra como Tarija y se solicita
un traspaso; en otra se entra como Oruro y se acepta. Las solicitudes viven en Cochabamba (Nodo 3),
así que cada consola ve las mismas.

En todos los comandos de abajo, `py` significa `.\.venv\Scripts\python.exe`:

```powershell
cd "C:\…\proyecto_base\Nueva carpeta"
Set-Alias py .\.venv\Scripts\python.exe
```

Códigos de nodo: `lp` La Paz · `sc` Santa Cruz · `cb` Cochabamba · `tj` Tarija · `or` Oruro · `be` Beni.
Almacenes: `N01`/`N02` del primer departamento del nodo, `N03`/`N04` del segundo (ej. 401–402 Chuquisaca,
403–404 Tarija; 501–502 Oruro, 503–504 Potosí; 601–602 Beni, 603–604 Pando).

---

## 1 · Ver el estado

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

## 2 · Provocar y restablecer fallas

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

## 3 · Ventas y SQL en una sucursal

```powershell
py gestion.py vender be                          # venta en la terminal LOCAL de Beni (funciona aislada)
py gestion.py sql be "SELECT count(*) FROM ventas"
py gestion.py sql lp "SELECT * FROM nacional.resumen_nacional_disponible()"   # consulta tolerante
py gestion.py sql lp "SELECT departamento_id, count(*) FROM nacional.ventas_nacionales GROUP BY 1"
```

`vender` y `sql` usan la consola local del servidor (dentro del contenedor), no la red nacional: por
eso funcionan con el nodo AISLADO. Con el nodo APAGADO fallan, como debe ser.

## 4 · Traspasos con 2PC

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

### Los tres escenarios del 2PC

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

## 5 · Pruebas automáticas (P0 a P13)

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

## 6 · Mirar una sucursal por dentro (SSH)

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

## 7 · Las máquinas virtuales (Cloud Shell de Azure, Bash)

```bash
az vm list -g rg-sgbdd -d --query "[].{VM:name, Region:location, Estado:powerState}" -o table
az vm start      -g rg-sgbdd -n vm-be                                  # encender una
az vm deallocate -g rg-sgbdd -n vm-be                                  # apagar una (corte de luz real)
az vm start      --ids $(az vm list -g rg-sgbdd --query [].id -o tsv)  # encender todas
az vm deallocate --ids $(az vm list -g rg-sgbdd --query [].id -o tsv)  # apagar todas: no cobra cómputo
```

Apagar la VM completa es la falla más fuerte: la sucursal queda SIN CONEXIÓN. Al encenderla, Docker
levanta el nodo solo y la réplica del catálogo se pone al día.

## 8 · Si algo falla

| Síntoma | Solución |
|---|---|
| Un comando se queda esperando | Tailscale pide verificación SSH: abra el enlace que muestra, o ponga la ACL en `accept` |
| `no se alcanza su servidor (vm-xx)` | La VM está apagada o sin Tailscale: `az vm start …` o, en el portal, Ejecutar comando → `tailscale up` |
| Hay transacciones en duda (`2PC PEND.` > 0) | `py gestion.py recuperar --edad-minima 0` |
| Un nodo quedó aislado o apagado después de una prueba | `py gestion.py restablecer` |
| `recuperar` dice que Cochabamba no responde | La recuperación decide con el registro del Nodo 3: `py gestion.py restablecer cb` y repita |
| `restablecer` no alcanza un servidor (`ssh: … timed out`) | La máquina está apagada o sin Tailscale: no se arregla desde la consola. Portal → vm-xx → Ejecutar comando → `tailscale up`, o Cloud Shell `az vm start -g rg-sgbdd -n vm-xx` |
| El panel no refleja un cambio | En el navegador, Ctrl + F5 |
