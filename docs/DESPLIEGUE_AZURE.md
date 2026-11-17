# Despliegue en Azure · una máquina virtual por sucursal

Cada nodo corre en su propio servidor de Azure, como una sucursal real con su servidor. Las 6 VMs y
las laptops de consola se unen en una red privada cifrada con **Tailscale**. Ningún servidor expone
puertos a internet.

```
        Chile Central                        North Central US
 ┌─────────────────────────┐         ┌─────────────────────────┐
 │ vm-lp  Nodo 1 La Paz    │         │ vm-tj  Nodo 4 Tarija    │
 │ vm-sc  Nodo 2 Sta. Cruz │◄──WAN──►│ vm-or  Nodo 5 Oruro     │
 │ vm-cb  Nodo 3 Cbba.     │Tailscale│ vm-be  Nodo 6 Beni      │
 └─────────────────────────┘         └─────────────────────────┘
                 ▲                                ▲
                 └──────── laptops de consola ────┘
                   (panel, terminal, coordinador 2PC)
```

Todo el despliegue lo hace un solo script, `docker/vps/azure_desplegar.sh`, que se ejecuta en la
**Cloud Shell** del portal de Azure (ya tiene la sesión iniciada, no hay que instalar nada).

---

## 1 · Antes de empezar (una vez por cuenta de Azure)

**Cuenta.** Azure for Students (USD 100 de crédito, sin tarjeta). En el portal, cree un
**presupuesto** de USD 30 con alerta al correo: *Cost Management → Presupuestos*.

**Regiones y cuota.** Las cuentas de estudiante solo permiten algunas regiones y **6 vCPU por
región**. Abra la Cloud Shell (ícono `>_`, elija **Bash**) y averigüe qué regiones tiene permitidas:

```bash
az group create -n rg-sgbdd -l eastus -o none 2>/dev/null || true
cat > /tmp/t.json <<'EOF'
{"$schema":"https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#","contentVersion":"1.0.0.0","parameters":{"r":{"type":"string"}},"resources":[{"type":"Microsoft.Network/virtualNetworks","apiVersion":"2023-09-01","name":"prueba","location":"[parameters('r')]","properties":{"addressSpace":{"addressPrefixes":["10.9.0.0/16"]}}}]}
EOF
for r in brazilsouth chilecentral mexicocentral eastus eastus2 centralus northcentralus westus2 canadacentral francecentral; do
  az deployment group validate -g rg-sgbdd -f /tmp/t.json -p r=$r -o none 2>/dev/null && echo "PERMITIDA: $r"
done
```

Con el tamaño **Standard_B2ats_v2** (2 vCPU, 1 GB, unos USD 7 al mes encendida) caben **3 VMs por
región**: use dos regiones permitidas, por ejemplo `chilecentral` para La Paz, Santa Cruz y
Cochabamba, y `northcentralus` para Tarija, Oruro y Beni.

**Tailscale.**

1. Cree una cuenta de Tailscale **del grupo** (todos los integrantes entrarán con ella).
2. *Settings → Keys → Generate auth key*: marque **Reusable**, deje **Ephemeral** sin marcar. Copie la
   clave `tskey-auth-…` (no la publique).
3. *Access controls*: en el bloque `"ssh"`, cambie `"action": "check"` por `"action": "accept"`.
   Sin esto, los comandos que entran a los servidores piden una verificación cada pocas horas.

## 2 · Desplegar (10-15 minutos)

En la Cloud Shell (Bash):

```bash
cd ~ && rm -rf sgbdd && git clone https://github.com/CondoriEstherD/distributed-db-bolivia.git sgbdd

TS_AUTHKEY=tskey-auth-XXXX SIZE=Standard_B2ats_v2 \
REGION=chilecentral REGION_TJ=northcentralus REGION_OR=northcentralus REGION_BE=northcentralus \
bash sgbdd/docker/vps/azure_desplegar.sh
```

El script es **idempotente**: si la Cloud Shell se desconecta, vuelva a clonar y a ejecutar la misma
línea; continúa donde quedó y reutiliza las VMs ya creadas.

| Paso del script | Qué hace |
|---|---|
| Máquinas virtuales | Crea `vm-lp` … `vm-be` con Ubuntu 24.04, sin puertos de entrada, y el apagado automático diario a las 23:00 (donde la región lo permite) |
| Preparar cada VM | Docker, Tailscale, Python y el proyecto; une cada VM a la red Tailscale |
| `.env` común | Genera contraseñas seguras (roles de la base y una por sucursal) en `~/sgbdd.env` y lo copia a cada VM con su `NODOS_LOCALES` |
| Levantar | Cada VM arranca su contenedor PostgreSQL, que carga **solo su fragmento** |
| Configurar | Réplica del catálogo en los nodos 2–6 y esquema `nacional` en La Paz |
| Panel | Servicio del panel en `vm-lp` (opcional, publicado con Tailscale Funnel) |

Al terminar debe ver los 6 nodos EN LÍNEA y «✔ Despliegue terminado».

## 3 · Preparar las laptops de consola

1. Copie el `.env` generado: en la Cloud Shell, `cat ~/sgbdd.env`, y páselo a su laptop por un medio
   privado. Si la Cloud Shell lo perdió, el script lo recupera de `vm-lp`.
2. En ese `.env` deje `NODOS_LOCALES=` **vacío** (la laptop no aloja nodos).
3. Siga la guía de instalación del [README](../README.md#preparar-una-laptop) en cada laptop.

## 4 · Uso diario y costos

Azure cobra por **hora encendida** (unos USD 0,80 por hora las 6 VMs) y, aunque estén apagadas, unos
USD 6 al mes por VM en disco e IP.

```bash
# Encender las 6 antes de trabajar (2-3 minutos después ya responden)
az vm start --ids $(az vm list -g rg-sgbdd --query [].id -o tsv)

# Apagar las 6 al terminar: «desasignadas» no cobran cómputo
az vm deallocate --ids $(az vm list -g rg-sgbdd --query [].id -o tsv)

# Ver cuáles están encendidas
az vm list -g rg-sgbdd -d --query "[].{VM:name, Region:location, Estado:powerState}" -o table
```

> [!IMPORTANT]
> En Chile Central no existe el apagado automático de Azure: **apague siempre las VMs al terminar**.
> Apague desde Azure (`deallocate` o el botón *Detener*), no desde Ubuntu: una VM apagada desde dentro
> sigue cobrando.

## 5 · El día de la defensa (cuenta nueva)

1. Repita las secciones 1 y 2 en la cuenta nueva (las regiones permitidas pueden ser otras: ajuste
   `REGION` y `REGION_XX`).
2. Copie el `.env` nuevo a todas las laptops de consola (las IP de Tailscale y las contraseñas cambian).
3. En una laptop: `python gestion.py estado` y `python -m pruebas.ejecutar_pruebas`.
4. Revoque la clave `tskey-auth-…` usada (*Settings → Keys → Revoke*); las VMs siguen conectadas.

## 6 · Borrar todo al cerrar el semestre

```bash
az group delete -n rg-sgbdd --yes
```

En la consola de Tailscale, elimine también las máquinas `vm-lp` … `vm-be` de la lista de equipos.

## 7 · Si algo falla

| Síntoma | Solución |
|---|---|
| `RequestDisallowedByAzure` al crear | La región no está permitida para su cuenta: repita la prueba de regiones (sección 1) |
| `NotAvailableForSubscription` o falta de cuota | Use otra región para algunos nodos (`REGION_TJ=…`) o el tamaño `Standard_B2ts_v2` |
| Un nodo aparece SIN CONEXIÓN | Portal → `vm-xx` → *Iniciar* si está detenida, o *Ejecutar comando* → `tailscale up` |
| `ssh: … timed out` desde la consola | La VM no está en Tailscale (mismo arreglo de arriba) |
| Un comando se queda esperando | Tailscale pide verificación SSH: ponga la ACL en `"accept"` (sección 1) |
| La Cloud Shell se cerró a mitad | Vuelva a clonar y a ejecutar el script: continúa donde quedó |
