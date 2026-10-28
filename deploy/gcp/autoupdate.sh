#!/usr/bin/env bash
# Auto-update de Tito — lo corre el timer systemd (tito-update.timer) como ROOT.
# Baja los cambios del repo COMO EL USUARIO dueño (usa sus credenciales de git),
# y SOLO si hubo cambios: reinstala deps, reconstruye y reinicia Tito. Si no hay
# cambios, no hace nada (coste cero). Así, al pushear un arreglo, la VM se pone
# al día sola en ~10 min.
set -euo pipefail

USR="${TITO_USER:-$(ls /home | head -1)}"
REPO="${TITO_REPO:-/home/$USR/agente-tito-metralleta}"
WEB="$REPO/web"

A="$(sudo -u "$USR" -H git -C "$REPO" rev-parse HEAD 2>/dev/null || echo antes)"
sudo -u "$USR" -H git -C "$REPO" pull --quiet 2>/dev/null || exit 0
B="$(sudo -u "$USR" -H git -C "$REPO" rev-parse HEAD 2>/dev/null || echo despues)"

if [ "$A" != "$B" ]; then
  echo "$(date -u '+%Y-%m-%d %H:%M:%S') update ${A:0:7} -> ${B:0:7} · rebuild + reinicio"
  sudo -u "$USR" -H bash -lc "cd '$WEB' && npm ci && npm run build"
  systemctl restart tito || true
fi
