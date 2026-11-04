# Despliegue en la nube · Azure for Students

El sistema queda **mixto**: los nodos 1 a 5 siguen en las laptops y se suman dos servidores en la nube,
todos dentro de la misma red Tailscale. El código no cambia; solo cambian las direcciones del `.env`.

| Servidor | Qué aloja | `NODOS_LOCALES` | Quién lo opera |
|---|---|---|---|
| `vm-consola` (Azure) | Panel público, coordinador 2PC y pruebas | *(vacío)* | Integrante 7 |
| `vm-beni` (Azure) | Nodo 6 · Beni y Pando, puerto 15436 | `be` | Integrante 6 |
| E1 a E5 (laptops) | Nodos 1 a 5 | `lp`, `sc`, `cb`, `tj`, `or` | Integrantes 1 a 5 |

```
 Docente (navegador) ──HTTPS──► Tailscale Funnel ──► vm-consola (panel)
                                                        │  red privada Tailscale
           E1 La Paz · E2 SC · E3 CB · E4 TJ · E5 OR ───┼─── vm-beni (Nodo 6)
```

**Seguridad:**
- PostgreSQL **nunca** se expone a internet. En Azure solo queda abierto el puerto SSH (22), y además
  `pg_hba.conf` rechaza cualquier dirección que no sea privada o de Tailscale.
- El único acceso público es el panel, por HTTPS y con contraseña (`PANEL_CLAVE`).

---

## 1. Activar Azure for Students (una vez, un integrante)

1. Entrar a <https://azure.microsoft.com/free/students> → **Activar ahora**.
2. Iniciar sesión con el **correo institucional** de la universidad. No pide tarjeta.
3. Al terminar: USD 100 de crédito por 12 meses y algunos tamaños de VM pequeños gratis.
4. **Antes de crear nada:** en el portal, buscar **Presupuestos** (Cost Management) y crear uno de
   USD 20 con alerta al correo del grupo.

> Las condiciones del plan cambian. Al crear cada VM, revise en el portal (**Servicios gratuitos**) que
> el tamaño elegido figure como gratuito en su cuenta.

## 2. Crear las dos máquinas virtuales

En el portal: **Máquinas virtuales → Crear → Máquina virtual de Azure**. Repetir para `vm-consola` y `vm-beni`.

| Campo | Valor |
|---|---|
| Grupo de recursos | `rg-sgbdd` (nuevo, el mismo para las dos VM) |
| Nombre | `vm-consola` / `vm-beni` |
| Región | **Brazil South** (la más cercana a Bolivia) |
| Imagen | **Ubuntu Server 24.04 LTS – x64** |
| Tamaño | Uno de los gratuitos: **B2ats v2** (2 vCPU, 1 GB) o **B1s** (1 vCPU, 1 GB) |
| Autenticación | Clave pública SSH (descargar el `.pem` y guardarlo, no subirlo a GitHub) |
| Usuario | `azureuser` |
| Puertos de entrada públicos | **Solo SSH (22)**. No abrir 15436 ni 8501 |
| Disco del SO | SSD estándar (el tamaño por defecto alcanza) |
| Administración → Apagado automático | Activado, 23:00, zona horaria (UTC-04:00) La Paz |

## 3. Preparar cada VM

Desde una laptop, en PowerShell (con la IP **pública** de la VM que muestra el portal):

```powershell
ssh -i vm-beni_key.pem azureuser@<IP_PUBLICA>
```

Ya dentro de la VM:

```bash
git clone https://github.com/CondoriEstherD/distributed-db-bolivia.git ~/sgbdd
bash ~/sgbdd/docker/vps/preparar_vps.sh
sudo tailscale up          # abrir el enlace que aparece e iniciar sesión con la cuenta del grupo
tailscale ip -4            # anotar la IP 100.x.y.z en docs/DESPLIEGUE_RED.md
exit                       # salir y volver a entrar para usar docker sin sudo
```

## 4. El `.env` en la nube

1. Copiar el `.env` común del grupo desde una laptop:
   `scp -i vm-beni_key.pem .env azureuser@<IP_PUBLICA>:~/sgbdd/.env`
2. Ajustar en cada VM (con `nano ~/sgbdd/.env`):
   - **vm-beni:** `NODOS_LOCALES=be` y `BIND_IP=0.0.0.0`.
   - **vm-consola:** `NODOS_LOCALES=` (vacío) y `PANEL_CLAVE=<clave para el docente>`.
3. En **los 7 `.env`** (laptops y VM), poner en `HOST_BE` la IP de Tailscale de `vm-beni`.

## 5. Levantar Beni en la nube

En `vm-beni`:

```bash
cd ~/sgbdd && source .venv/bin/activate
python gestion.py levantar      # 2-4 min la primera vez
python gestion.py verificar     # debe decir «Conectividad completa»
python gestion.py configurar    # suscripción al catálogo de La Paz
```

Después, en **E1 (La Paz)**: `python gestion.py configurar`. Esto apunta las consultas nacionales a la
nueva dirección de Beni. El orden completo y las casillas están en `docs/DESPLIEGUE_RED.md`.

## 6. Publicar el panel

**Una vez, en la consola de administración de Tailscale** (<https://login.tailscale.com/admin>):
1. **DNS → HTTPS Certificates → Enable.**
2. **Access controls:** aceptar la sugerencia de agregar el permiso `funnel` (o agregar
   `"nodeAttrs": [{"target": ["autogroup:member"], "attr": ["funnel"]}]`).

**En `vm-consola`:**

```bash
cd ~/sgbdd && source .venv/bin/activate
python gestion.py estado                          # 6 nodos en línea
sudo systemctl enable --now sgbdd-panel@azureuser # el panel arranca solo, también tras reiniciar
sudo tailscale funnel --bg 8501                   # lo publica por HTTPS
tailscale funnel status                           # muestra la URL pública
```

La URL tiene la forma `https://vm-consola.<nombre-de-la-red>.ts.net`. Se abre desde cualquier navegador,
sin instalar nada, y pide la `PANEL_CLAVE`. Para dejar de publicarlo: `sudo tailscale funnel --bg 8501 off`.

## 7. Cómo se apagan los nodos en la demostración

En la nube hay tres niveles de falla, de menor a mayor:

| Falla | Cómo se provoca | Qué se ve en el panel | Cómo se restablece |
|---|---|---|---|
| **Corte del enlace** (P1–P6, P8) | En `vm-beni`: `sudo tailscale down` | Beni «FUERA DE LÍNEA»; Beni sigue vendiendo localmente (`python gestion.py vender be` en `vm-beni`) | `sudo tailscale up` |
| **Caída del servidor de base de datos** (P13) | En `vm-beni`: `python gestion.py apagar be` | Beni fuera de línea; los demás venden | `python gestion.py encender be` |
| **Apagado de la máquina completa** | Portal de Azure → `vm-beni` → **Detener** | Igual que P13, pero la máquina entera está apagada, como un corte de luz en la sucursal | Portal → **Iniciar**. Docker vuelve a levantar el nodo solo y la réplica se pone al día |

- La IP de Tailscale **no cambia** al detener e iniciar la VM. La IP pública sí puede cambiar, pero no
  importa: solo se usa para SSH.
- El botón **Apagar el servidor** del panel solo actúa sobre nodos del mismo equipo. Desde
  `vm-consola` se usa la tabla de arriba.
- La latencia simulada también funciona en la nube: `python gestion.py latencia be 300` en `vm-beni`.

## 8. Cuidar el crédito y apagar todo al final

| Cuándo | Acción |
|---|---|
| Al terminar cada sesión de trabajo | Portal → las dos VM → **Detener**. Queda «Desasignada» y no consume cómputo |
| Todas las noches | El apagado automático de las 23:00 lo hace solo |
| Antes de la defensa | Portal → **Iniciar** ambas VM 15 minutos antes y comprobar `python gestion.py estado` |
| Al cerrar el semestre | Portal → Grupos de recursos → `rg-sgbdd` → **Eliminar**. Borra todo y deja de cobrar |

## 9. Si algo falla

| Síntoma | Solución |
|---|---|
| `permission denied` al usar docker | Cerrar la sesión SSH y volver a entrar (paso 3) |
| El nodo tarda o se reinicia | Falta memoria: comprobar con `free -h` que existe el swap de 2 GB |
| `verificar` da ✖ hacia o desde `vm-beni` | Revisar `HOST_BE` en los 7 `.env`, `BIND_IP=0.0.0.0` en `vm-beni` y `tailscale status` |
| La URL del panel no abre | `systemctl status sgbdd-panel@azureuser` y `tailscale funnel status`; revisar el paso 6 en la consola de Tailscale |
| El panel abre pero los nodos aparecen fuera de línea | `vm-consola` no tiene el `.env` común o Tailscale está caído: `tailscale status` |
