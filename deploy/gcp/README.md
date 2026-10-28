# Tito en Google Cloud (misma VM que Evolet)

Tito corre como servicio **systemd** en la VM gratis de Google Cloud, siempre
encendido (sin límites de horas como Render) y con **auto-update** cada 10 min.

## Pasos (una sola vez, en la terminal SSH de la VM)

```bash
# 1. Clonar tu fork de Tito
git clone https://github.com/Evadelin1/agente-tito-metralleta.git
cd agente-tito-metralleta

# 2. Instalar (Node + swap + build + servicio)
bash deploy/gcp/setup.sh

# 3. Poner los secretos
sudo nano /etc/tito/tito.env
#   MASSIVE_API_KEY=...
#   MASSIVE_MAX_PAGES=40
#   ALPACA_API_KEY_ID=...
#   ALPACA_API_SECRET_KEY=...
#   SITE_USER=tito
#   SITE_PASSWORD=tu_contraseña
#   PORT=8082

# 4. Prender Tito
sudo systemctl enable --now tito

# 5. Auto-update (se pone al día solo cuando se sube un cambio)
bash deploy/gcp/autoupdate-install.sh
```

## Abrir el puerto 8082 en el firewall de Google Cloud
Consola de Google Cloud → VPC network → Firewall → Create firewall rule:
- Targets: All instances (o la VM) · Source IPv4: `0.0.0.0/0`
- Protocols/ports: TCP `8082`

## Acceder desde el celular
`http://IP_EXTERNA_DE_LA_VM:8082` → usuario `tito` + tu contraseña.
(La IP externa la ves en la consola de Google Cloud, en la VM).

## Comandos útiles
```bash
systemctl status tito --no-pager
journalctl -u tito -n 40 --no-pager
systemctl list-timers tito-update.timer --no-pager
```
