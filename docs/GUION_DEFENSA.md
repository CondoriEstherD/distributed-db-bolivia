# Guion de la defensa · 15 minutos

**1 hora antes:** encender las 6 VMs (Cloud Shell: `az vm start --ids $(az vm list -g rg-sgbdd --query [].id -o tsv)`).

**30 minutos antes**, en la laptop del proyector:

```powershell
py gestion.py restablecer        # todos los nodos reconectados y encendidos
py gestion.py estado             # 6 EN LÍNEA · La Paz con 5/5 suscriptores · 0 en duda
```

Abrir el panel (`abrir_panel.bat`) en tres laptops: **proyector** como La Paz, **laptop 2** como
Tarija y **laptop 3** como Oruro (contraseñas en el `.env`). Tener abierta una PowerShell en el
proyector. **Plan B:** modo `lab` en una laptop (`Copy-Item .env.lab .env`, `py gestion.py levantar`).

| Minuto | Integrante | Qué hace en pantalla | Qué explica |
|---|---|---|---|
| 0:00–1:30 | 1 · Arquitecto | README (diagrama) y **Panorama nacional** | El problema: vender sin conexión y consultar a nivel nacional; 6 servidores en Azure para 9 departamentos |
| 1:30–3:00 | 1 · Arquitecto | Página de una sucursal: **Historial de ventas**, **Clientes**, **Inventario**; `py -m pruebas.ejecutar_pruebas P0` | Fragmentación horizontal (FV, FDV, FI) y vertical (FC1); reglas de corrección con las 50 000 ventas |
| 3:00–4:30 | 2 · Infraestructura | `tailscale status`, `py gestion.py estado`, portal de Azure con las 6 VMs | Despliegue real: una VM por sucursal en dos regiones, red privada Tailscale, ningún puerto público, `.env` común |
| 4:30–6:00 | 3 · Transacciones | **Consultas distribuidas**: C1 y C6 con el plan de ejecución | Transparencia con `postgres_fdw`: C1 agrega en cada nodo; C6 solo toca `fv2_sc` (poda de fragmentos) |
| 6:00–8:00 | 3 · Transacciones | Laptop 2 (Tarija) **solicita** un traspaso → laptop 3 (Oruro) lo **acepta** y se ven las fases del 2PC | Doble aprobación de encargados + 2PC: PREPARE, decisión en Cochabamba, COMMIT; stock nacional conservado |
| 8:00–9:30 | 6 · Fallas | Proyector: `py gestion.py aislar or` → laptop 3 (Oruro) **vende** igual → laptop 2 intenta un traspaso a Oruro: **no se permite** | Autonomía local: la sucursal sin red sigue vendiendo; el traspaso necesita el voto de ambas |
| 9:30–10:30 | 6 · Fallas | La Paz → *Simulación de fallas* → «Probar todo»; `py gestion.py reconectar or` | Consulta nacional con error controlado, poda, consulta tolerante; al reconectar, Oruro se pone al día |
| 10:30–11:30 | 5 · Replicación y seguridad | La Paz → **Catálogo y precios**: cambiar un precio y verlo llegar a las 5 sucursales | Replicación lógica asíncrona; consistencia eventual (con una sucursal aislada queda «pendiente») |
| 11:30–12:30 | 5 · Replicación y seguridad | La Paz → **Clientes y crédito**; Tarija → **Clientes** (sin crédito); `py -m pruebas.ejecutar_pruebas P11` | Fragmento FC2 solo en La Paz; matriz CRUD con `GRANT/REVOKE`; el panel también impide ver otra sucursal |
| 12:30–13:30 | 7 · Interfaz | La Paz → **Auditoría de traspasos**: caída del coordinador en «preparado» y en «decision» → Ejecutar recuperación | Transacciones en duda y presunción de aborto; quedan 0 en duda |
| 13:30–14:15 | 4 · Datos | Terminal: traspaso con `--pausa 15` y `py gestion.py aislar be` a mitad → rollback en Santa Cruz | El caso del enunciado: Beni pierde la conexión a mitad del traspaso y el origen se revierte solo |
| 14:15–15:00 | 7 · Interfaz | `docs/evidencias/pruebas_azure.txt` (14/14) y la insignia de GitHub Actions | Pruebas automatizadas en la nube real e integración continua; cierre y preguntas |

**Comandos del minuto 13:30** (dos ventanas de PowerShell):

```powershell
# Ventana 1
py -m sgbdd.coordinador_2pc --origen 201 --destino 601 --producto 15 --cantidad 5 --pausa 15
# Ventana 2, cuando aparezca «pausa de 15 s»
py gestion.py aislar be
# Al terminar
py gestion.py restablecer
```

**Después de la defensa:** `py gestion.py restablecer` y apagar las VMs
(`az vm deallocate --ids $(az vm list -g rg-sgbdd --query [].id -o tsv)`).

**Aprobación del guion** (cada integrante marca cuando lo revisó):

- [ ] Integrante 1 · [ ] Integrante 2 · [ ] Integrante 3 · [ ] Integrante 4
- [ ] Integrante 5 · [ ] Integrante 6 · [ ] Integrante 7
