#!/usr/bin/env bash
# Prepara un VPS Ubuntu 24.04 (Azure) para alojar un nodo o la consola del SGBDD.
# Uso, una sola vez, como el usuario de la VM (no como root):
#   git clone https://github.com/CondoriEstherD/distributed-db-bolivia.git ~/sgbdd
#   bash ~/sgbdd/docker/vps/preparar_vps.sh
# Instala Docker, Tailscale y Python; crea memoria de intercambio y el entorno del proyecto.
# Volver a ejecutarlo no rompe nada: cada paso comprueba si ya está hecho.
set -euo pipefail

RAIZ="$(cd "$(dirname "$0")/../.." && pwd)"
paso() { printf '\n\033[1;34m▶ %s\033[0m\n' "$1"; }

paso "Memoria de intercambio de 2 GB (las VM gratuitas tienen 1 GB de RAM)"
if ! swapon --show | grep -q /swapfile; then
    sudo fallocate -l 2G /swapfile
    sudo chmod 600 /swapfile
    sudo mkswap /swapfile >/dev/null
    sudo swapon /swapfile
    echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi

paso "Paquetes base: Python y git"
# Recién creada, la VM suele estar instalando actualizaciones: se espera el candado de apt.
sudo apt-get -o DPkg::Lock::Timeout=600 update -qq
sudo apt-get -o DPkg::Lock::Timeout=600 install -y -qq git python3-venv python3-pip >/dev/null

paso "Docker"
if ! command -v docker >/dev/null; then
    curl -fsSL https://get.docker.com | sudo sh >/dev/null
fi
sudo usermod -aG docker "$USER"

paso "Tailscale"
if ! command -v tailscale >/dev/null; then
    curl -fsSL https://tailscale.com/install.sh | sudo sh >/dev/null
fi

paso "Entorno de Python del proyecto"
cd "$RAIZ"
[ -d .venv ] || python3 -m venv .venv
.venv/bin/pip install -q -r requirements.txt

paso "Servicio del panel (solo se activa en la VM de consola)"
sudo cp docker/vps/sgbdd-panel@.service /etc/systemd/system/
sudo systemctl daemon-reload

cat <<EOF

✔ VPS preparado. Normalmente lo hace docker/vps/azure_desplegar.sh (ver docs/DESPLIEGUE_AZURE.md).
  A mano: sudo tailscale up · copiar el .env común a $RAIZ/.env con NODOS_LOCALES=<nodo> ·
  cerrar la sesión SSH y volver a entrar (para usar docker sin sudo).
EOF
