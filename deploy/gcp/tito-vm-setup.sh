#!/usr/bin/env bash
# ============================================================================
# Corre DENTRO de la VM evolet (lo invoca tito-deploy.sh por ssh).
# Idempotente y SIN secretos. Prepara: swap, Node y el servicio systemd de Tito
# con límites de memoria/CPU para que NUNCA le quite recursos a los otros
# agentes (Evolet/David/Cripto/Forex).
# ============================================================================
set -euo pipefail
PORT="${TITO_PORT:-8090}"

# --- 1. Swap 2G: red de seguridad de RAM (la VM solo tiene ~964MB) -----------
if ! sudo swapon --show 2>/dev/null | grep -q '/swapfile'; then
  if [ ! -f /swapfile ]; then
    sudo fallocate -l 2G /swapfile 2>/dev/null || sudo dd if=/dev/zero of=/swapfile bs=1M count=2048
    sudo chmod 600 /swapfile
    sudo mkswap /swapfile >/dev/null
  fi
  sudo swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
  echo "[tito] swap 2G activado"
else
  echo "[tito] swap ya estaba activo"
fi

# --- 2. Node (>=18). Debian 13 trae 20 por apt; si no, NodeSource 20 ---------
if ! command -v node >/dev/null 2>&1; then
  sudo apt-get update -qq
  sudo apt-get install -y -qq nodejs >/dev/null 2>&1 || true
fi
NODE_BIN="$(command -v node || true)"
NODE_MAJOR=0
[ -n "$NODE_BIN" ] && NODE_MAJOR="$("$NODE_BIN" -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if [ -z "$NODE_BIN" ] || [ "${NODE_MAJOR:-0}" -lt 18 ]; then
  echo "[tito] instalando Node 20 (NodeSource)..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - >/dev/null 2>&1
  sudo apt-get install -y -qq nodejs >/dev/null 2>&1
  NODE_BIN="$(command -v node)"
fi
echo "[tito] node = $NODE_BIN ($("$NODE_BIN" -v))"

# --- 3. Carpetas -------------------------------------------------------------
sudo mkdir -p /opt/tito /etc/tito

# --- 4. Servicio systemd con SALVAGUARDAS de recursos ------------------------
# MemoryMax: tope duro. CPUWeight bajo + Nice alto: cede CPU a los demás.
# OOMScoreAdjust alto: si algún día falta RAM, el kernel mata a TITO primero,
# nunca a tus agentes de dinero.
sudo tee /etc/systemd/system/tito.service >/dev/null <<UNIT
[Unit]
Description=Tito Metralleta (Next.js) - vista Mercado
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=/opt/tito
EnvironmentFile=/etc/tito/tito.env
Environment=NODE_ENV=production
ExecStart=$NODE_BIN /opt/tito/server.js
Restart=on-failure
RestartSec=5
MemoryHigh=300M
MemoryMax=450M
CPUWeight=20
Nice=10
OOMScoreAdjust=800

[Install]
WantedBy=multi-user.target
UNIT
sudo systemctl daemon-reload
echo "[tito] servicio systemd instalado (MemoryMax=450M, cede CPU a los demás)"
