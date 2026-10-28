#!/usr/bin/env bash
# ============================================================================
# Despliega Tito en la VM evolet de Google Cloud, al lado de tus otros agentes.
# Corre DESDE tu Mac. Hace todo: prepara la VM (swap+Node+servicio con límites),
# sube el build, instala las credenciales en la VM (solo-root) y arranca Tito.
#
#   Uso:   bash deploy/gcp/tito-deploy.sh
#
# Requisitos: gcloud ya logueado (lo estás) y el build hecho:
#   cd web && npm run build
# ============================================================================
set -euo pipefail
ZONE=us-east1-b
VM=evolet
PORT=8090

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
WEB="$ROOT/web"
STANDALONE="$WEB/.next/standalone"

if [ ! -f "$STANDALONE/server.js" ]; then
  echo "✗ No hay build standalone. Primero:  cd web && npm run build" >&2
  exit 1
fi
if [ ! -f "$WEB/.env.local" ]; then
  echo "✗ No encuentro web/.env.local (las credenciales)." >&2
  exit 1
fi

echo "==> 1/6 Empaquetando Tito (build mínimo)..."
# El build standalone no incluye estáticos ni public: los copiamos dentro.
cp -r "$WEB/.next/static" "$STANDALONE/.next/static" 2>/dev/null || true
[ -d "$WEB/public" ] && cp -r "$WEB/public" "$STANDALONE/public" 2>/dev/null || true
tar czf /tmp/tito-bundle.tgz -C "$STANDALONE" .

echo "==> 2/6 Preparando variables de entorno (desde web/.env.local)..."
# La contraseña del sitio (SITE_USER/SITE_PASSWORD) se toma de web/.env.local,
# NUNCA se escribe en este script (no debe ir a Git). Protege tu token de broker.
if ! grep -q '^SITE_PASSWORD=' "$WEB/.env.local"; then
  echo "✗ Falta SITE_PASSWORD en web/.env.local — el sitio quedaría ABIERTO." >&2
  echo "  Añade estas dos líneas a web/.env.local y reintenta:" >&2
  echo "      SITE_USER=tito" >&2
  echo "      SITE_PASSWORD=<tu-clave>" >&2
  exit 1
fi
# Partimos de .env.local (que ya trae SITE_* y los tokens) y solo fijamos
# lo específico del servidor público.
grep -vE '^(PORT|HOSTNAME|NODE_ENV)=' "$WEB/.env.local" > /tmp/tito.env || true
cat >> /tmp/tito.env <<EOF
PORT=$PORT
HOSTNAME=0.0.0.0
NODE_ENV=production
EOF

echo "==> 3/6 Subiendo a la VM (setup + build + credenciales)..."
gcloud compute scp "$HERE/tito-vm-setup.sh" /tmp/tito.env /tmp/tito-bundle.tgz \
  "$VM:/tmp/" --zone "$ZONE"

echo "==> 4/6 Instalando en la VM (swap, Node, servicio, arranque)..."
gcloud compute ssh "$VM" --zone "$ZONE" --command "set -e
  TITO_PORT=$PORT bash /tmp/tito-vm-setup.sh
  sudo rm -rf /opt/tito && sudo mkdir -p /opt/tito
  sudo tar xzf /tmp/tito-bundle.tgz -C /opt/tito
  sudo chown -R \$USER:\$USER /opt/tito
  sudo install -m 600 /tmp/tito.env /etc/tito/tito.env
  sudo systemctl enable tito >/dev/null 2>&1 || true
  sudo systemctl restart tito
  rm -f /tmp/tito.env /tmp/tito-bundle.tgz
  sleep 4
  systemctl --no-pager --full status tito | head -10 || true"

echo "==> 5/6 Abriendo el puerto $PORT en el firewall..."
gcloud compute firewall-rules create "tito-$PORT" \
  --allow "tcp:$PORT" --source-ranges 0.0.0.0/0 \
  --description "Tito Metralleta web" >/dev/null 2>&1 \
  && echo "    regla tito-$PORT creada" \
  || echo "    la regla tito-$PORT ya existía (ok)"

echo "==> 6/6 Limpieza local..."
rm -f /tmp/tito.env /tmp/tito-bundle.tgz

IP="$(gcloud compute instances describe "$VM" --zone "$ZONE" \
  --format='value(networkInterfaces[0].accessConfigs[0].natIP)' 2>/dev/null)"
echo ""
echo "============================================================"
echo "  ✅ Tito desplegado en tu VM."
echo "  Abre en el celular / trabajo:"
echo "      http://$IP:$PORT/mercado"
echo "  Usuario y contraseña: los de SITE_USER/SITE_PASSWORD en web/.env.local"
echo "============================================================"
