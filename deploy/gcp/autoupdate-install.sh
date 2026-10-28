#!/usr/bin/env bash
# Instala el auto-update de Tito como timer systemd (cada 10 min).
# Uso (en la VM, dentro del repo):  bash deploy/gcp/autoupdate-install.sh
set -euo pipefail

USER_NAME="$(whoami)"
REPO_DIR="$(cd "$(dirname "$0")/../.." && pwd)"

echo "→ Servicio de auto-update (oneshot)…"
sudo tee /etc/systemd/system/tito-update.service >/dev/null <<UNIT
[Unit]
Description=Auto-update de Tito (git pull + build + restart si hay cambios)
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
Environment=TITO_USER=$USER_NAME
Environment=TITO_REPO=$REPO_DIR
ExecStart=/usr/bin/env bash $REPO_DIR/deploy/gcp/autoupdate.sh
UNIT

echo "→ Timer (cada 10 min)…"
sudo tee /etc/systemd/system/tito-update.timer >/dev/null <<'UNIT'
[Unit]
Description=Corre el auto-update de Tito cada 10 minutos

[Timer]
OnBootSec=3min
OnUnitActiveSec=10min
Persistent=true

[Install]
WantedBy=timers.target
UNIT

sudo systemctl daemon-reload
sudo systemctl enable --now tito-update.timer

echo ""
echo "✓ Auto-update activo. Cada 10 min revisa el repo y, si subí cambios,"
echo "  reconstruye y reinicia Tito solo."
echo "    systemctl list-timers tito-update.timer --no-pager"
echo "    journalctl -u tito-update.service -n 30 --no-pager"
