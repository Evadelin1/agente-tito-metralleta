#!/usr/bin/env bash
# Instala Tito Metralleta (Next.js) como servicio systemd en la VM gratis de
# Google Cloud — la MISMA donde ya corre Evolet. Arranca solo y se reinicia si
# se cae. Pensado para e2-micro (poca RAM): crea swap para que el build de
# Next.js no se ahogue.
#
# Uso (en la terminal SSH de la VM, dentro del repo de Tito ya clonado):
#   bash deploy/gcp/setup.sh
#
# Después, poner los secretos en /etc/tito/tito.env (incluido PORT=8082) y:
#   sudo systemctl enable --now tito
set -euo pipefail

USER_NAME="$(whoami)"
REPO_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
WEB_DIR="$REPO_DIR/web"

echo "→ Usuario:  $USER_NAME"
echo "→ Repo:     $REPO_DIR"
echo "→ Web dir:  $WEB_DIR"

# ── 1. Dependencias del sistema: git + Node 20 (NodeSource) ──────────────────
echo "→ Instalando git y Node.js 20 (si faltan)…"
sudo apt-get update -y
sudo apt-get install -y git curl ca-certificates
if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)" -lt 18 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
echo "   node $(node -v) · npm $(npm -v)"

NPM="$(command -v npm)"

# ── 2. Swap (2 GB) para que `next build` no reviente en 1 GB de RAM ───────────
if [ "$(swapon --show --noheadings | wc -l)" -eq 0 ]; then
  echo "→ Creando 2 GB de swap (para el build de Next.js)…"
  sudo fallocate -l 2G /swapfile || sudo dd if=/dev/zero of=/swapfile bs=1M count=2048
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
else
  echo "→ Ya hay swap, lo dejo como está."
fi

# ── 3. Instalar dependencias y construir Tito ────────────────────────────────
echo "→ npm ci + build (tarda unos minutos en la VM chica)…"
cd "$WEB_DIR"
npm ci
npm run build

# ── 4. Carpeta de secretos ───────────────────────────────────────────────────
sudo mkdir -p /etc/tito

# ── 5. Servicio systemd 'tito' ───────────────────────────────────────────────
echo "→ Creando servicio systemd 'tito'…"
sudo tee /etc/systemd/system/tito.service >/dev/null <<UNIT
[Unit]
Description=Tito Metralleta (agente de opciones, Next.js)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$USER_NAME
WorkingDirectory=$WEB_DIR
EnvironmentFile=/etc/tito/tito.env
ExecStart=$NPM run start
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT

sudo systemctl daemon-reload

echo ""
echo "✓ Instalador listo."
echo ""
echo "AHORA falta poner los secretos. Crea el archivo:"
echo "    sudo nano /etc/tito/tito.env"
echo ""
echo "y pega dentro (con TUS valores):"
echo "    MASSIVE_API_KEY=..."
echo "    MASSIVE_MAX_PAGES=40"
echo "    ALPACA_API_KEY_ID=..."
echo "    ALPACA_API_SECRET_KEY=..."
echo "    SITE_USER=tito"
echo "    SITE_PASSWORD=tu_contraseña"
echo "    PORT=8082"
echo ""
echo "Luego prende Tito:"
echo "    sudo systemctl enable --now tito"
echo ""
echo "Verifica:"
echo "    systemctl status tito --no-pager"
echo "    journalctl -u tito -n 40 --no-pager    # el log si algo falla"
echo ""
echo "Y abre el puerto 8082 en el firewall de Google Cloud (consola web)."
