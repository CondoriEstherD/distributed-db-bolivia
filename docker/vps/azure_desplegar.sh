#!/usr/bin/env bash
# Despliegue completo en Azure: una VM por nodo (vm-lp … vm-be), unidas por Tailscale.
# Se ejecuta en la Cloud Shell (Bash) del portal de Azure, que ya tiene la sesión iniciada:
#
#   git clone https://github.com/CondoriEstherD/distributed-db-bolivia.git sgbdd
#   TS_AUTHKEY=tskey-auth-... REGION=westus2 SIZE=Standard_D2als_v6 bash sgbdd/docker/vps/azure_desplegar.sh
#
# Opcional: REGION_TJ=eastus2 (etc.) pone ese nodo en otra región si se agota la cuota de vCPU.
# Azure for Students: 6 vCPU por región y pocas regiones permitidas. Con B2ats_v2 (2 vCPU) caben
# 3 VM por región, p. ej. REGION=chilecentral REGION_TJ=northcentralus REGION_OR=northcentralus REGION_BE=northcentralus
# Es idempotente: si se corta, se vuelve a ejecutar y continúa (las VM existentes se reutilizan).
# Las contraseñas se generan una vez y se guardan en ~/sgbdd.env (la Cloud Shell la conserva).
set -euo pipefail

: "${TS_AUTHKEY:?Falta TS_AUTHKEY (Tailscale → Settings → Keys → Generate auth key, Reusable + Pre-approved)}"
: "${REGION:?Falta REGION (p. ej. westus2)}"
: "${SIZE:?Falta SIZE (p. ej. Standard_D2als_v6)}"
RG=${RG:-rg-sgbdd}
REPO=https://github.com/CondoriEstherD/distributed-db-bolivia.git
NODOS=(lp sc cb tj or be)
ENV_LOCAL=~/sgbdd.env
paso() { printf '\n\033[1;34m▶ %s\033[0m\n' "$1"; }

# Ejecuta un script bash como root en la VM y muestra su salida.
en_vm() { az vm run-command invoke -g "$RG" -n "vm-$1" --command-id RunShellScript \
            --scripts "$2" --query "value[0].message" -o tsv; }
# Lo mismo, como azureuser dentro de ~/sgbdd (con el grupo docker ya aplicado).
gestion() { en_vm "$1" "sudo -iu azureuser bash -c 'cd ~/sgbdd && .venv/bin/python gestion.py $2'"; }

paso "Cuota de vCPU en $REGION (cada VM usa los vCPU de $SIZE)"
az vm list-usage -l "$REGION" --query "[?name.value=='cores'].{usados:currentValue,limite:limit}" -o table

paso "Grupo de recursos $RG"
az group show -n "$RG" -o none 2>/dev/null || az group create -n "$RG" -l "$REGION" -o none

paso "Máquinas virtuales (sin puertos de entrada: se administran por Tailscale y run-command)"
for cod in "${NODOS[@]}"; do
    var="REGION_${cod^^}"; region="${!var:-$REGION}"
    if az vm show -g "$RG" -n "vm-$cod" -o none 2>/dev/null; then
        echo "  vm-$cod ya existe"; continue
    fi
    echo "  creando vm-$cod en $region…"
    az vm create -g "$RG" -n "vm-$cod" -l "$region" --image Ubuntu2404 --size "$SIZE" \
        --admin-username azureuser --generate-ssh-keys --storage-sku StandardSSD_LRS \
        --public-ip-sku Standard --nsg-rule NONE --no-wait -o none
done
for cod in "${NODOS[@]}"; do az vm wait -g "$RG" -n "vm-$cod" --created; done
for cod in "${NODOS[@]}"; do   # Apagado diario 23:00 hora de La Paz, en la región de la VM
    read -r id region < <(az vm show -g "$RG" -n "vm-$cod" --query "[id,location]" -o tsv | paste -sd' ')
    az resource create -g "$RG" -n "shutdown-computevm-vm-$cod" -l "$region" \
        --resource-type Microsoft.DevTestLab/schedules -o none -p "{\"status\":\"Enabled\",
        \"taskType\":\"ComputeVmShutdownTask\",\"dailyRecurrence\":{\"time\":\"2300\"},
        \"timeZoneId\":\"SA Western Standard Time\",\"targetResourceId\":\"$id\"}" \
        || echo "  ⚠ vm-$cod sin apagado automático: actívelo en el portal (VM → Apagado automático)"
done

paso "Preparar cada VM: Docker, Tailscale y el proyecto (3-5 min, en paralelo)"
for cod in "${NODOS[@]}"; do
    en_vm "$cod" "cloud-init status --wait >/dev/null
        sudo -iu azureuser bash -c '[ -d ~/sgbdd ] || git clone -q $REPO ~/sgbdd; cd ~/sgbdd && git pull -q; bash docker/vps/preparar_vps.sh' >/dev/null
        tailscale up --authkey=$TS_AUTHKEY --hostname=vm-$cod --ssh
        echo vm-$cod listo: \$(tailscale ip -4)" > "/tmp/prep_$cod.log" 2>&1 &
done
wait
cat /tmp/prep_*.log

paso "IP de Tailscale de cada VM"
declare -A IP
for cod in "${NODOS[@]}"; do
    IP[$cod]=$(en_vm "$cod" "tailscale ip -4" | grep -Eo '100\.[0-9.]+' | head -1)
    [ -n "${IP[$cod]}" ] || { echo "vm-$cod no tiene IP de Tailscale: revise /tmp/prep_$cod.log"; exit 1; }
    echo "  vm-$cod → ${IP[$cod]}"
done

paso ".env común (contraseñas en $ENV_LOCAL)"
# La Cloud Shell sin almacenamiento borra $HOME al cerrar: si ya hubo un despliegue, las contraseñas
# se recuperan del .env de vm-lp (las bases ya se crearon con ellas y no deben cambiar).
if [ ! -f "$ENV_LOCAL" ]; then
    en_vm lp "cat /home/azureuser/sgbdd/.env 2>/dev/null" | grep -E '^[A-Z_]+=' > "$ENV_LOCAL" || true
    grep -q '^PG_PASSWORD=' "$ENV_LOCAL" && echo "  contraseñas recuperadas de vm-lp" || rm -f "$ENV_LOCAL"
fi
if [ ! -f "$ENV_LOCAL" ]; then
    clave() { openssl rand -hex 12; }
    cat > "$ENV_LOCAL" <<EOF
PG_PASSWORD=$(clave)
PASS_CAJERO=$(clave)
PASS_FDW_LECTOR=$(clave)
PASS_COORDINADOR=$(clave)
PASS_ANALISTA=$(clave)
PASS_AUDITOR=$(clave)
PASS_ADMIN_CATALOGO=$(clave)
PASS_REPLICADOR=$(clave)
PANEL_CLAVE=$(clave)
EOF
fi
sed -i '/^MODO=\|^BIND_IP=\|^NODOS_LOCALES=\|^HOST_\|^PORT_/d' "$ENV_LOCAL"
{
    echo "MODO=red"; echo "BIND_IP=0.0.0.0"; echo "NODOS_LOCALES="
    p=15431
    for cod in "${NODOS[@]}"; do echo "HOST_${cod^^}=${IP[$cod]}"; echo "PORT_${cod^^}=$p"; p=$((p+1)); done
} >> "$ENV_LOCAL"
for cod in "${NODOS[@]}"; do
    b64=$(sed "s/^NODOS_LOCALES=.*/NODOS_LOCALES=$cod/" "$ENV_LOCAL" | base64 -w0)
    en_vm "$cod" "echo $b64 | base64 -d > /home/azureuser/sgbdd/.env && chown azureuser: /home/azureuser/sgbdd/.env && chmod 600 /home/azureuser/sgbdd/.env" >/dev/null
done

paso "Levantar los 6 nodos (cada uno carga solo su fragmento; 2-4 min)"
for cod in "${NODOS[@]}"; do gestion "$cod" levantar > "/tmp/lev_$cod.log" 2>&1 & done
wait
cat /tmp/lev_*.log

paso "Conectividad entre nodos"
gestion lp verificar

paso "Replicación del catálogo y esquema global"
for cod in sc cb tj or be; do gestion "$cod" configurar; done
gestion lp configurar
gestion lp estado

paso "Panel en vm-lp"
en_vm lp "systemctl enable --now sgbdd-panel@azureuser && (tailscale funnel --bg 8501 >/dev/null 2>&1; tailscale funnel status || true)"

cat <<EOF

✔ Despliegue terminado.
  Panel:       la URL https://vm-lp.<red>.ts.net de arriba (clave: PANEL_CLAVE en $ENV_LOCAL).
               Si no aparece, active Funnel en la consola de Tailscale (docs/DESPLIEGUE_VPS.md §6).
  Consola:     ssh azureuser@vm-lp   (desde un equipo de la red Tailscale)
  Apagar todo: az vm deallocate --ids \$(az vm list -g $RG --query [].id -o tsv)
  Encender:    az vm start --ids \$(az vm list -g $RG --query [].id -o tsv)
  Borrar todo: az group delete -n $RG --yes
EOF
